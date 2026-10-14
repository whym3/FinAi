"""Turns fetched mail into source_documents: filter, unzip, store the original, de-duplicate, queue extraction."""
import hashlib
import io
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import audit
from ..config import settings
from ..models import Job, Mailbox, SourceDocument
from .base import Attachment, Message

EXT_MIME = {'.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tif': 'image/tiff',
            '.tiff': 'image/tiff', '.xml': 'application/xml', '.json': 'application/json', '.webp': 'image/webp'}
MAX_ZIP_ENTRIES = 200
MAX_ZIP_BYTES = 50 * 1024 * 1024  # zip-bomb guard: total uncompressed size we accept
SIGNATURE_IMAGE_BYTES = 20 * 1024


def mime_of(filename: str, declared: str) -> str | None:
    """Supported mime for this file, or None. The extension wins over the declared type, which mail clients often get wrong."""
    return EXT_MIME.get(Path(filename).suffix.lower()) or (declared if declared in EXT_MIME.values() else None)


def expand(att: Attachment) -> list[tuple[str, str, str, bytes]]:
    """(external id, filename, mime, data) for every supported file in the attachment, unpacking zips."""
    if att.filename.lower().endswith('.zip') or att.mime in ('application/zip', 'application/x-zip-compressed'):
        out, total = [], 0
        try:
            with zipfile.ZipFile(io.BytesIO(att.data)) as z:
                for info in z.infolist()[:MAX_ZIP_ENTRIES]:
                    name = Path(info.filename).name
                    mime = mime_of(name, '')
                    if info.is_dir() or not mime or name.startswith('.'):
                        continue
                    total += info.file_size
                    if total > MAX_ZIP_BYTES:
                        break
                    out.append((f'{att.id}/{info.filename}', name, mime, z.read(info)))
        except zipfile.BadZipFile:
            return []
        return out
    mime = mime_of(att.filename, att.mime)
    if not mime:
        return []
    if att.inline and mime.startswith('image/') and len(att.data) < SIGNATURE_IMAGE_BYTES:
        return []  # logos and signatures
    return [(att.id, att.filename, mime, att.data)]


def _domain_match(sender: str, rules: list[str]) -> bool:
    s = sender.lower()
    return any(s == r.lower() or s.endswith('@' + r.lower().lstrip('@')) for r in rules)


def sender_allowed(sender: str, allow: list[str], block: list[str]) -> bool:
    if block and _domain_match(sender, block):
        return False
    return not allow or _domain_match(sender, allow)


def store(entity_id: str, data: bytes) -> tuple[str, str]:
    sha = hashlib.sha256(data).hexdigest()
    path = Path(settings.storage_dir) / entity_id / sha
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return sha, str(path)


def ingest_file(db: Session, entity_id: str, filename: str, mime: str, data: bytes, channel: str = 'Upload', sender: str = '', subject: str = '',
                uploaded_by: int | None = None, received_at: datetime | None = None, mailbox_id: int | None = None, msg_id: str | None = None, att_id: str | None = None) -> SourceDocument:
    """Store one file as a source document, mark exact duplicates, and queue it for reading."""
    sha, path = store(entity_id, data)
    dup = db.scalar(select(SourceDocument.id).where(SourceDocument.entity_id == entity_id, SourceDocument.sha256 == sha, SourceDocument.bundle_id.is_(None)).order_by(SourceDocument.id))
    doc = SourceDocument(entity_id=entity_id, channel=channel, mailbox_id=mailbox_id, external_msg_id=msg_id, external_att_id=att_id, sender=sender, subject=subject[:1000],
                         received_at=received_at or datetime.now(UTC), uploaded_by=uploaded_by, filename=filename[:300], mime=mime, size=len(data), sha256=sha, storage_path=path,
                         status='duplicate' if dup else 'new', duplicate_of=dup, status_note=f'Same file as document {dup}' if dup else 'Queued for reading')
    db.add(doc)
    db.flush()
    if not dup:
        db.add(Job(kind='process', payload={'document_id': doc.id}))
    return doc


def ingest(db: Session, mb: Mailbox, msgs: list[Message]) -> int:
    if not msgs:
        return 0
    created = 0
    for m in msgs:
        if not sender_allowed(m.sender, mb.sender_allow or [], mb.sender_block or []):
            continue
        for att in m.attachments:
            for ext_id, filename, mime, data in expand(att):
                exists = db.scalar(select(SourceDocument.id).where(SourceDocument.mailbox_id == mb.id, SourceDocument.external_msg_id == m.id,
                                                                   SourceDocument.external_att_id == ext_id))
                if exists:
                    continue  # already ingested on an earlier sync
                ingest_file(db, mb.entity_id, filename, mime, data, 'Email', m.sender, m.subject, received_at=m.received_at, mailbox_id=mb.id, msg_id=m.id, att_id=ext_id)
                created += 1
    if created:
        audit(db, None, mb.entity_id, 'Ingested email documents', mb.address, f'{created} new document(s)')
    return created


def sync_mailbox(db: Session, mb: Mailbox) -> int:
    """Fetch new mail for one mailbox and ingest it. Errors mark the mailbox, they never raise to the poller."""
    from .. import crypto
    from . import gmail, imap, outlook
    from .base import AuthError
    provider = {'gmail': gmail, 'outlook': outlook, 'imap': imap}[mb.provider]
    try:
        res = provider.fetch(crypto.decrypt(mb.enc_refresh_token), mb.cursor, mb.backfill_days)
        n = ingest(db, mb, res.messages)
        mb.cursor = res.cursor
        if res.refresh_token:
            mb.enc_refresh_token = crypto.encrypt(res.refresh_token)
        mb.status, mb.last_error, mb.last_sync_at = 'active', None, datetime.now(UTC)
        db.commit()
        return n
    except AuthError as e:
        db.rollback()
        mb.status, mb.last_error = 'error', f'Access was revoked or expired. Reconnect the mailbox. ({e})'
        audit(db, None, mb.entity_id, 'Mailbox sync failed', mb.address, mb.last_error)
        db.commit()
    except Exception as e:  # network or provider error: keep the cursor, retry next poll
        db.rollback()
        mb.last_error = f'{type(e).__name__}: {e}'[:500]
        db.commit()
    return 0
