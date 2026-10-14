"""Gmail REST v1, read-only. First sync backfills by query; later syncs follow history from the stored historyId."""
import base64
from datetime import UTC, datetime
from email.utils import parseaddr

import httpx

from ..config import settings
from .base import Attachment, FetchResult, Message, token_request

AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
API = 'https://gmail.googleapis.com/gmail/v1/users/me'
SCOPES = 'openid email https://www.googleapis.com/auth/gmail.readonly'
MAX_BACKFILL = 200


def auth_params(redirect_uri: str, state: str, challenge: str) -> dict:
    return {'client_id': settings.google_client_id, 'redirect_uri': redirect_uri, 'response_type': 'code', 'scope': SCOPES, 'state': state,
            'access_type': 'offline', 'prompt': 'consent', 'include_granted_scopes': 'true', 'code_challenge': challenge, 'code_challenge_method': 'S256'}


def exchange(code: str, redirect_uri: str, verifier: str) -> dict:
    return token_request(TOKEN_URL, {'code': code, 'client_id': settings.google_client_id, 'client_secret': settings.google_client_secret,
                                     'redirect_uri': redirect_uri, 'grant_type': 'authorization_code', 'code_verifier': verifier})


def access_token(refresh_token: str) -> tuple[str, str | None]:
    t = token_request(TOKEN_URL, {'refresh_token': refresh_token, 'client_id': settings.google_client_id,
                                  'client_secret': settings.google_client_secret, 'grant_type': 'refresh_token'})
    return t['access_token'], t.get('refresh_token')


def profile(c: httpx.Client) -> dict:
    r = c.get(f'{API}/profile')
    r.raise_for_status()
    return r.json()


def _b64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def _walk(part: dict):
    yield part
    for p in part.get('parts') or []:
        yield from _walk(p)


def parse_message(c: httpx.Client, msg: dict) -> Message:
    headers = {h['name'].lower(): h['value'] for h in msg['payload'].get('headers', [])}
    atts = []
    for p in _walk(msg['payload']):
        if not p.get('filename'):
            continue
        body = p.get('body', {})
        if body.get('attachmentId'):
            r = c.get(f"{API}/messages/{msg['id']}/attachments/{body['attachmentId']}")
            r.raise_for_status()
            data = _b64(r.json()['data'])
        elif body.get('data'):
            data = _b64(body['data'])
        else:
            continue
        ph = {h['name'].lower(): h['value'] for h in p.get('headers', [])}
        atts.append(Attachment(id=p.get('partId') or p['filename'], filename=p['filename'], mime=p.get('mimeType', 'application/octet-stream'),
                               data=data, inline=ph.get('content-disposition', '').lower().startswith('inline')))
    return Message(id=msg['id'], sender=parseaddr(headers.get('from', ''))[1] or headers.get('from', ''), subject=headers.get('subject', ''),
                   received_at=datetime.fromtimestamp(int(msg.get('internalDate', 0)) / 1000, UTC), attachments=atts)


def _list_ids(c: httpx.Client, q: str) -> list[str]:
    ids, token = [], None
    while len(ids) < MAX_BACKFILL:
        r = c.get(f'{API}/messages', params={'q': q, 'maxResults': 100, **({'pageToken': token} if token else {})})
        r.raise_for_status()
        j = r.json()
        ids += [m['id'] for m in j.get('messages', [])]
        token = j.get('nextPageToken')
        if not token:
            break
    return ids[:MAX_BACKFILL]


def fetch(refresh_token: str, cursor: str | None, backfill_days: int) -> FetchResult:
    access, rotated = access_token(refresh_token)
    with httpx.Client(headers={'Authorization': f'Bearer {access}'}, timeout=60) as c:
        ids: list[str] = []
        if cursor is None:
            new_cursor = profile(c)['historyId']
            if backfill_days > 0:
                ids = _list_ids(c, f'has:attachment newer_than:{backfill_days}d')
        else:
            new_cursor, token = cursor, None
            while True:
                r = c.get(f'{API}/history', params={'startHistoryId': cursor, 'historyTypes': 'messageAdded', 'labelId': 'INBOX', **({'pageToken': token} if token else {})})
                if r.status_code == 404:  # history too old: re-scan the last two days instead
                    new_cursor = profile(c)['historyId']
                    ids = _list_ids(c, 'has:attachment newer_than:2d')
                    break
                r.raise_for_status()
                j = r.json()
                ids += [a['message']['id'] for h in j.get('history', []) for a in h.get('messagesAdded', [])]
                new_cursor = j.get('historyId', new_cursor)
                token = j.get('nextPageToken')
                if not token:
                    break
        msgs = []
        for mid in dict.fromkeys(ids):
            r = c.get(f'{API}/messages/{mid}', params={'format': 'full'})
            if r.status_code == 404:
                continue  # deleted between list and fetch
            r.raise_for_status()
            msgs.append(parse_message(c, r.json()))
        return FetchResult(msgs, str(new_cursor), rotated)
