from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import WORK_ROLES, audit, current_user, load_session, require_admin, require_entity, require_role
from ..config import settings
from ..db import get_db
from ..domain import link
from ..domain.match import run_match
from ..extract import ai
from ..extract.schemas import FIELD_META
from ..extract.split import slice_pdf
from ..mail.base import Attachment
from ..mail.ingest import expand, ingest_file, mime_of
from ..mailer import send
from ..models import Job, PurchaseOrder, SourceDocument, SupplierInvoice, User
from ..serialize import doc_out
from ..validate import check_gstin

router = APIRouter(prefix='/api', tags=['intake'])


@router.post('/intake/suggest-client')
async def suggest_client(files: list[UploadFile] = File(...), u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Suggest bill-to client details from an invoice without saving the document or client."""
    require_admin(u, 'create a client from an invoice')
    cfg = ai.config(db)
    if not cfg.configured:
        raise HTTPException(503, 'Configure an AI document reader in Settings → Integrations first')
    for file in files:
        name = file.filename or 'document'
        mime = mime_of(name, file.content_type or '')
        if mime not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'):
            continue
        data = await file.read()
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(413, f'{name}: larger than {settings.max_upload_mb} MB')
        try:
            found = ai.classify(cfg, data, mime, name).raw.get('documents', [])
            invoice = next((d for d in found if d.get('kind') in ('invoice', 'invoice_copy')), None)
            if not invoice:
                continue
            part = slice_pdf(data, int(invoice['page_from']), int(invoice.get('page_to') or invoice['page_from'])) if mime == 'application/pdf' else data
            fields = ai.extract(cfg, 'invoice', part, mime, name).raw
            def value(key: str) -> str:
                return str((fields.get(key) or {}).get('value') or '').strip()
            gstin = value('billTo').upper()
            validation = check_gstin(gstin) if gstin else None
            return {'legal_name': value('billToName'), 'gstin': gstin, 'pan': gstin[2:12] if len(gstin) == 15 else '',
                    'source': name, 'warnings': validation['errors'] + validation['warnings'] if validation else ['Bill-to GSTIN was not found; enter it before creating the client']}
        except Exception as exc:
            raise HTTPException(422, f'Could not read {name}: {type(exc).__name__}') from exc
    raise HTTPException(422, 'No invoice found in the selected PDF or images. Include an invoice to create the client.')


def get_doc(db: Session, u: User, doc_id: str | int, act: bool = False) -> SourceDocument:
    try:
        d = db.get(SourceDocument, int(str(doc_id).removeprefix('em-')))
    except ValueError:
        d = None
    if not d:
        raise HTTPException(404, 'Document not found')
    require_entity(u, d.entity_id)
    if act:
        require_role(u, d.entity_id, WORK_ROLES, 'work on intake documents')
    return d


@router.get('/intake')
def list_intake(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    docs = db.scalars(select(SourceDocument).where(SourceDocument.entity_id == entity).order_by(SourceDocument.received_at.desc(), SourceDocument.id.desc()).limit(1000)).all()
    parts: dict[int, list[SourceDocument]] = {}
    for d in docs:
        if d.bundle_id:
            parts.setdefault(d.bundle_id, []).append(d)
    return [doc_out(d, sorted(parts.get(d.id, []), key=lambda p: p.page_from or 0)) for d in docs if not d.bundle_id]


@router.post('/intake/upload', status_code=201)
async def upload(entity: str, request: Request, files: list[UploadFile] = File(...), u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    require_role(u, entity, WORK_ROLES, 'upload documents')
    out, skipped = [], []
    for f in files:
        data = await f.read()
        name = f.filename or 'upload'
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            skipped.append(f'{name}: larger than {settings.max_upload_mb} MB')
            continue
        if name.lower().endswith('.zip') or f.content_type in ('application/zip', 'application/x-zip-compressed'):
            for ext_id, inner, m2, d2 in expand(Attachment(name, name, 'application/zip', data)):
                out.append(ingest_file(db, entity, inner, m2, d2, 'Upload', u.email, f'From {name}', uploaded_by=u.id))
            continue
        mime = mime_of(name, f.content_type or '')
        if not mime:
            skipped.append(f'{name}: only PDF, images, XML, JSON and ZIP are read')
            continue
        out.append(ingest_file(db, entity, name, mime, data, 'Upload', u.email, '', uploaded_by=u.id))
    audit(db, u.id, entity, 'Uploaded documents', f'{len(out)} file(s)', ', '.join(d.filename for d in out)[:1000], request=request)
    db.commit()
    return {'documents': [doc_out(d) for d in out], 'skipped': skipped}


# <iframe>/<img> send cookies but no custom header, so this GET skips the CSRF check on purpose.
@router.get('/files/{doc_id}')
def file(doc_id: int, request: Request, download: bool = False, db: Session = Depends(get_db)):
    loaded = load_session(request, db)
    if not loaded or not loaded[0].mfa_passed:
        raise HTTPException(401, 'unauthenticated')
    d = get_doc(db, loaded[1], doc_id)
    mime = 'text/plain; charset=utf-8' if d.mime in ('application/xml', 'application/json') else d.mime
    return FileResponse(d.storage_path, media_type=mime, filename=d.filename, content_disposition_type='attachment' if download else 'inline',
                        headers={'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600'})


class FieldEdit(BaseModel):
    key: str
    value: str


@router.patch('/intake/{doc_id}/fields')
def edit_field(doc_id: str, body: FieldEdit, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    fields = [dict(f) for f in d.fields or []]
    f = next((f for f in fields if f['key'] == body.key), None)
    if not f:
        meta = FIELD_META.get(d.kind, FIELD_META['generic']).get(body.key)
        if not meta:
            raise HTTPException(404, 'Unknown field')
        f = {'key': body.key, 'label': meta[0], 'value': '', 'confidence': 0, **({'mono': True} if meta[1] else {}), **({'num': True} if meta[2] else {})}
        fields.append(f)
    before = f['value']
    f.update(value=body.value.strip(), confidence=100, edited=True, confirmedBy=str(u.id))
    f.pop('check', None)
    d.fields = fields
    link.apply(db, d)  # the record behind the document follows the correction
    if d.invoice_id:
        inv = db.get(SupplierInvoice, d.invoice_id)
        if inv and inv.status == 'needs-decision':
            run_match(db, inv)
    audit(db, u.id, d.entity_id, 'Edited extracted field', d.filename, f"{f['label']}: {before} → {f['value']}", before={'value': before}, after={'value': f['value']}, request=request)
    db.commit()
    return doc_out(d)


@router.post('/intake/{doc_id}/confirm')
def confirm(doc_id: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    if not d.fields:
        raise HTTPException(409, 'Nothing read yet: run extraction first')
    low = [f['label'] for f in d.fields if f['confidence'] < 90 and not f.get('confirmedBy')]
    d.fields = [{**f, 'confirmedBy': f.get('confirmedBy') or str(u.id)} for f in d.fields]
    d.confirmed_by = u.id
    d.status = 'linked' if (d.po_id or d.invoice_id or d.grn_id or d.dispatch_id) else 'review'
    d.status_note = 'Confirmed · linked' if d.status == 'linked' else 'Fields confirmed · no PO matched yet'
    audit(db, u.id, d.entity_id, 'Confirmed extracted fields', d.filename,
          f'{len(low)} low-confidence field(s) accepted unchanged: {", ".join(low)}' if low else 'All fields high confidence', request=request)
    db.commit()
    return doc_out(d)


class StatusIn(BaseModel):
    status: Literal['notfinance', 'rejected', 'new']
    note: str | None = None


@router.post('/intake/{doc_id}/status')
def set_status(doc_id: str, body: StatusIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    d.status, d.status_note = body.status, body.note
    if body.status == 'rejected' and d.invoice_id:
        inv = db.get(SupplierInvoice, d.invoice_id)
        if inv and inv.status == 'needs-decision':
            inv.status = 'rejected'
            inv.decision = {'kind': 'reject', 'reasons': ['Rejected at intake'], 'note': body.note or '', 'byId': str(u.id), 'at': datetime.now(UTC).isoformat(), 'secondApproverNeeded': False}
    action = {'notfinance': 'Marked not finance', 'rejected': 'Rejected document', 'new': 'Restored document'}[body.status]
    audit(db, u.id, d.entity_id, action, d.filename, body.note or '', request=request)
    db.commit()
    return doc_out(d)


@router.post('/intake/{doc_id}/extract')
def re_extract(doc_id: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    if d.confirmed_by:
        raise HTTPException(409, 'Fields are already confirmed by a person')
    db.add(Job(kind='process', payload={'document_id': d.bundle_id or d.id}))
    d.status_note = 'Queued for reading'
    audit(db, u.id, d.entity_id, 'Queued re-read', d.filename, request=request)
    db.commit()
    return doc_out(d)


class LinkIn(BaseModel):
    po_id: str


@router.post('/intake/{doc_id}/link')
def link_to_po(doc_id: str, body: LinkIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    po = db.get(PurchaseOrder, int(body.po_id)) if body.po_id.isdigit() else None
    if not po:
        po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.entity_id == d.entity_id, PurchaseOrder.po_no == body.po_id))
    if not po or po.entity_id != d.entity_id:
        raise HTTPException(404, 'PO not found for this client')
    d.po_id = po.id
    if d.invoice_id:
        inv = db.get(SupplierInvoice, d.invoice_id)
        inv.po_id, inv.po_ref = po.id, po.po_no
        link.relink_po(db, po)
        if inv.status == 'needs-decision':
            run_match(db, inv)
    d.status, d.status_note = 'linked', f'Linked to PO {po.po_no}'
    audit(db, u.id, d.entity_id, 'Linked document to PO', d.filename, f'PO {po.po_no}', request=request)
    db.commit()
    return doc_out(d)


class DupIn(BaseModel):
    of_id: str | None = None


@router.post('/intake/{doc_id}/duplicate')
def mark_duplicate(doc_id: str, body: DupIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = get_doc(db, u, doc_id, act=True)
    d.status = 'duplicate'
    if body.of_id and body.of_id.isdigit():
        d.duplicate_of = int(body.of_id)
    d.status_note = f'Duplicate of document {d.duplicate_of}' if d.duplicate_of else 'Marked duplicate'
    audit(db, u.id, d.entity_id, 'Marked duplicate', d.filename, d.status_note, request=request)
    db.commit()
    return doc_out(d)


class AskIn(BaseModel):
    to: str
    subject: str
    body: str


@router.post('/intake/ask-vendor')
def ask_vendor(entity: str, body: AskIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(u, entity, WORK_ROLES, 'write to vendors')
    if not body.body.strip():
        raise HTTPException(422, 'Write a message first.')
    sent = send(body.to, body.subject, body.body)
    audit(db, u.id, entity, 'Asked vendor', body.to, body.subject + ('' if sent else ' · email not configured, logged only'), request=request)
    db.commit()
    return {'ok': True, 'sent': sent}
