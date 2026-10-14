from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import WORK_ROLES, audit, current_user, require_entity, require_role
from ..db import get_db
from ..domain.p2p import po_view
from ..models import CustomerInvoice, ExceptionItem, Party, PurchaseOrder, SupplierInvoice, User
from ..serialize import ar_out, exception_out, f, invoice_out, party_customer_out, party_vendor_out, po_list_out

router = APIRouter(prefix='/api', tags=['parties'])
UNPAID = ('approved', 'dn-raised', 'posted', 'needs-decision')


def due_of(inv: SupplierInvoice, vendor: Party | None) -> date | None:
    if not inv.date:
        return None
    return inv.date + timedelta(days=inv.payment_terms_days or (vendor.payment_terms_days if vendor else 30) or 30)


def vendor_aggregates(db: Session, entity: str, today: date | None = None) -> dict[int, dict]:
    today = today or date.today()
    vendors = {p.id: p for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'vendor'))}
    agg: dict[int, dict] = {vid: {'outstanding': 0.0, 'overdue': 0.0, 'overdueDays': 0, 'nextDue': None, 'ytd': 0.0, 'msmeSoon': False} for vid in vendors}
    for inv in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity, SupplierInvoice.vendor_id.is_not(None))):
        a = agg.setdefault(inv.vendor_id, {'outstanding': 0.0, 'overdue': 0.0, 'overdueDays': 0, 'nextDue': None, 'ytd': 0.0, 'msmeSoon': False})
        a['ytd'] += f(inv.total)
        if inv.status in UNPAID and not inv.paid_on:
            a['outstanding'] += f(inv.total)
            due = due_of(inv, vendors.get(inv.vendor_id))
            if due and due < today:
                a['overdue'] += f(inv.total)
                a['overdueDays'] = max(a['overdueDays'], (today - due).days)
            if due and (not a['nextDue'] or due.isoformat() < a['nextDue']):
                a['nextDue'] = due.isoformat()
            m = (inv.match or {}).get('msme')
            if m and (m.get('daysLeft') if m.get('daysLeft') is not None else 99) <= 7:
                a['msmeSoon'] = True
    return agg


@router.get('/vendors')
def list_vendors(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    agg = vendor_aggregates(db, entity)
    return [party_vendor_out(p, agg.get(p.id)) for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'vendor').order_by(Party.name))]


@router.get('/vendors/{vendor_id}')
def read_vendor(vendor_id: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Party, int(vendor_id)) if vendor_id.isdigit() else None
    if not p:
        raise HTTPException(404, 'Vendor not found')
    require_entity(u, p.entity_id)
    agg = vendor_aggregates(db, p.entity_id).get(p.id)
    pos = db.scalars(select(PurchaseOrder).where(PurchaseOrder.vendor_id == p.id).order_by(PurchaseOrder.date.desc().nullslast()).limit(20)).all()
    invs = db.scalars(select(SupplierInvoice).where(SupplierInvoice.vendor_id == p.id).order_by(SupplierInvoice.received_at.desc())).all()
    today = date.today()
    ap = []
    for i in invs:
        if i.status in UNPAID and not i.paid_on:
            due = due_of(i, p) or today
            ap.append({'id': str(i.id), 'entityId': i.entity_id, 'vendorId': str(p.id), 'invoiceNo': i.invoice_no, 'date': i.date.isoformat() if i.date else None, 'due': due.isoformat(),
                       'amount': f(i.total), 'tds': 0, 'msme': p.msme_class, 'status': {'tone': 'bad', 'label': 'Overdue'} if due < today else {'tone': 'warn', 'label': i.status.replace('-', ' ')}})
    msme = []
    for i in invs:
        m = (i.match or {}).get('msme')
        if m and not i.paid_on:
            dl = m.get('daysLeft', 0)
            msme.append({'id': str(i.id), 'entityId': i.entity_id, 'vendorId': str(p.id), 'invoiceNo': i.invoice_no, 'amount': f(i.total), 'acceptedOn': m['acceptedOn'], 'limitOn': m['payBy'],
                         'status': {'tone': 'bad' if dl < 0 else 'warn' if dl <= 7 else 'ok', 'label': f'{dl} days left' if dl >= 0 else f'{-dl} days over'}})
    return {'vendor': party_vendor_out(p, agg), 'pos': [po_list_out(po, p, *po_view(db, po)) for po in pos], 'invoices': [invoice_out(i, p) for i in invs], 'ap': ap,
            'exceptions': [exception_out(x) for x in db.scalars(select(ExceptionItem).where(ExceptionItem.vendor_id == p.id).order_by(ExceptionItem.created_at.desc()))], 'msme': msme}


