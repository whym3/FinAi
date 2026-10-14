"""Any IMAP mailbox with an app password (Gmail, Zoho, Yahoo, iCloud, hosted mail). Read-only: INBOX is examined, never modified.

The secret is JSON {host, port, user, password}; the cursor is "<uidvalidity>:<last uid read>"."""
import email
import imaplib
import json
import re
from datetime import UTC, datetime, timedelta
from email.policy import default
from email.utils import parseaddr, parsedate_to_datetime

from .base import Attachment, AuthError, FetchResult, Message

BATCH = 100  # messages per poll; a long backfill continues on the next poll


def _connect(s: dict) -> imaplib.IMAP4_SSL:
    c = imaplib.IMAP4_SSL(s['host'], int(s.get('port') or 993), timeout=60)
    try:
        c.login(s['user'], s['password'])
    except imaplib.IMAP4.error as e:
        raise AuthError(e.args[0].decode() if e.args and isinstance(e.args[0], bytes) else str(e))
    typ, _ = c.select('INBOX', readonly=True)
    if typ != 'OK':
        raise AuthError('Could not open INBOX')
    return c


def check(s: dict) -> None:
    """Log in and open INBOX, or raise AuthError / OSError with a readable message."""
    c = _connect(s)
    c.logout()


def _status(c: imaplib.IMAP4_SSL) -> tuple[str, int]:
    _, d = c.status('INBOX', '(UIDVALIDITY UIDNEXT)')
    txt = d[0].decode()
    return re.search(r'UIDVALIDITY (\d+)', txt).group(1), int(re.search(r'UIDNEXT (\d+)', txt).group(1))


def parse(uid: str, raw: bytes) -> Message:
    m = email.message_from_bytes(raw, policy=default)
    atts = []
    for i, p in enumerate(m.walk()):
        name = p.get_filename()
        if p.is_multipart() or not name:
            continue
        atts.append(Attachment(id=str(i), filename=name, mime=p.get_content_type(), data=p.get_payload(decode=True) or b'',
                               inline=(p.get_content_disposition() == 'inline')))
    try:
        received = parsedate_to_datetime(m['Date']).astimezone(UTC)
    except (TypeError, ValueError):
        received = datetime.now(UTC)
    return Message(id=uid, sender=parseaddr(m['From'] or '')[1], subject=str(m['Subject'] or ''), received_at=received, attachments=atts)


def fetch(secret: str, cursor: str | None, backfill_days: int) -> FetchResult:
    s = json.loads(secret)
    c = _connect(s)
    try:
        validity, uidnext = _status(c)
        last = int(cursor.split(':')[1]) if cursor and cursor.split(':')[0] == validity else None
        if last is None:  # first sync, or the server renumbered the mailbox: backfill by date
            if backfill_days <= 0:
                return FetchResult([], f'{validity}:{uidnext - 1}')
            since = (datetime.now(UTC) - timedelta(days=backfill_days)).strftime('%d-%b-%Y')
            _, d = c.uid('search', None, f'SINCE {since}')
        else:
            _, d = c.uid('search', None, f'UID {last + 1}:*')
        uids = sorted(u for u in map(int, d[0].split()) if last is None or u > last)[:BATCH]
        msgs = []
        for uid in uids:
            _, data = c.uid('fetch', str(uid), '(BODY.PEEK[])')
            raw = next((part[1] for part in data if isinstance(part, tuple)), None)
            if raw:
                msgs.append(parse(str(uid), raw))
        done = uids[-1] if uids else (last if last is not None else uidnext - 1)
        return FetchResult(msgs, f'{validity}:{done}')
    finally:
        try:
            c.logout()
        except Exception:
            pass
