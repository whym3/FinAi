"""The purchase-to-pay timeline and ledger for one PO, computed from which records exist."""
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import DispatchDoc, GoodsReceipt, Party, PurchaseOrder, SourceDocument, SupplierInvoice
from ..serialize import DOC_KIND_LABEL, f, iso

STAGES = [('negotiated', 'Negotiated terms'), ('po', 'SAP PO'), ('dispatch', 'Dispatch'), ('gate', 'Gate entry'), ('grn', 'GRN'), ('invoice', 'Invoice'),
          ('review', 'Invoice review'), ('posting', 'AP posting'), ('payment', 'Payment'), ('recon', 'Reconciled')]


def _d(d: date | None) -> str:
    return d.strftime('%d-%m-%Y') if d else ''


def po_view(db: Session, po: PurchaseOrder, today: date | None = None) -> tuple[list[dict], dict]:
    today = today or date.today()
    grns = list(db.scalars(select(GoodsReceipt).where(GoodsReceipt.po_id == po.id).order_by(GoodsReceipt.id)))
    invs = list(db.scalars(select(SupplierInvoice).where(SupplierInvoice.po_id == po.id).order_by(SupplierInvoice.id)))
    disp = list(db.scalars(select(DispatchDoc).where(DispatchDoc.po_id == po.id)))
    docs = list(db.scalars(select(SourceDocument).where(SourceDocument.po_id == po.id, SourceDocument.kind != 'bundle').order_by(SourceDocument.id)))
    vendor = db.get(Party, po.vendor_id) if po.vendor_id else None
    grn, inv = (grns[-1] if grns else None), (next((i for i in invs if i.status == 'needs-decision'), None) or (invs[-1] if invs else None))
    lr = next((d for d in disp if d.kind in ('lorry_receipt', 'eway_bill')), None)
    gate = next((d for d in disp if d.kind in ('weighbridge', 'gate_entry', 'consignment_note')), None)
    by_kind = lambda *ks: [d.filename for d in docs if d.kind in ks]

    def stage(key, name, state, d: date | None, ref: str, docs_: list[str], note: str = '', tone: str = 'none'):
        return {'key': key, 'name': name, 'state': state, 'date': _d(d), 'owner': '', 'ref': ref, 'docs': docs_, 'sla': {'tone': tone, 'label': note}}

    s = []
    s.append(stage('negotiated', 'Negotiated terms', 'done' if po.negotiation else 'ns', None, 'Recorded' if po.negotiation else 'Not recorded', [], 'Optional', 'none'))
    s.append(stage('po', 'SAP PO', 'done', po.date, f'PO {po.po_no}', by_kind('purchase_order'), 'From SAP register' if po.source == 'import' else 'From the PO document', 'ok'))
    d_date = (lr.date if lr else None) or (inv.date if inv and inv.ewaybill else None)
    d_ref = f'LR {lr.number}' if lr and lr.number else (f'E-way bill {inv.ewaybill}' if inv and inv.ewaybill else '')
    s.append(stage('dispatch', 'Dispatch', 'done' if (lr or (inv and inv.ewaybill)) else 'ns', d_date, d_ref, by_kind('lorry_receipt', 'eway_bill', 'delivery_challan', 'consignment_note'),
                   f'{lr.transporter} · {lr.vehicle}' if lr and lr.transporter else '', 'ok' if lr else 'none'))
    g_no = (grn.gate_entry_no if grn and grn.gate_entry_no else None) or (gate.number if gate else None)
    s.append(stage('gate', 'Gate entry', 'done' if (g_no or gate) else 'ns', (grn.gate_entry_date if grn and grn.gate_entry_date else None) or (gate.date if gate else None),
                   f'Gate entry {g_no}' if g_no else '', by_kind('weighbridge', 'gate_entry'), f'Net {f(gate.net_wt):,.0f} kg' if gate and gate.net_wt else '', 'ok' if (g_no or gate) else 'none'))
    s.append(stage('grn', 'GRN', 'done' if grn else 'ns', grn.date if grn else None, f'GRN {grn.grn_no}' if grn else '', by_kind('goods_receipt'),
                   f'{sum(f(l.accepted_qty) for l in grn.lines):,.0f} accepted' if grn else '', 'ok' if grn else 'none'))
    s.append(stage('invoice', 'Invoice', 'done' if inv else 'ns', inv.date if inv else None, inv.invoice_no if inv else '', by_kind('invoice'),
                   f'₹{f(inv.total):,.2f}' if inv else '', 'ok' if inv else 'none'))
    if inv:
        if inv.status == 'needs-decision':
            n = len(inv.match.get('flags', [])) if inv.match else 0
            s.append(stage('review', 'Invoice review', 'cur', None, f'{n} flag{"s" if n != 1 else ""}', [], f'Waiting {(today - (inv.received_at.date() if inv.received_at else today)).days} d', 'warn'))
        elif inv.status in ('held', 'rejected'):
            s.append(stage('review', 'Invoice review', 'blk', None, 'On hold' if inv.status == 'held' else 'Rejected', [], (inv.decision or {}).get('note', ''), 'bad'))
        else:
            s.append(stage('review', 'Invoice review', 'done', None, {'approved': 'Approved', 'dn-raised': 'Debit note raised', 'posted': 'Posted', 'paid': 'Paid'}.get(inv.status, inv.status), [], 'Decided', 'ok'))
    else:
        s.append(stage('review', 'Invoice review', 'ns', None, '', [], '', 'none'))
    s.append(stage('posting', 'AP posting', 'done' if inv and inv.sap_doc_no else 'ns', None, inv.sap_doc_no if inv and inv.sap_doc_no else 'SAP not connected', [], '', 'ok' if inv and inv.sap_doc_no else 'none'))
    s.append(stage('payment', 'Payment', 'done' if inv and inv.paid_on else 'ns', inv.paid_on if inv else None, f'UTR {inv.utr}' if inv and inv.utr else '', [], '', 'ok' if inv and inv.paid_on else 'none'))
    s.append(stage('recon', 'Reconciled', 'ns', None, 'Bank not connected', [], '', 'none'))
    # first not-started after the last done becomes "current / awaiting" unless review is already current
    if not any(x['state'] == 'cur' for x in s):
        last_done = max((i for i, x in enumerate(s) if x['state'] == 'done'), default=-1)
        for x in s[last_done + 1:]:
            if x['state'] == 'ns' and x['key'] not in ('negotiated',):
                x['state'] = 'cur'
                x['sla'] = {'tone': 'warn' if x['key'] in ('dispatch', 'grn', 'invoice') else 'none', 'label': 'Awaiting'}
                break

    # ledger per line
    gr_by_item, gr_by_idx = {}, []
    for g in grns:
        for i, l in enumerate(g.lines):
            if l.po_item:
                gr_by_item.setdefault(l.po_item, []).append(l)
            gr_by_idx.append(l)
    lines = []
    for i, pl in enumerate(po.lines):
        gls = gr_by_item.get(pl.item) or ([gr_by_idx[i]] if i < len(gr_by_idx) and not gr_by_item else [])
        received, accepted = sum(f(l.received_qty) for l in gls), sum(f(l.accepted_qty) for l in gls)
        invoiced = sum(f(il.qty) for iv in invs for j, il in enumerate(iv.lines) if (il.po_item == pl.item) or (not il.po_item and j == i))
        posted = invoiced if inv and inv.sap_doc_no else 0
        paid = invoiced if inv and inv.paid_on else 0
        lines.append({'line': str(pl.item), 'material': pl.description, 'materialNo': pl.material_code or '', 'hsn': pl.hsn or '', 'uom': pl.uom or '', 'rate': f(pl.rate),
                      'ordered': f(pl.qty), 'received': received, 'accepted': accepted, 'invoiced': invoiced, 'posted': posted, 'paid': paid, 'open': f(pl.open_qty) if pl.open_qty is not None else max(0.0, f(pl.qty) - received)})
    open_qty = sum(l['open'] for l in lines)
    open_value = sum(l['open'] * l['rate'] for l in lines)
    evidence = [{'id': str(d.id), 'title': DOC_KIND_LABEL.get(d.kind, d.kind), 'number': d.data.get('number') or (d.fields and next((x['value'] for x in d.fields if x['key'] in ('invoiceNo', 'poNo', 'grnNo', 'lrNo', 'ticketNo', 'number')), '')) or d.filename,
                 'date': d.received_at.strftime('%d-%m-%Y') if d.received_at else '', 'source': d.channel, 'linkedBy': 'Pravah', 'fileUrl': f'/api/files/{d.id}', 'kind': d.kind,
                 'check': {'tone': 'ok', 'label': 'Confirmed'} if d.confirmed_by else {'tone': 'none', 'label': 'Not checked yet'}} for d in docs]
    cur = next((x for x in s if x['state'] == 'cur'), None)
    blk = any(x['state'] == 'blk' for x in s)
    health = 'Blocked' if blk else 'Complete' if inv and inv.paid_on else ('Needs decision' if cur and cur['key'] == 'review' else 'In progress')
    msme = None
    if vendor and vendor.msme_class and (grn or inv):
        from datetime import timedelta
        acc = (grn.date if grn and grn.date else inv.date if inv else None) or today
        msme = {'acceptedOn': acc.isoformat(), 'limitOn': (acc + timedelta(days=45)).isoformat(), 'invoiceAsks': f'{inv.payment_terms_days} days' if inv and inv.payment_terms_days else None}
    agg = {'lines': lines, 'invoicedTaxable': sum(f(i.taxable) for i in invs), 'docs': evidence, 'openQty': open_qty, 'openValue': open_value,
           'sap': {'gateEntry': g_no, 'grn': grn.grn_no if grn else None, 'invoiceDoc': inv.sap_doc_no if inv else None, 'utr': inv.utr if inv else None},
           'msme': msme, 'invoiceId': str(inv.id) if inv else None, 'elapsedDays': (today - po.date).days if po.date else 0, 'health': health,
           'invoices': [{'id': str(i.id), 'invoiceNo': i.invoice_no, 'status': i.status, 'total': f(i.total)} for i in invs], 'grns': [g.grn_no for g in grns]}
    return s, agg


def po_health_label(stages: list[dict], agg: dict) -> dict:
    h = agg['health']
    return {'tone': 'bad' if h == 'Blocked' else 'warn' if h == 'Needs decision' else 'ok' if h == 'Complete' else 'acc', 'label': h}
