"""Overview KPIs, firm view, sidebar counts, global search and data-source freshness, all computed from the tables."""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..auth import current_user, require_entity, visible_entities
from ..config import settings
from ..db import get_db
from ..domain.calendar import deadlines
from ..models import (CloseTask, CustomerInvoice, Entity, ExceptionItem, GoodsReceipt, Import, Mailbox, Party, PoLine, PurchaseOrder, SapConnection, SourceDocument,
                      SupplierInvoice, User)
from ..serialize import f, ist, party_customer_out, party_vendor_out
from .parties import customer_aggregates, due_of, vendor_aggregates

router = APIRouter(prefix='/api', tags=['overview'])
UNPAID = ('approved', 'dn-raised', 'posted', 'needs-decision')


def _sources(db: Session, entity: str) -> list[dict]:
    """SyncState[] for the top bar: SAP (live or last export), GST portal, bank, email."""
    now = datetime.now()
    sap = db.scalar(select(SapConnection).where(SapConnection.entity_id == entity, SapConnection.status == 'active'))
    last_imp = db.scalar(select(Import).where(Import.entity_id == entity, Import.status == 'done', Import.kind.in_(('purchase_register', 'sales_register', 'grn_list', 'ar_open_items', 'ap_open_items', 'stock_movements')))
                         .order_by(Import.finished_at.desc()))
    if sap:
        sap_state = {'key': 'sap', 'label': 'SAP', 'system': 'SAP S/4HANA', 'at': ist(sap.last_sync_at), 'staleAfterH': max(2, sap.schedule_minutes * 2 / 60), 'error': sap.last_error}
    elif last_imp:
        sap_state = {'key': 'sap', 'label': 'SAP', 'system': 'SAP export', 'at': ist(last_imp.finished_at), 'staleAfterH': 24 * 35, 'detail': f'{last_imp.kind.replace("_", " ")} · {last_imp.filename}'}
    else:
        sap_state = {'key': 'sap', 'label': 'SAP', 'system': 'SAP', 'at': None, 'staleAfterH': 0, 'error': 'Not connected'}
    mb = db.scalar(select(Mailbox).where(Mailbox.entity_id == entity, Mailbox.status.in_(('active', 'error'))).order_by(Mailbox.last_sync_at.desc().nullslast()))
    return [sap_state,
            {'key': 'gst', 'label': 'GST', 'system': 'GST portal', 'at': None, 'staleAfterH': 0, 'error': 'Not connected'},
            {'key': 'bank', 'label': 'Bank', 'system': 'Bank feed', 'at': None, 'staleAfterH': 0, 'error': 'Not connected'},
            {'key': 'email', 'label': 'Email', 'system': 'Invoice mailbox', 'at': ist(mb.last_sync_at) if mb else None, 'staleAfterH': 1, 'error': (mb.last_error if mb else 'No mailbox connected')}]


