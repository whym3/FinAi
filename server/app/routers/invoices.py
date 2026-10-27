from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import WORK_ROLES, approval_limit, audit, current_user, require_entity, require_role, users_with_role
from ..db import get_db
from ..domain import verify
from ..domain.crosscheck import group_for_invoice
from ..models import ExceptionItem, Party, SourceDocument, SupplierInvoice, User
from ..notify import notify
from ..serialize import f, invoice_out

router = APIRouter(prefix='/api', tags=['invoices'])
DECIDERS = {'ap', 'controller', 'cfo', 'partner', 'manager'}
Kind = Literal['approve', 'note', 'hold', 'reject', 'dn']


def get_invoice(db: Session, u: User, inv_id: str) -> SupplierInvoice:
    inv = db.get(SupplierInvoice, int(inv_id)) if str(inv_id).isdigit() else None
    if not inv:
        raise HTTPException(404, 'Invoice not found')
    require_entity(u, inv.entity_id)
    return inv


def _out(db: Session, inv: SupplierInvoice) -> dict:
    return invoice_out(inv, db.get(Party, inv.vendor_id) if inv.vendor_id else None)


@router.get('/invoices')
def list_invoices(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    invs = db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity).order_by(SupplierInvoice.received_at.desc()).limit(500)).all()
    vendors = {p.id: p for p in db.scalars(select(Party).where(Party.id.in_([i.vendor_id for i in invs if i.vendor_id])))} if invs else {}
    return [invoice_out(i, vendors.get(i.vendor_id)) for i in invs]


@router.get('/invoices/stats')
def invoice_stats(entity: str, days: int = Query(30, ge=1, le=365), u: User = Depends(current_user), db: Session = Depends(get_db)):
    """How many invoices went through without anyone touching them, and where the open ones stand."""
    require_entity(u, entity)
    since = datetime.now(UTC) - timedelta(days=days)
    decided = straight = 0
    open_states = {'clean': 0, 'issues': 0, 'pending': 0}
    for inv in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity)):
        if inv.decision:
            try:
                at = datetime.fromisoformat(inv.decision['at'])
            except (KeyError, TypeError, ValueError):
                continue
            if at >= since:
                decided += 1
                straight += bool(inv.decision.get('straightThrough'))
        elif inv.status == 'needs-decision':
            state = ((inv.match or {}).get('verdict') or {}).get('state')
            if state in open_states:
                open_states[state] += 1
    return {'days': days, 'decided': decided, 'straightThrough': straight, **open_states}