class VendorPatch(BaseModel):
    msme_class: str | None = None
    udyam: str | None = None
    payment_terms_days: int | None = None
    email: str | None = None
    phone: str | None = None
    tds_section: str | None = None
    blocked: bool | None = None


@router.patch('/vendors/{vendor_id}')
def update_vendor(vendor_id: str, body: VendorPatch, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Party, int(vendor_id)) if vendor_id.isdigit() else None
    if not p:
        raise HTTPException(404, 'Vendor not found')
    require_role(u, p.entity_id, WORK_ROLES, 'edit vendors')
    before = party_vendor_out(p)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(p, k, v or None if k == 'msme_class' else v)
    audit(db, u.id, p.entity_id, 'Edited vendor', p.name, ', '.join(changes), before=before, after=party_vendor_out(p), request=request)
    db.commit()
    return party_vendor_out(p, vendor_aggregates(db, p.entity_id).get(p.id))


def customer_aggregates(db: Session, entity: str, today: date | None = None) -> dict[int, dict]:
    today = today or date.today()
    agg: dict[int, dict] = {}
    for ci in db.scalars(select(CustomerInvoice).where(CustomerInvoice.entity_id == entity, CustomerInvoice.customer_id.is_not(None))):
        a = agg.setdefault(ci.customer_id, {'outstanding': 0.0, 'overdue': 0.0, 'daysOverdue': 0, 'invoices': 0, 'followUp': None})
        a['invoices'] += 1
        sign = -1 if ci.doc_type == 'credit_memo' else 1
        open_amt = sign * (f(ci.total) - f(ci.received))
        a['outstanding'] += open_amt
        if sign > 0 and open_amt > 0 and ci.due_date and ci.due_date < today:
            a['overdue'] += open_amt
            a['daysOverdue'] = max(a['daysOverdue'], (today - ci.due_date).days)
        if ci.follow_up and not a['followUp']:
            a['followUp'] = {'tone': ci.follow_up.get('tone', 'warn'), 'label': ci.follow_up.get('label', '')}
    return agg


@router.get('/customers')
def list_customers(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    agg = customer_aggregates(db, entity)
    return [party_customer_out(p, agg.get(p.id)) for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'customer').order_by(Party.name))]


@router.get('/ar')
def list_ar(entity: str, limit: int = 2500, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    rows = db.scalars(select(CustomerInvoice).where(CustomerInvoice.entity_id == entity).order_by(CustomerInvoice.date.desc().nullslast(), CustomerInvoice.id.desc()).limit(limit)).all()
    names = dict(db.execute(select(Party.id, Party.name).where(Party.entity_id == entity, Party.kind == 'customer')).all()) if rows else {}
    today = date.today()
    total = db.scalar(select(func.count(CustomerInvoice.id)).where(CustomerInvoice.entity_id == entity))
    return {'items': [ar_out(ci, names.get(ci.customer_id, ''), today) for ci in rows], 'total': total}


class FollowUpIn(BaseModel):
    kind: str
    detail: str = ''


@router.post('/ar/{ar_id}/follow-up')
def follow_up(ar_id: str, body: FollowUpIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    ci = db.get(CustomerInvoice, int(ar_id)) if ar_id.isdigit() else None
    if not ci:
        raise HTTPException(404, 'Receivable not found')
    require_role(u, ci.entity_id, {'ar', 'controller', 'cfo', 'partner', 'manager'}, 'follow up receivables')
    label = {'reminder': 'Reminder sent', 'promise': 'Promise ' + body.detail, 'dispute': 'Disputed · ' + body.detail, 'escalate': 'Escalated to CFO'}.get(body.kind, body.kind)
    ci.follow_up = {'tone': 'bad' if body.kind in ('dispute', 'escalate') else 'warn', 'label': label, 'last': f'{label} · {u.name} {date.today().strftime("%d-%m-%Y")}'}
    audit(db, u.id, ci.entity_id, 'Receivable follow-up', ci.invoice_no, label, request=request)
    db.commit()
    return ar_out(ci, db.get(Party, ci.customer_id).name if ci.customer_id else '', date.today())
