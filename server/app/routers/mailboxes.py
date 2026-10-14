import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import crypto
from ..auth import ADMIN_ROLES, audit, current_user, require_entity, require_role
from ..db import get_db
from ..mail.ingest import sync_mailbox
from ..models import Mailbox, SourceDocument, User
from ..serialize import doc_out, mailbox_out

router = APIRouter(prefix='/api', tags=['mailboxes'])


def _counts(db: Session, ids: list[int]) -> dict[int, int]:
    return dict(db.execute(select(SourceDocument.mailbox_id, func.count()).where(SourceDocument.mailbox_id.in_(ids)).group_by(SourceDocument.mailbox_id)).all())


def get_mailbox(db: Session, u: User, mailbox_id: int, manage: bool = False) -> Mailbox:
    mb = db.get(Mailbox, mailbox_id)
    if not mb:
        raise HTTPException(404, 'Mailbox not found')
    require_entity(u, mb.entity_id)
    if manage:
        require_role(u, ADMIN_ROLES, 'manage mailboxes')
    return mb


@router.get('/entities/{entity_id}/mailboxes')
def list_mailboxes(entity_id: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity_id)
    mbs = db.scalars(select(Mailbox).where(Mailbox.entity_id == entity_id, Mailbox.status != 'disconnected').order_by(Mailbox.id)).all()
    counts = _counts(db, [m.id for m in mbs])
    return [mailbox_out(m, counts.get(m.id, 0)) for m in mbs]


@router.get('/mailboxes/{mailbox_id}/recent')
def recent(mailbox_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    get_mailbox(db, u, mailbox_id)
    docs = db.scalars(select(SourceDocument).where(SourceDocument.mailbox_id == mailbox_id).order_by(SourceDocument.id.desc()).limit(20))
    return [doc_out(d) for d in docs]


class MailboxPatch(BaseModel):
    status: str | None = Field(None, pattern='^(active|paused)$')
    backfill_days: int | None = Field(None, ge=0, le=90)
    sender_allow: list[str] | None = None
    sender_block: list[str] | None = None


@router.patch('/mailboxes/{mailbox_id}')
def update_mailbox(mailbox_id: int, body: MailboxPatch, u: User = Depends(current_user), db: Session = Depends(get_db)):
    mb = get_mailbox(db, u, mailbox_id, manage=True)
    before = mailbox_out(mb)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(mb, k, [s.strip().lower() for s in v if s.strip()] if isinstance(v, list) else v)
    action = {'paused': 'Paused mailbox', 'active': 'Resumed mailbox'}.get(body.status or '', 'Changed mailbox settings')
    audit(db, u.id, mb.entity_id, action, mb.address, before=before, after=mailbox_out(mb))
    db.commit()
    return mailbox_out(mb, _counts(db, [mb.id]).get(mb.id, 0))


@router.post('/mailboxes/{mailbox_id}/sync')
def sync_now(mailbox_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    mb = get_mailbox(db, u, mailbox_id, manage=True)
    if not mb.enc_refresh_token or mb.status == 'disconnected':
        raise HTTPException(409, 'Reconnect this mailbox first')
    n = sync_mailbox(db, mb)
    audit(db, u.id, mb.entity_id, 'Synced mailbox', mb.address, f'{n} new document(s)')
    db.commit()
    return {'new': n, 'mailbox': mailbox_out(mb, _counts(db, [mb.id]).get(mb.id, 0))}


@router.post('/mailboxes/{mailbox_id}/disconnect')
def disconnect(mailbox_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    mb = get_mailbox(db, u, mailbox_id, manage=True)
    if mb.provider == 'gmail' and mb.enc_refresh_token:
        try:  # best effort: also revoke at Google so the token is useless if leaked
            httpx.post('https://oauth2.googleapis.com/revoke', params={'token': crypto.decrypt(mb.enc_refresh_token)}, timeout=10)
        except Exception:
            pass
    mb.status, mb.enc_refresh_token, mb.cursor = 'disconnected', None, None
    audit(db, u.id, mb.entity_id, 'Disconnected mailbox', mb.address, 'Ingested documents are kept')
    db.commit()
    return {'ok': True}