@router.post('/invoices/{inv_id}/verify')
def verify_invoice(inv_id: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_invoice(db, u, inv_id)
    require_role(u, inv.entity_id, WORK_ROLES, 'verify invoices')
    if not verify.configured(db):
        raise HTTPException(409, 'Connect Vayana in Settings → Integrations to verify with GST systems.')
    verify.queue(db, inv)
    audit(db, u.id, inv.entity_id, 'Queued GST verification', inv.invoice_no, request=request)
    db.commit()
    return _out(db, inv)


@router.get('/invoices/{inv_id}')
def read_invoice(inv_id: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(db, get_invoice(db, u, inv_id))


class DraftIn(BaseModel):
    kind: Kind
    reasons: list[str] = []
    note: str = ''


@router.put('/invoices/{inv_id}/draft')
def save_draft(inv_id: str, body: DraftIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_invoice(db, u, inv_id)
    require_role(u, inv.entity_id, DECIDERS, 'decide on invoices')
    inv.draft = body.model_dump()
    audit(db, u.id, inv.entity_id, 'Saved decision draft', inv.invoice_no, body.kind, request=request)
    db.commit()
    return _out(db, inv)


def _resolve(x: ExceptionItem, who: str, how: str) -> None:
    x.status, x.resolved_at, x.resolution = 'resolved', datetime.now(UTC), how
    x.history = [*(x.history or []), {'at': datetime.now(UTC).isoformat(), 'text': f'Resolved by {who}: {how}'}]


def _next_dn(db: Session, entity_id: str) -> str:
    n = db.scalar(select(func.count(SupplierInvoice.id)).where(SupplierInvoice.entity_id == entity_id, SupplierInvoice.status == 'dn-raised')) or 0
    now = datetime.now()
    fy = f'{now.year}-{str(now.year + 1)[2:]}' if now.month >= 4 else f'{now.year - 1}-{str(now.year)[2:]}'
    return f'DN/{fy}/{n + 1:04d}'


@router.post('/invoices/{inv_id}/decision')
def decide(inv_id: str, body: DraftIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_invoice(db, u, inv_id)
    require_role(u, inv.entity_id, DECIDERS, 'decide on invoices')
    if inv.status != 'needs-decision':
        raise HTTPException(409, 'This invoice already has a decision.')
    if not body.reasons:
        raise HTTPException(422, 'Choose a reason code.')
    if body.kind in ('note', 'hold', 'reject') and not body.note.strip():
        raise HTTPException(422, 'A note is required for this decision.')
    limit = approval_limit(u, inv.entity_id)
    if limit <= 0:
        raise HTTPException(403, 'Your role cannot decide on invoices.')
    if body.kind == 'dn' and not inv.dn_lines:
        raise HTTPException(422, 'Nothing to recover: no rate or freight difference on this invoice.')
    approving = body.kind in ('approve', 'note', 'dn')
    second = approving and f(inv.total) > limit
    dn = None
    if body.kind == 'dn':
        tax = sum(l['taxable'] for l in inv.dn_lines)
        gst = sum(l['gst'] for l in inv.dn_lines)
        dn = {'no': _next_dn(db, inv.entity_id), 'taxable': round(tax, 2), 'gst': round(gst, 2), 'total': round(tax + gst, 2)}
    clean = ((inv.match or {}).get('verdict') or {}).get('state') == 'clean'
    untouched = not any(f.get('edited') for d in group_for_invoice(db, inv) for f in d.fields or [])
    inv.decision = {'kind': body.kind, 'reasons': body.reasons, 'note': body.note, 'byId': str(u.id), 'at': datetime.now(UTC).isoformat(), 'secondApproverNeeded': second, 'debitNote': dn,
                    'straightThrough': clean and untouched and body.kind == 'approve'}
    inv.status = {'hold': 'held', 'reject': 'rejected', 'dn': 'dn-raised'}.get(body.kind, 'approved')
    inv.draft = None
    for fl in (inv.match or {}).get('flags', []):
        x = db.scalar(select(ExceptionItem).where(ExceptionItem.invoice_id == inv.id, ExceptionItem.flag_key == fl['key'], ExceptionItem.status != 'resolved'))
        if not x:
            continue
        if body.kind == 'dn' and fl['amount'] > 0:
            _resolve(x, u.name, f'Recovered by debit note {dn["no"]}')
        elif body.kind == 'dn':
            x.status = 'waiting-vendor'
            x.history = [*(x.history or []), {'at': datetime.now(UTC).isoformat(), 'text': 'Sent to vendor with the debit note'}]
        elif body.kind in ('approve', 'note'):
            _resolve(x, u.name, 'Accepted on invoice' + (': ' + body.note if body.note else ''))
        elif body.kind == 'reject':
            _resolve(x, u.name, 'Invoice rejected and returned to vendor')
        else:
            x.status = 'in-progress'
            x.history = [*(x.history or []), {'at': datetime.now(UTC).isoformat(), 'text': f'Invoice put on hold by {u.name}'}]
    for d in db.scalars(select(SourceDocument).where(SourceDocument.invoice_id == inv.id)):
        if d.status in ('new', 'review'):
            d.status, d.status_note = 'linked', f'Decision: {inv.status}'
    detail = ' + '.join(body.reasons) + (' · ' + body.note if body.note else '') + (f' · {dn["no"]} ₹{dn["total"]:,.2f}' if dn else '') + (' · needs second approver' if second else '')
    audit(db, u.id, inv.entity_id, 'Invoice decision: ' + body.kind, inv.invoice_no, detail, request=request)
    if second:
        for a in users_with_role(db, inv.entity_id, {'cfo', 'controller', 'partner'}):
            if a.id != u.id and approval_limit(a, inv.entity_id) >= f(inv.total):
                notify(db, inv.entity_id, 'Second approval needed', f'{inv.invoice_no} · ₹{f(inv.total):,.2f} decided by {u.name}', '/approvals', 'acc', user_id=a.id)
    db.commit()
    return _out(db, inv)


@router.post('/invoices/{inv_id}/second-approval')
def second_approval(inv_id: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_invoice(db, u, inv_id)
    require_role(u, inv.entity_id, DECIDERS, 'approve invoices')
    dec = inv.decision
    if not dec or not dec.get('secondApproverNeeded'):
        raise HTTPException(409, 'No second approval pending.')
    if dec.get('byId') == str(u.id):
        raise HTTPException(409, 'The second approver must be a different person.')
    lim = approval_limit(u, inv.entity_id)
    if lim < f(inv.total):
        raise HTTPException(403, f'Your approval limit is ₹{lim:,.2f}.')
    inv.decision = {**dec, 'secondApproverNeeded': False, 'secondById': str(u.id), 'secondAt': datetime.now(UTC).isoformat()}
    audit(db, u.id, inv.entity_id, 'Second approval', inv.invoice_no, f'₹{f(inv.total):,.2f}', request=request)
    db.commit()
    return _out(db, inv)
