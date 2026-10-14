"""Modules whose data source is not connected yet (GST portal, bank, TDS), plus payables due list, MSME tracker, close checklist and reports."""
import csv
import io
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import WORK_ROLES, audit, current_user, require_entity, require_role
from ..db import get_db
from ..models import AuditLog, CloseTask, CustomerInvoice, Party, SupplierInvoice, User
from ..serialize import f, ist, party_vendor_out
from .parties import customer_aggregates, due_of, vendor_aggregates

router = APIRouter(prefix='/api', tags=['modules'])
UNPAID = ('approved', 'dn-raised', 'posted')
NOT_CONNECTED = 'This needs a connection that is not set up yet'


@router.get('/gst')
def gst(entity: str, gstin: str | None = None, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    code = gstin[:2] if gstin else None
    outward = []
    for c in db.scalars(select(CustomerInvoice).where(CustomerInvoice.entity_id == entity).order_by(CustomerInvoice.date.desc().nullslast()).limit(300)):
        outward.append({'id': str(c.id), 'entityId': entity, 'gstin': gstin or '', 'customer': db.get(Party, c.customer_id).name if c.customer_id else '', 'customerGstin': '', 'docNo': c.gst_invoice_no or c.invoice_no,
                        'date': c.date.isoformat() if c.date else '', 'taxable': f(c.taxable), 'tax': f(c.tax), 'irn': {'tone': 'none', 'label': 'Not verified'}, 'ewb': {'tone': 'none', 'label': '—'}, 'gstr1': {'tone': 'none', 'label': 'Not filed'}})
    vendors = [party_vendor_out(p) for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'vendor'))]
    return {'summary': None, 'rows': [], 'outward': outward, 'rcmLrs': [], 'suppliers': vendors, 'notConnected': 'GST portal (GSP) not connected'}


@router.post('/gst/{action}')
def gst_action(action: str, _: User = Depends(current_user)):
    raise HTTPException(409, 'Connect a GST Suvidha Provider in Settings → Integrations before acting on IMS')


@router.get('/ap')
def ap(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    today = date.today()
    vendors = {p.id: p for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'vendor'))}
    out = []
    for i in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity, SupplierInvoice.status.in_(UNPAID), SupplierInvoice.paid_on.is_(None))):
        v = vendors.get(i.vendor_id)
        d = due_of(i, v) or today
        left = (d - today).days
        st = {'tone': 'bad', 'label': f'Overdue {-left} d'} if left < 0 else {'tone': 'warn', 'label': f'Due in {left} d'} if left <= 7 else {'tone': 'ok', 'label': 'Scheduled'}
        out.append({'id': str(i.id), 'entityId': entity, 'vendorId': str(i.vendor_id or ''), 'vendor': i.vendor_name, 'invoiceNo': i.invoice_no, 'date': i.date.isoformat() if i.date else None,
                    'due': d.isoformat(), 'amount': f(i.total), 'tds': 0, 'status': st, 'msme': v.msme_class if v else None})
    return sorted(out, key=lambda a: (0 if a['msme'] else 1, a['due']))


@router.get('/runs')
def runs(entity: str, u: User = Depends(current_user)):
    require_entity(u, entity)
    return []


@router.get('/runs/{run_id}')
def run(run_id: str, _: User = Depends(current_user)):
    raise HTTPException(404, 'Payment runs start once a bank is connected')


@router.get('/bank')
def bank(entity: str, u: User = Depends(current_user)):
    require_entity(u, entity)
    return {'accounts': [], 'lines': [], 'notConnected': 'Bank feed not connected'}


@router.get('/tds')
def tds(entity: str, u: User = Depends(current_user)):
    require_entity(u, entity)
    return []


@router.get('/msme')
def msme(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    out = []
    for i in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity)):
        m = (i.match or {}).get('msme')
        if not m:
            continue
        dl = m.get('daysLeft', 0)
        st = {'tone': 'ok', 'label': f'Paid {i.paid_on}'} if i.paid_on else {'tone': 'bad', 'label': f'{-dl} days over'} if dl < 0 else {'tone': 'warn' if dl <= 7 else 'ok', 'label': f'{dl} days left'}
        out.append({'id': str(i.id), 'entityId': entity, 'vendorId': str(i.vendor_id or ''), 'vendor': i.vendor_name, 'invoiceNo': i.invoice_no, 'amount': f(i.total), 'acceptedOn': m['acceptedOn'], 'limitOn': m['payBy'],
                    'status': st, 'paidOn': i.paid_on.isoformat() if i.paid_on else None, 'note': m.get('note')})
    return sorted(out, key=lambda x: x['limitOn'])