@router.get('/sources')
def sources(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    return _sources(db, entity)


def _kpis(db: Session, entity: str, today: date) -> dict:
    vendors = {p.id: p for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'vendor'))}
    pos = db.scalars(select(PurchaseOrder).where(PurchaseOrder.entity_id == entity)).all()
    invs = db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity)).all()
    grns = db.scalars(select(GoodsReceipt).where(GoodsReceipt.entity_id == entity)).all()
    grn_with_inv = {i.grn_id for i in invs if i.grn_id}
    open_commit = open_pos = 0.0
    for po in pos:
        v = 0.0
        for l in po.lines:
            open_q = f(l.open_qty) if l.open_qty is not None else f(l.qty)
            v += open_q * f(l.rate)
        if v > 0:
            open_commit += v
            open_pos += 1
    grni = 0.0
    po_rates = {(l.po_id, l.item): f(l.rate) for po in pos for l in po.lines}
    for g in grns:
        if g.id in grn_with_inv:
            continue
        for l in g.lines:
            grni += f(l.accepted_qty) * po_rates.get((g.po_id, l.po_item), 0.0)
    ap_out = due7 = due15 = due30 = overdue = 0.0
    n_ap = n_due7 = n_overdue = 0
    msme_near, n_msme, msme_first = 0.0, 0, None
    for i in invs:
        if i.status not in UNPAID or i.paid_on:
            continue
        amt = f(i.total)
        if i.status != 'needs-decision':
            ap_out += amt
            n_ap += 1
        d = due_of(i, vendors.get(i.vendor_id))
        if d:
            left = (d - today).days
            if left < 0:
                overdue += amt
                n_overdue += 1
            else:
                if left <= 7:
                    due7 += amt
                    n_due7 += 1
                if left <= 15:
                    due15 += amt
                if left <= 30:
                    due30 += amt
        m = (i.match or {}).get('msme')
        if m and m.get('daysLeft') is not None and m['daysLeft'] <= 10:
            msme_near += amt
            n_msme += 1
            msme_first = min(msme_first or m['payBy'], m['payBy'])
    cis = db.scalars(select(CustomerInvoice).where(CustomerInvoice.entity_id == entity)).all()
    ar_out = ar_over = 0.0
    n_ar = n_ar_over = n_cust = 0
    customers = set()
    sales_90 = 0.0
    for c in cis:
        sign = -1 if c.doc_type == 'credit_memo' else 1
        open_amt = sign * (f(c.total) - f(c.received))
        if c.date and (today - c.date).days <= 90:
            sales_90 += sign * f(c.total)
        if open_amt <= 0:
            continue
        ar_out += open_amt
        n_ar += 1
        customers.add(c.customer_id)
        if c.due_date and c.due_date < today:
            ar_over += open_amt
            n_ar_over += 1
    purchases_90 = sum(f(i.total) for i in invs if i.date and (today - i.date).days <= 90)
    dso = round(ar_out / (sales_90 / 90)) if sales_90 > 0 else None
    dpo = round(ap_out / (purchases_90 / 90)) if purchases_90 > 0 else None
    exs = db.scalars(select(ExceptionItem).where(ExceptionItem.entity_id == entity, ExceptionItem.status != 'resolved')).all()
    crit = [x for x in exs if x.priority in ('Critical', 'High')]
    breakdown: dict[str, int] = {}
    for x in exs:
        breakdown[x.type] = breakdown.get(x.type, 0) + 1
    labels = {'hsn': 'HSN differs from PO', 'rate': 'Rate above PO', 'vehicle': 'Vehicle differs', 'irn': 'Missing IRN', 'freight': 'Freight not agreed', 'grn': 'GRN missing', 'po': 'PO missing',
              'terms': 'Payment terms', 'qty': 'Quantity differs', 'gstin': 'GSTIN issue', 'total': 'Total differs', 'tax': 'Tax rate', 'taxtype': 'Tax type', 'billto': 'Bill-to GSTIN'}
    return {
        'kpiPay': [
            {'id': 'po', 'label': 'Open PO commitments', 'value': open_commit, 'sub': f'{int(open_pos):,} open POs · {len(vendors):,} vendors', 'source': 'SAP', 'syncKey': 'sap', 'link': '/p2p'},
            {'id': 'grni', 'label': 'Goods received, not invoiced', 'value': grni, 'sub': f'{len(grns) - len(grn_with_inv):,} GRNs without invoice', 'source': 'SAP', 'syncKey': 'sap', 'link': '/p2p'},
            {'id': 'ap', 'label': 'Posted AP outstanding', 'value': ap_out, 'sub': f'{n_ap:,} invoices approved, not paid', 'source': 'Extracted', 'syncKey': 'sap', 'link': '/payables'},
            {'id': 'due7', 'label': 'Due next 7 days', 'value': due7, 'sub': f'{n_due7:,} invoices · 15 d ₹{due15 / 1e5:,.1f} L · 30 d ₹{due30 / 1e5:,.1f} L', 'source': 'Extracted', 'syncKey': 'sap', 'link': '/payables'},
            {'id': 'apod', 'label': 'Overdue payables', 'value': overdue, 'sub': f'{n_overdue:,} invoices past terms', 'source': 'Extracted', 'syncKey': 'sap', 'tone': 'bad' if overdue else None, 'status': 'Overdue' if overdue else None, 'link': '/payables'},
            {'id': 'msme', 'label': 'MSME dues near 45-day limit', 'value': msme_near, 'sub': f'{n_msme:,} invoices' + (f' · first limit {msme_first}' if msme_first else ''), 'source': 'Extracted', 'syncKey': 'sap', 'tone': 'warn' if n_msme else None, 'link': '/msme'},
        ],
        'kpiRec': [
            {'id': 'ar', 'label': 'Receivables outstanding', 'value': ar_out, 'sub': f'{n_ar:,} invoices · {len(customers):,} customers', 'source': 'SAP', 'syncKey': 'sap', 'link': '/receivables'},
            {'id': 'arod', 'label': 'Overdue receivables', 'value': ar_over, 'sub': f'{n_ar_over:,} invoices past due date', 'source': 'SAP', 'syncKey': 'sap', 'tone': 'bad' if ar_over else None, 'link': '/receivables'},
            {'id': 'dso', 'label': 'Days sales outstanding (DSO)', 'value': dso or 0, 'unit': 'days', 'sub': 'Outstanding ÷ daily sales (90 d)' if dso else 'Needs 90 days of sales', 'source': 'SAP', 'syncKey': 'sap', 'link': '/receivables'},
            {'id': 'dpo', 'label': 'Days payables outstanding (DPO)', 'value': dpo or 0, 'unit': 'days', 'sub': 'AP ÷ daily purchases (90 d)' if dpo else 'Needs 90 days of purchases', 'source': 'Extracted', 'syncKey': 'sap', 'link': '/payables'},
            {'id': 'bank', 'label': 'Bank balance', 'value': 0, 'sub': 'Bank feed not connected', 'source': 'Bank', 'syncKey': 'bank', 'tone': 'none', 'status': 'Not connected', 'link': '/bank'},
            {'id': 'itc', 'label': 'ITC at risk', 'value': 0, 'sub': 'GST portal not connected', 'source': 'GST portal', 'syncKey': 'gst', 'tone': 'none', 'status': 'Not connected', 'link': '/gst'},
        ],
        'critical': {'open': len(crit), 'pastSla': sum(1 for x in exs if x.due and x.due < today), 'blocked': sum(1 for x in exs if x.blocks),
                     'breakdown': sorted([{'label': labels.get(t, t), 'n': n, 'type': t} for t, n in breakdown.items()], key=lambda b: -b['n'])[:6]},
        '_invs': invs, '_cis': cis, '_vendors': vendors, '_overdue': overdue, '_msme': n_msme, '_critical': len(crit),
    }


