from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import audit, current_user, load_user, require_entity, require_role
from ..db import get_db
from ..models import Job, SourceDocument, User
from ..serialize import doc_out

router = APIRouter(prefix='/api', tags=['intake'])
WORK_ROLES = {'ap', 'controller', 'cfo', 'partner', 'gst'}


def get_doc(db: Session, u: User, doc_id: str | int, act: bool = False) -> SourceDocument:
    try:
        d = db.get(SourceDocument, int(str(doc_id).removeprefix('em-')))
    except ValueError:
        d = None
    if not d:
        raise HTTPException(404, 'Document not found')
    require_entity(u, d.entity_id)
    if act:
        require_role(u, WORK_ROLES, 'work on intake documents')
    return d


@router.get('/intake')
def list_intake(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    docs = db.scalars(select(SourceDocument).where(SourceDocument.entity_id == entity).order_by(SourceDocument.received_at.desc()).limit(500))
    return [doc_out(d) for d in docs]


# <iframe>/<img> cannot send headers, so the file URL also accepts ?u= (same dev-auth shortcut as X-User-Id).
@router.get('/files/{doc_id}')
def file(doc_id: int, u: str | None = None, x_user_id: str | None = Header(None), db: Session = Depends(get_db)):
    d = get_doc(db, load_user(db, x_user_id or u), doc_id)
    # XML/JSON from senders is served as text so a crafted file can never run script on our origin.
    mime = 'text/plain; charset=utf-8' if d.mime in ('application/xml', 'application/json') else d.mime
    return FileResponse(d.storage_path, media_type=mime, filename=d.filename, content_disposition_type='inline',
                        headers={'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600'})


class FieldEdit(BaseModel):
    key: str
    value: str


@router.patch('/intake/{doc_id}/fields')
def edit_field(doc_id: str, body: FieldEdit, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    fields = [dict(f) for f in d.fields or []]
    f = next((f for f in fields if f['key'] == body.key), None)
    if not f:
        raise HTTPException(404, 'Unknown field')
    before = f['value']
    f.update(value=body.value.strip(), confidence=100, edited=True, confirmedBy=u.id)
    d.fields = fields
    audit(db, u.id, d.entity_id, 'Edited extracted field', d.filename, f"{f['label']}: {before} → {f['value']}", before={'value': before}, after={'value': f['value']})
    db.commit()
    return doc_out(d)


@router.post('/intake/{doc_id}/confirm')
def confirm(doc_id: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    if not d.fields:
        raise HTTPException(409, 'Nothing extracted yet: run extraction first')
    low = [f['label'] for f in d.fields if f['confidence'] < 90 and not f.get('confirmedBy')]
    d.fields = [{**f, 'confirmedBy': f.get('confirmedBy') or u.id} for f in d.fields]
    d.confirmed_by, d.status, d.status_note = u.id, 'review', 'Fields confirmed · link to PO'
    audit(db, u.id, d.entity_id, 'Confirmed extracted fields', d.filename,
          f'{len(low)} low-confidence field(s) accepted unchanged: {", ".join(low)}' if low else 'All fields high confidence')
    db.commit()
    return doc_out(d)


class StatusIn(BaseModel):
    status: Literal['notfinance', 'rejected', 'new']
    note: str | None = None


@router.post('/intake/{doc_id}/status')
def set_status(doc_id: str, body: StatusIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    d.status, d.status_note = body.status, body.note
    action = {'notfinance': 'Marked not finance', 'rejected': 'Rejected document', 'new': 'Restored document'}[body.status]
    audit(db, u.id, d.entity_id, action, d.filename, body.note or '')
    db.commit()
    return doc_out(d)


@router.post('/intake/{doc_id}/extract')
def re_extract(doc_id: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    if d.confirmed_by:
        raise HTTPException(409, 'Fields are already confirmed by a person')
    db.add(Job(kind='extract', payload={'document_id': d.id}))
    d.status_note = 'Extraction queued'
    audit(db, u.id, d.entity_id, 'Queued extraction', d.filename)
    db.commit()
    return doc_out(d)