DEFAULT_CLOSE = [('Payables', 'All invoices received for the month decided'), ('Payables', 'GRNI reviewed: GRNs without invoice older than 30 days'), ('Payables', 'MSME dues beyond 45 days listed'),
                 ('Receivables', 'Customer invoices imported for the month'), ('Receivables', 'Collections applied and overdue follow-ups logged'), ('Bank', 'Bank statements reconciled'),
                 ('GST', 'IMS actions taken before GSTR-2B'), ('GST', 'GSTR-1 data checked against the sales register'), ('TDS', 'TDS deducted and challan paid by the 7th'),
                 ('Close', 'Sub-ledger vs SAP GL tie-out'), ('Close', 'Accruals proposed'), ('Close', 'Controller sign-off')]


@router.get('/close')
def close(entity: str, period: str | None = None, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    period = period or date.today().strftime('%Y-%m')
    tasks = db.scalars(select(CloseTask).where(CloseTask.entity_id == entity, CloseTask.period == period).order_by(CloseTask.id)).all()
    if not tasks:
        y, m = int(period[:4]), int(period[5:7])
        due = date(y + (m // 12), m % 12 + 1, 7)
        for area, task in DEFAULT_CLOSE:
            db.add(CloseTask(entity_id=entity, period=period, area=area, task=task, due=due))
        db.commit()
        tasks = db.scalars(select(CloseTask).where(CloseTask.entity_id == entity, CloseTask.period == period).order_by(CloseTask.id)).all()
    return [{'id': str(t.id), 'entityId': entity, 'period': t.period, 'area': t.area, 'task': t.task, 'ownerId': str(t.owner_id) if t.owner_id else '', 'due': t.due.isoformat() if t.due else None,
             'done': t.done, 'doneAt': ist(t.done_at), 'note': t.note} for t in tasks]


@router.post('/close/{task_id}/toggle')
def toggle_close(task_id: int, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(CloseTask, task_id)
    if not t:
        raise HTTPException(404, 'Task not found')
    require_role(u, t.entity_id, WORK_ROLES | {'ar'}, 'work the close checklist')
    t.done = not t.done
    t.done_at, t.done_by = (datetime.now(UTC), u.id) if t.done else (None, None)
    audit(db, u.id, t.entity_id, 'Close task ' + ('done' if t.done else 'reopened'), t.task, t.period, request=request)
    db.commit()
    return {'id': str(t.id), 'done': t.done}


REPORTS = [
    {'id': 'ap-ageing', 'name': 'Trade payables ageing (Schedule III)', 'group': 'Statutory', 'description': 'Open supplier invoices by age bucket, MSME and others', 'format': 'CSV'},
    {'id': 'ar-ageing', 'name': 'Trade receivables ageing (Schedule III)', 'group': 'Statutory', 'description': 'Open customer invoices by age bucket', 'format': 'CSV'},
    {'id': 'msme', 'name': 'MSME dues (Form 1 support)', 'group': 'Statutory', 'description': 'Dues to micro and small suppliers with acceptance date and 45-day limit', 'format': 'CSV'},
    {'id': 'vendors', 'name': 'Vendor outstanding', 'group': 'Payables', 'description': 'Outstanding and overdue by vendor', 'format': 'CSV'},
    {'id': 'customers', 'name': 'Customer outstanding', 'group': 'Receivables', 'description': 'Outstanding and overdue by customer', 'format': 'CSV'},
    {'id': 'stock', 'name': 'Stock summary', 'group': 'Inventory', 'description': 'Opening, receipts, issues and closing by plant and material, from the latest stock import', 'format': 'CSV'},
    {'id': 'audit', 'name': 'Audit trail', 'group': 'Audit', 'description': 'Every change with who, when and IP', 'format': 'CSV'},
]


@router.get('/reports')
def reports(_: User = Depends(current_user)):
    return REPORTS


@router.get('/reports/{report_id}')
def run_report(report_id: str, entity: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    today = date.today()
    buf = io.StringIO()
    w = csv.writer(buf)
    if report_id == 'vendors':
        agg = vendor_aggregates(db, entity, today)
        w.writerow(['Vendor', 'Code', 'GSTIN', 'MSME', 'Outstanding', 'Overdue', 'Next due'])
        for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'vendor').order_by(Party.name)):
            a = agg.get(p.id, {})
            w.writerow([p.name, p.code, p.gstin, p.msme_class or '', a.get('outstanding', 0), a.get('overdue', 0), a.get('nextDue', '')])
    elif report_id == 'customers':
        agg = customer_aggregates(db, entity, today)
        w.writerow(['Customer', 'Code', 'State', 'Outstanding', 'Overdue', 'Days overdue'])
        for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'customer').order_by(Party.name)):
            a = agg.get(p.id, {})
            w.writerow([p.name, p.code, p.state, a.get('outstanding', 0), a.get('overdue', 0), a.get('daysOverdue', 0)])
    elif report_id in ('ap-ageing', 'msme'):
        vendors = {p.id: p for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'vendor'))}
        w.writerow(['Vendor', 'Invoice', 'Date', 'Due', 'Age days', 'MSME', 'Amount', 'Accepted on', '45-day limit'])
        for i in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity, SupplierInvoice.paid_on.is_(None))):
            v = vendors.get(i.vendor_id)
            if report_id == 'msme' and not (v and v.msme_class):
                continue
            m = (i.match or {}).get('msme') or {}
            w.writerow([i.vendor_name, i.invoice_no, i.date, due_of(i, v), (today - i.date).days if i.date else '', v.msme_class if v else '', f(i.total), m.get('acceptedOn', ''), m.get('payBy', '')])
    elif report_id == 'ar-ageing':
        names = dict(db.execute(select(Party.id, Party.name).where(Party.entity_id == entity, Party.kind == 'customer')).all())
        w.writerow(['Customer', 'Invoice', 'GST invoice', 'Date', 'Due', 'Age days', 'Amount', 'Received', 'Open'])
        for c in db.scalars(select(CustomerInvoice).where(CustomerInvoice.entity_id == entity)):
            if f(c.total) - f(c.received) <= 0:
                continue
            w.writerow([names.get(c.customer_id, ''), c.invoice_no, c.gst_invoice_no, c.date, c.due_date, (today - c.date).days if c.date else '', f(c.total), f(c.received), f(c.total) - f(c.received)])
    elif report_id == 'stock':
        from ..models import StockBalance
        latest = db.scalar(select(StockBalance.period_to).where(StockBalance.entity_id == entity).order_by(StockBalance.period_to.desc()).limit(1))
        w.writerow(['Plant', 'Material', 'From', 'To', 'Unit', 'Opening qty', 'Receipts', 'Issues', 'Closing qty', 'Opening value', 'Receipt value', 'Issue value', 'Closing value'])
        for b in db.scalars(select(StockBalance).where(StockBalance.entity_id == entity, StockBalance.period_to == latest).order_by(StockBalance.plant, StockBalance.material_code)):
            w.writerow([b.plant, b.material_code, b.period_from, b.period_to, b.uom, f(b.opening_qty), f(b.receipt_qty), f(b.issue_qty), f(b.closing_qty), f(b.opening_value), f(b.receipt_value), f(b.issue_value), f(b.closing_value)])
    elif report_id == 'audit':
        w.writerow(['At', 'User', 'Action', 'Target', 'Detail', 'IP'])
        for a in db.scalars(select(AuditLog).where(AuditLog.entity_id == entity).order_by(AuditLog.id.desc()).limit(5000)):
            w.writerow([ist(a.at), a.user_id or 'system', a.action, a.target, a.detail, a.ip or ''])
    else:
        raise HTTPException(404, 'Report not found')
    audit(db, u.id, entity, 'Exported report', report_id, request=request)
    db.commit()
    data = '﻿' + buf.getvalue()
    return StreamingResponse(iter([data]), media_type='text/csv', headers={'Content-Disposition': f'attachment; filename="{report_id}-{entity}-{today}.csv"'})