def _forecast(invs, cis, vendors, today: date) -> dict:
    weeks = []
    start = today - timedelta(days=today.weekday())
    for w in range(13):
        a, b = start + timedelta(days=7 * w), start + timedelta(days=7 * w + 6)
        outflow = sum(f(i.total) for i in invs if i.status in UNPAID and not i.paid_on and (due_of(i, vendors.get(i.vendor_id)) or today) and a <= max(due_of(i, vendors.get(i.vendor_id)) or today, today) <= b)
        inflow = sum((f(c.total) - f(c.received)) * (-1 if c.doc_type == 'credit_memo' else 1) for c in cis if (f(c.total) - f(c.received)) > 0 and c.due_date and a <= max(c.due_date, today) <= b)
        weeks.append({'week': a.isoformat(), 'inflow': round(inflow, 2), 'outflow': round(outflow, 2)})
    return {'opening': 0, 'minimum': 0, 'weeks': weeks}


def _ageing(invs, cis, vendors, today: date) -> tuple[list, list]:
    ap = [{'bucket': '< 1 year', 'msme': 0.0, 'others': 0.0}, {'bucket': '1–2 years', 'msme': 0.0, 'others': 0.0}, {'bucket': '2–3 years', 'msme': 0.0, 'others': 0.0}, {'bucket': '> 3 years', 'msme': 0.0, 'others': 0.0}]
    for i in invs:
        if i.status not in UNPAID or i.paid_on or not i.date:
            continue
        yrs = (today - i.date).days / 365
        row = ap[0 if yrs < 1 else 1 if yrs < 2 else 2 if yrs < 3 else 3]
        v = vendors.get(i.vendor_id)
        row['msme' if v and v.msme_class else 'others'] += f(i.total)
    ar = [{'bucket': b, 'amount': 0.0} for b in ('< 6 months', '6 m – 1 yr', '1–2 years', '2–3 years', '> 3 years')]
    for c in cis:
        open_amt = f(c.total) - f(c.received)
        if open_amt <= 0 or not c.date or c.doc_type == 'credit_memo':
            continue
        m = (today - c.date).days / 30.4
        ar[0 if m < 6 else 1 if m < 12 else 2 if m < 24 else 3 if m < 36 else 4]['amount'] += open_amt
    return ap, ar


