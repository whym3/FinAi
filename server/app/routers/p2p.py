from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import WORK_ROLES, audit, current_user, require_entity, require_role
from ..db import get_db
from ..domain.p2p import po_view
from ..mail.ingest import ingest_file, mime_of
from ..models import Party, PurchaseOrder, SourceDocument, User
from ..serialize import po_list_out

router = APIRouter(prefix='/api', tags=['p2p'])


def get_po(db: Session, u: User, po_id: str) -> PurchaseOrder:
    po = db.get(PurchaseOrder, int(po_id)) if str(po_id).isdigit() else None
    if not po:
        raise HTTPException(404, 'PO not found')
    require_entity(u, po.entity_id)
    return po


@router.get('/pos')
def list_pos(entity: str, q: str | None = None, plant: str | None = None, vendor: str | None = None, with_docs: bool = False, limit: int = 300,
             u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    stmt = select(PurchaseOrder).where(PurchaseOrder.entity_id == entity)
    if q:
        stmt = stmt.where(PurchaseOrder.po_no.ilike(f'%{q}%') | PurchaseOrder.vendor_name.ilike(f'%{q}%'))
    if plant:
        stmt = stmt.where(PurchaseOrder.plant == plant)
    if vendor and vendor.isdigit():
        stmt = stmt.where(PurchaseOrder.vendor_id == int(vendor))
    docs_sub = select(SourceDocument.po_id, func.count().label('n')).where(SourceDocument.po_id.is_not(None)).group_by(SourceDocument.po_id).subquery()
    stmt = stmt.outerjoin(docs_sub, docs_sub.c.po_id == PurchaseOrder.id)
    if with_docs:
        stmt = stmt.where(docs_sub.c.n > 0)
    stmt = stmt.order_by(func.coalesce(docs_sub.c.n, 0).desc(), PurchaseOrder.date.desc().nullslast(), PurchaseOrder.id.desc()).limit(limit)
    pos = db.scalars(stmt).all()
    vendors = {p.id: p for p in db.scalars(select(Party).where(Party.id.in_([po.vendor_id for po in pos if po.vendor_id])))} if pos else {}
    out = []
    for po in pos:
        stages, agg = po_view(db, po)
        out.append(po_list_out(po, vendors.get(po.vendor_id), stages, agg))
    total = db.scalar(select(func.count(PurchaseOrder.id)).where(PurchaseOrder.entity_id == entity))
    plants = [r[0] for r in db.execute(select(PurchaseOrder.plant).where(PurchaseOrder.entity_id == entity, PurchaseOrder.plant.is_not(None)).distinct().order_by(PurchaseOrder.plant))]
    return {'items': out, 'total': total, 'plants': plants}


@router.get('/pos/{po_id}')
def read_po(po_id: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    po = get_po(db, u, po_id)
    stages, agg = po_view(db, po)
    return po_list_out(po, db.get(Party, po.vendor_id) if po.vendor_id else None, stages, agg)


@router.post('/pos/{po_id}/documents', status_code=201)
async def add_document(po_id: str, request: Request, files: list[UploadFile] = File(...), u: User = Depends(current_user), db: Session = Depends(get_db)):
    po = get_po(db, u, po_id)
    require_role(u, po.entity_id, WORK_ROLES, 'add documents')
    docs = []
    for f in files:
        data = await f.read()
        mime = mime_of(f.filename or '', f.content_type or '')
        if not mime:
            raise HTTPException(422, f'{f.filename}: upload a PDF or image')
        d = ingest_file(db, po.entity_id, f.filename or 'upload', mime, data, 'Upload', u.email, f'Added to PO {po.po_no}', uploaded_by=u.id)
        d.po_id = po.id  # the reader may refine the link; the PO is the hint
        docs.append(d)
    audit(db, u.id, po.entity_id, 'Added document to PO', f'PO {po.po_no}', ', '.join(d.filename for d in docs), request=request)
    db.commit()
    return {'documents': [str(d.id) for d in docs]}