@router.get('/overview')
def overview(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    today = date.today()
    k = _kpis(db, entity, today)
    invs, cis, vendors = k.pop('_invs'), k.pop('_cis'), k.pop('_vendors')
    for key in ('_overdue', '_msme', '_critical'):
        k.pop(key, None)
    ap_age, ar_age = _ageing(invs, cis, vendors, today)
    has_data = bool(invs or cis or db.scalar(select(PurchaseOrder.id).where(PurchaseOrder.entity_id == entity)))
    snapshot = {'entityId': entity, 'asOf': datetime.now().strftime('%Y-%m-%dT%H:%M'), **k, 'cash': _forecast(invs, cis, vendors, today) if has_data else {'opening': 0, 'minimum': 0, 'weeks': []},
                'apAgeing': ap_age, 'apNote': 'From invoice date · MSME per vendor Udyam class', 'arAgeing': ar_age, 'arNote': 'From invoice date · collections not imported assume unpaid'}
    vagg, cagg = vendor_aggregates(db, entity, today), customer_aggregates(db, entity, today)
    top_v = sorted(vendors.values(), key=lambda p: -vagg.get(p.id, {}).get('outstanding', 0))[:10]
    custs = {p.id: p for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'customer'))}
    top_c = sorted((p for p in custs.values() if cagg.get(p.id, {}).get('overdue', 0) > 0), key=lambda p: -cagg[p.id]['overdue'])[:10]
    return {'snapshot': snapshot, 'deadlines': deadlines(entity, today), 'vendors': [party_vendor_out(p, vagg.get(p.id)) for p in top_v if vagg.get(p.id, {}).get('outstanding')],
            'customers': [party_customer_out(p, cagg.get(p.id)) for p in top_c], 'pendingRun': None, 'sources': _sources(db, entity), 'hasData': has_data}


@router.get('/overview/firm')
def firm_overview(u: User = Depends(current_user), db: Session = Depends(get_db)):
    today = date.today()
    rows, filing = [], []
    for e in visible_entities(db, u):
        k = _kpis(db, e.id, today)
        dl = deadlines(e.id, today)
        close_open = db.scalar(select(func.count(CloseTask.id)).where(CloseTask.entity_id == e.id, CloseTask.period == today.strftime('%Y-%m'), CloseTask.done.is_(False))) or 0
        rows.append({'entityId': e.id, 'entity': {'id': e.id, 'name': e.legal_name, 'shortName': e.short_name, 'city': e.city, 'risk': 'Low', 'riskScore': 0, 'gstins': [{'gstin': g.gstin, 'code': g.state_code, 'state': g.state} for g in e.gstins], 'pan': e.pan},
                     'overduePayables': k['_overdue'], 'msme': k['_msme'], 'msmeLabel': f'{k["_msme"]} near limit' if k['_msme'] else 'None near limit', 'msmeTone': 'warn' if k['_msme'] else 'ok',
                     'imsPending': 0, 'mismatch': 0, 'tdsDue': 0, 'critical': k['_critical'],
                     'close': {'tone': 'warn' if close_open else 'none', 'label': f'{close_open} tasks open' if close_open else 'Not started'}, 'closeSub': 'GST portal and TDS not connected'})
        filing.append({'entityId': e.id, 'cells': [{'tone': 'none', 'label': 'Not started'} for _ in dl[:5]]})
    heads = [f'{d["name"]} · {d["due"][8:10]}-{d["due"][5:7]}-{d["due"][:4]}' for d in (deadlines('x', today)[:5])]
    rows.sort(key=lambda r: (-r['critical'], -r['overduePayables']))
    return {'rows': rows, 'filing': filing, 'filingHeads': heads}


@router.get('/counts')
def counts(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    today = date.today()
    sd = select(func.count(SourceDocument.id)).where(SourceDocument.entity_id == entity, SourceDocument.bundle_id.is_(None))
    exs = db.scalars(select(ExceptionItem).where(ExceptionItem.entity_id == entity, ExceptionItem.status != 'resolved')).all()
    invs = db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity)).all()
    vendors = {p.id: p for p in db.scalars(select(Party).where(Party.entity_id == entity, Party.kind == 'vendor'))}
    cis_over = db.scalar(select(func.count(CustomerInvoice.id)).where(CustomerInvoice.entity_id == entity, CustomerInvoice.due_date < today, CustomerInvoice.total > CustomerInvoice.received, CustomerInvoice.doc_type == 'invoice')) or 0
    return {
        'intake': db.scalar(sd.where(SourceDocument.status == 'new')) or 0, 'intakeReview': db.scalar(sd.where(SourceDocument.status == 'review')) or 0,
        'p2p': db.scalar(select(func.count(func.distinct(SourceDocument.po_id))).where(SourceDocument.entity_id == entity, SourceDocument.po_id.is_not(None))) or 0,
        'review': sum(1 for i in invs if i.status == 'needs-decision'), 'exceptions': len(exs), 'critical': sum(1 for x in exs if x.priority == 'Critical'),
        'payables': sum(1 for i in invs if i.status in UNPAID and not i.paid_on and (due_of(i, vendors.get(i.vendor_id)) or today) <= today + timedelta(days=7)),
        'receivables': cis_over, 'bank': 0, 'gst': 0, 'tds': 0,
        'msme': sum(1 for i in invs if (i.match or {}).get('msme') and not i.paid_on and (i.match['msme'].get('daysLeft') if i.match['msme'].get('daysLeft') is not None else 99) <= 10),
        'close': db.scalar(select(func.count(CloseTask.id)).where(CloseTask.entity_id == entity, CloseTask.period == today.strftime('%Y-%m'), CloseTask.done.is_(False))) or 0,
        'vendors': sum(1 for v in vendors.values() if v.blocked),
        'imports': db.scalar(select(func.count(Import.id)).where(Import.entity_id == entity, Import.status.in_(('detected', 'failed')))) or 0,
    }


@router.get('/search')
def search(entity: str, q: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    q = q.strip()
    if len(q) < 2:
        return []
    like = f'%{q}%'
    hits = []
    for i in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity, or_(SupplierInvoice.invoice_no.ilike(like), SupplierInvoice.irn.ilike(like), SupplierInvoice.vendor_name.ilike(like), SupplierInvoice.ewaybill.ilike(like))).limit(8)):
        hits.append({'kind': 'Invoices', 'label': i.invoice_no, 'sub': f'{i.vendor_name} · ₹{f(i.total):,.2f} · {i.status}', 'route': f'/review/{i.id}'})
    for po in db.scalars(select(PurchaseOrder).where(PurchaseOrder.entity_id == entity, or_(PurchaseOrder.po_no.ilike(like), PurchaseOrder.vendor_name.ilike(like))).limit(8)):
        hits.append({'kind': 'Purchase orders', 'label': f'PO {po.po_no}', 'sub': f'{po.vendor_name} · ₹{f(po.total):,.2f}', 'route': f'/p2p/{po.id}'})
    for g in db.scalars(select(GoodsReceipt).where(GoodsReceipt.entity_id == entity, or_(GoodsReceipt.grn_no.ilike(like), GoodsReceipt.gate_entry_no.ilike(like), GoodsReceipt.vehicle.ilike(like))).limit(5)):
        hits.append({'kind': 'Goods receipts', 'label': f'GRN {g.grn_no}', 'sub': f'{g.vendor_name} · PO {g.po_ref}', 'route': f'/p2p/{g.po_id}' if g.po_id else '/p2p'})
    for p in db.scalars(select(Party).where(Party.entity_id == entity, or_(Party.name.ilike(like), Party.gstin.ilike(like), Party.code.ilike(like))).limit(8)):
        hits.append({'kind': 'Vendors' if p.kind == 'vendor' else 'Customers', 'label': p.name, 'sub': f'{p.code or ""} {p.gstin or ""}'.strip(), 'route': f'/vendors/{p.id}' if p.kind == 'vendor' else '/customers'})
    for c in db.scalars(select(CustomerInvoice).where(CustomerInvoice.entity_id == entity, or_(CustomerInvoice.invoice_no.ilike(like), CustomerInvoice.gst_invoice_no.ilike(like))).limit(5)):
        hits.append({'kind': 'Customer invoices', 'label': c.gst_invoice_no or c.invoice_no, 'sub': f'₹{f(c.total):,.2f} · {c.date}', 'route': '/receivables'})
    for x in db.scalars(select(ExceptionItem).where(ExceptionItem.entity_id == entity, or_(ExceptionItem.title.ilike(like), ExceptionItem.doc_ref.ilike(like))).limit(5)):
        hits.append({'kind': 'Exceptions', 'label': f'EX-{x.id} · {x.title}', 'sub': x.status, 'route': f'/exceptions?ex=EX-{x.id}'})
    return hits[:30]
