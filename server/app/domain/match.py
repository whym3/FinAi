"""Three-way match: Negotiated · PO · GRN · Invoice · SAP posted. Differences become flags and exceptions, never verdicts."""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import users_with_role
from ..models import AppSetting, DispatchDoc, Entity, ExceptionItem, ExceptionRule, GoodsReceipt, Party, PurchaseOrder, SupplierInvoice
from ..notify import notify
from ..serialize import f
from ..validate import STATES, check_gstin

DEFAULT_TOL = {'qty_pct': 0.0, 'rate_pct': 0.5, 'tax_inr': 1.0, 'total_inr': 10.0, 'freight_inr': 0.0}
NA = {'s': 'na'}


def tolerances(db: Session, entity_id: str) -> dict:
    for scope in (entity_id, ''):
        s = db.scalar(select(AppSetting).where(AppSetting.scope == scope, AppSetting.key == 'tolerances'))
        if s:
            return {**DEFAULT_TOL, **s.value}
    return dict(DEFAULT_TOL)


def money(v) -> str:
    return f'{f(v):,.2f}'


def _cell(v, ref=None, num=False, tol_abs=0.0, tol_pct=0.0, missing='none'):
    if v in (None, ''):
        return {'s': missing}
    c = {'s': 'ok', 'v': money(v) if num else str(v), **({'num': True} if num else {})}
    if ref in (None, ''):
        return c
    if num:
        a, b = f(v), f(ref)
        diff = a - b
        if abs(diff) <= max(tol_abs, abs(b) * tol_pct / 100):
            c['s'] = 'ok' if diff == 0 else 'warn'
        else:
            c['s'] = 'bad'
        if diff:
            c['d'] = f'{"+" if diff > 0 else "−"}{abs(diff):,.2f}'
    else:
        c['s'] = 'ok' if str(v).strip().upper() == str(ref).strip().upper() else 'bad'
    return c


def _pair_lines(inv: SupplierInvoice, po: PurchaseOrder | None, grn: GoodsReceipt | None):
    po_lines = list(po.lines) if po else []
    gr_lines = list(grn.lines) if grn else []
    for i, il in enumerate(inv.lines):
        pl = None
        if po_lines:
            if len(po_lines) == len(inv.lines):
                pl = po_lines[i]
            else:
                pl = next((p for p in po_lines if p.hsn and p.hsn == il.hsn and f(p.rate) == f(il.rate)), None) or \
                     next((p for p in po_lines if f(p.rate) == f(il.rate)), None) or (po_lines[i] if i < len(po_lines) else None)
        gl = None
        if gr_lines:
            gl = next((g for g in gr_lines if pl and g.po_item and g.po_item == pl.item), None) or (gr_lines[i] if i < len(gr_lines) else None)
        yield il, pl, gl


def run_match(db: Session, inv: SupplierInvoice, today: date | None = None) -> None:
    today = today or date.today()
    ent = db.get(Entity, inv.entity_id)
    po = db.get(PurchaseOrder, inv.po_id) if inv.po_id else None
    grn = db.get(GoodsReceipt, inv.grn_id) if inv.grn_id else None
    vendor = db.get(Party, inv.vendor_id) if inv.vendor_id else None
    po_vendor = db.get(Party, po.vendor_id) if po and po.vendor_id else None
    dispatch = list(db.scalars(select(DispatchDoc).where(DispatchDoc.entity_id == inv.entity_id, (DispatchDoc.po_id == inv.po_id) if inv.po_id else (DispatchDoc.invoice_ref == inv.invoice_no))))
    lr = next((d for d in dispatch if d.kind in ('lorry_receipt', 'eway_bill')), None)
    tol = tolerances(db, inv.entity_id)
    rows, flags, dn_lines = [], [], []
    neg = po.negotiation if po and po.negotiation else None

    heads = [
        {'title': 'Negotiated', 'ref': 'Recorded terms' if neg else 'Not recorded', 'source': 'Upload', 'when': ''},
        {'title': 'PO', 'ref': po.po_no if po else 'No PO', 'source': 'SAP' if po and po.source in ('import', 'sap') else 'Extracted', 'when': po.date.strftime('%d-%m-%Y') if po and po.date else ''},
        {'title': 'GRN', 'ref': grn.grn_no if grn else 'No GRN', 'source': 'Extracted' if grn else 'SAP', 'when': grn.date.strftime('%d-%m-%Y') if grn and grn.date else ''},
        {'title': 'Invoice', 'ref': inv.invoice_no, 'source': 'Extracted', 'when': inv.date.strftime('%d-%m-%Y') if inv.date else ''},
        {'title': 'SAP posted', 'ref': inv.sap_doc_no or 'Not connected', 'source': 'SAP', 'when': ''},
    ]

    def add(field, po_v=None, grn_v=None, inv_v=None, num=False, ta=0.0, tp=0.0, grn_ref=None, key=None):
        cells = [NA if not neg else _cell(neg.get(key) if key else None), _cell(po_v, num=num), _cell(grn_v, grn_ref, num=num, tol_abs=ta, tol_pct=tp), _cell(inv_v, po_v if po_v not in (None, '') else grn_v, num=num, tol_abs=ta, tol_pct=tp), NA]
        rows.append({'field': field, 'cells': cells})
        return cells[3]

    def flag(key, title, detail, usual, amount=0.0, reason='Query vendor'):
        flags.append({'id': key, 'key': key, 'title': title, 'detail': detail, 'usual': usual, 'amount': round(amount, 2), 'reason': reason})

    # header rows
    add('Supplier & GSTIN', po_vendor.gstin if po_vendor else None, grn.vendor_name if grn else None, f'{inv.vendor_name} · {inv.supplier_gstin or "no GSTIN"}' if inv.vendor_name else inv.supplier_gstin)
    rows[-1]['cells'][3]['s'] = 'ok' if not po_vendor or not po_vendor.gstin or po_vendor.gstin == inv.supplier_gstin else 'bad'
    if inv.supplier_gstin:
        chk = check_gstin(inv.supplier_gstin)
        if chk['errors']:
            rows[-1]['cells'][3]['s'] = 'bad'
            flag('gstin', 'Supplier GSTIN invalid', chk['errors'][0], 'Valid 15-character GSTIN', reason='Query vendor')
    if po_vendor and po_vendor.gstin and inv.supplier_gstin and po_vendor.gstin != inv.supplier_gstin:
        flag('gstin', 'Supplier GSTIN differs from PO vendor', f'Invoice {inv.supplier_gstin}, PO vendor {po_vendor.gstin}', 'Same GSTIN on PO and invoice')

    ent_gstins = {g.gstin: g for g in ent.gstins} if ent else {}
    c = add('Bill-to GSTIN', None, None, inv.bill_to_gstin)
    if inv.bill_to_gstin and ent_gstins and inv.bill_to_gstin not in ent_gstins:
        c['s'] = 'bad'
        flag('billto', 'Bill-to GSTIN is not ours', f'{inv.bill_to_gstin} is not a registration of {ent.short_name}', ', '.join(ent_gstins) or '—', reason='Query vendor')
    pos = inv.place_of_supply or ''
    pos_code = pos[:2] if pos[:2].isdigit() else next((k for k, v in STATES.items() if v.lower() in pos.lower()), None)
    c = add('Place of supply', None, None, pos or None)
    if pos_code and inv.bill_to_gstin and inv.bill_to_gstin[:2] != pos_code:
        c['s'] = 'warn'
    add('Invoice no. / date', None, f'{grn.invoice_ref or ""} {grn.invoice_date.strftime("%d-%m-%Y") if grn and grn.invoice_date else ""}'.strip() or None if grn else None,
        f'{inv.invoice_no} · {inv.date.strftime("%d-%m-%Y") if inv.date else "no date"}')
    rows[-1]['cells'][2]['s'] = 'ok' if not grn or not grn.invoice_ref or grn.invoice_ref.endswith(inv.invoice_no.split('/')[-1]) else 'bad'
    rows[-1]['cells'][3]['s'] = 'ok'
    c = add('IRN', None, None, (inv.irn[:16] + '…') if inv.irn else None)
    if not inv.irn:
        flag('irn', 'No IRN on invoice', 'E-invoice reference number is missing; required if the supplier is above the e-invoice threshold', 'IRN + signed QR', reason='Query vendor')
    add('E-way bill', None, grn.ewaybill if grn else None, inv.ewaybill, grn_ref=None)
    if inv.ewaybill and grn and grn.ewaybill and grn.ewaybill != inv.ewaybill:
        rows[-1]['cells'][3]['s'] = 'bad'
    vehicles = {d.vehicle for d in dispatch if d.vehicle} | ({grn.vehicle} if grn and grn.vehicle else set())
    c = add('Vehicle', None, grn.vehicle if grn else None, inv.vehicle)
    if inv.vehicle and vehicles and inv.vehicle not in vehicles:
        c['s'] = 'bad'
        flag('vehicle', 'Vehicle differs from dispatch documents', f'Invoice shows {inv.vehicle}; LR / gate / GRN show {", ".join(sorted(vehicles))}. Possible transshipment.', 'Same vehicle end to end', reason='Accept with note')

    # line rows
    rate_amount = 0.0
    for il, pl, gl in _pair_lines(inv, po, grn):
        n = f' (line {il.line_no})' if len(inv.lines) > 1 else ''
        add('Item text' + n, pl.description if pl else None, gl.description if gl else None, il.description)
        rows[-1]['cells'][3]['s'] = 'ok' if pl else 'none'
        rows[-1]['cells'][2]['s'] = 'ok' if gl else 'none'
        c = add('HSN' + n, pl.hsn if pl else None, gl.hsn if gl else None, il.hsn)
        if pl and pl.hsn and il.hsn and pl.hsn != il.hsn:
            flag('hsn', 'HSN differs from PO', f'Invoice HSN {il.hsn}, PO HSN {pl.hsn}' + (f', GRN HSN {gl.hsn}' if gl and gl.hsn else ''), f'HSN {pl.hsn}', reason='Query vendor')
        c = add('Qty' + n, pl.qty if pl else None, gl.accepted_qty if gl else None, il.qty, num=True, tp=tol['qty_pct'])
        if pl and f(il.qty) > f(gl.accepted_qty if gl else pl.qty) + 1e-6:
            over = f(il.qty) - f(gl.accepted_qty if gl else pl.qty)
            flag('qty', 'Invoiced quantity exceeds ' + ('received' if gl else 'ordered'), f'{f(il.qty):,.3f} invoiced vs {f(gl.accepted_qty if gl else pl.qty):,.3f}', 'Invoice ≤ accepted quantity', amount=over * f(il.rate), reason='Debit note')
        add('UoM' + n, pl.uom if pl else None, gl.uom if gl else None, il.uom)
        c = add('Rate' + n, pl.rate if pl else None, None, il.rate, num=True, tp=tol['rate_pct'])
        if pl and f(il.rate) > f(pl.rate) * (1 + tol['rate_pct'] / 100) + 1e-9:
            diff = (f(il.rate) - f(pl.rate)) * f(il.qty)
            rate_amount += diff
            flag('rate', 'Rate above PO', f'₹{f(il.rate):,.2f} on invoice vs ₹{f(pl.rate):,.2f} on PO × {f(il.qty):,.0f}', f'₹{f(pl.rate):,.2f}', amount=diff, reason='Debit note')
            dn_lines.append({'text': f'Rate difference{n}: ₹{f(il.rate):,.2f} − ₹{f(pl.rate):,.2f} × {f(il.qty):,.0f}', 'taxable': round(diff, 2), 'gst': round(diff * f(il.tax_rate or pl.tax_rate or 0) / 100, 2)})
        add('Taxable' + n, pl.amount if pl else None, None, il.taxable, num=True, ta=tol['tax_inr'])
        po_tax, inv_tax = (f(pl.tax_rate) if pl and pl.tax_rate is not None else None), (f(il.tax_rate) if il.tax_rate is not None else None)
        c = add('Tax rate' + n, f'{po_tax:g}%' if po_tax is not None else None, None, f'{inv_tax:g}%' if inv_tax is not None else None)
        if po_tax is not None and inv_tax is not None and po_tax != inv_tax:
            flag('tax', 'GST rate differs from PO', f'{inv_tax:g}% on invoice vs {po_tax:g}% on PO', f'{po_tax:g}%', reason='Query vendor')

    # tax type
    intra = inv.supplier_gstin and inv.bill_to_gstin and inv.supplier_gstin[:2] == inv.bill_to_gstin[:2]
    tax_type = 'CGST + SGST' if f(inv.cgst) or f(inv.sgst) else 'IGST' if f(inv.igst) else '—'
    expected = ('CGST + SGST' if intra else 'IGST') if inv.supplier_gstin and inv.bill_to_gstin else None
    c = add('Tax type', expected, None, tax_type)
    if expected and tax_type != '—' and tax_type != expected:
        c['s'] = 'bad'
        flag('taxtype', f'{tax_type} charged on an {"intra" if intra else "inter"}-state supply', f'Supplier state {inv.supplier_gstin[:2]}, bill-to state {inv.bill_to_gstin[:2]}', expected, reason='Query vendor')
    for k, lbl in (('cgst', 'CGST'), ('sgst', 'SGST'), ('igst', 'IGST')):
        if f(getattr(inv, k)):
            add(lbl, None, None, getattr(inv, k), num=True)
    # freight
    terms = (po.freight_terms or '').upper() if po else ''
    freight_po = 'Extra as actual' if 'EXTRA' in terms or 'ACTUAL' in terms else 'Included' if ('FOR' in terms or 'INCLUD' in terms or 'FREE' in terms) else (po.freight_terms if po else None)
    c = add('Freight / P&F', freight_po, None, inv.freight if f(inv.freight) else '0.00', num=False)
    c['s'] = 'ok'
    if f(inv.freight) > tol['freight_inr'] and freight_po == 'Included':
        c['s'] = 'bad'
        flag('freight', 'Freight charged although included', f'₹{money(inv.freight)} charged; PO terms "{po.freight_terms}"', 'No freight line', amount=f(inv.freight), reason='Debit note')
        dn_lines.append({'text': f'Freight not agreed: {po.freight_terms}', 'taxable': f(inv.freight), 'gst': round(f(inv.freight) * 0.18, 2)})
    po_total = f(po.total) if po and len(po.lines) == len(inv.lines) else None
    c = add('Total', po_total, None, inv.total, num=True, ta=tol['total_inr'])
    if po_total is not None and abs(f(inv.total) - po_total) > tol['total_inr'] and not flags:
        flag('total', 'Invoice total differs from PO', f'₹{money(inv.total)} vs PO ₹{money(po_total)}', f'₹{money(po_total)}', amount=f(inv.total) - po_total)
    c = add('Payment terms', f'{po.payment_terms_days} days' if po and po.payment_terms_days else None, None, f'{inv.payment_terms_days} days' if inv.payment_terms_days else None)
    if po and po.payment_terms_days and inv.payment_terms_days and inv.payment_terms_days < po.payment_terms_days:
        c['s'] = 'bad'
        flag('terms', 'Payment terms shorter than agreed', f'{inv.payment_terms_days} days on invoice vs {po.payment_terms_days} days on PO', f'{po.payment_terms_days} days', reason='Accept with note')
    if not po:
        flag('po', 'No purchase order found', f'PO reference "{inv.po_ref or "none"}" is not in the PO register or the uploaded documents', 'Invoice quotes a known PO', reason='Hold')
    if po and not grn:
        flag('grn', 'No goods receipt yet', 'The invoice arrived before the GRN; hold until stores confirm receipt', 'GRN before invoice', reason='Hold')

    # MSME clock (acceptance = GRN date, else invoice date)
    msme = None
    if vendor and vendor.msme_class:
        accepted = (grn.date if grn and grn.date else inv.date) or today
        limit = min(45, inv.payment_terms_days or po.payment_terms_days if po and po.payment_terms_days else 45)
        pay_by = accepted + timedelta(days=limit)
        msme = {'daysLeft': (pay_by - today).days, 'acceptedOn': accepted.isoformat(), 'payBy': pay_by.isoformat(), 'recommended': 'Pay in the next run',
                'note': f'{vendor.msme_class} enterprise · {limit}-day limit from acceptance'}
    inv.match = {'heads': heads, 'rows': rows, 'flags': flags, 'msme': msme}
    inv.dn_lines = dn_lines
    _sync_exceptions(db, inv, flags, today)


def _sync_exceptions(db: Session, inv: SupplierInvoice, flags: list[dict], today: date) -> None:
    rules = {r.type: r for r in db.scalars(select(ExceptionRule))}
    existing = {x.flag_key: x for x in db.scalars(select(ExceptionItem).where(ExceptionItem.invoice_id == inv.id))}
    for fl in flags:
        rule = rules.get(fl['key'])
        if rule and not rule.enabled:
            continue
        if fl['key'] in existing:
            fl['exceptionId'] = f'EX-{existing[fl["key"]].id}'
            continue
        owners = users_with_role(db, inv.entity_id, {rule.default_role if rule else 'ap'})
        x = ExceptionItem(entity_id=inv.entity_id, rule_id=rule.id if rule else None, type=fl['key'], title=f'{fl["title"]} · {inv.invoice_no}', doc_ref=inv.invoice_no,
                          doc_route=f'/review/{inv.id}', owner_id=owners[0].id if owners else None, priority=rule.priority if rule else 'Medium',
                          due=today + timedelta(days=rule.sla_days if rule else 3), amount=fl['amount'], invoice_id=inv.id, po_id=inv.po_id, vendor_id=inv.vendor_id,
                          flag_key=fl['key'], evidence_note=fl['detail'], sources=[{'source': 'Extracted', 'text': 'invoice'}] + ([{'source': 'SAP', 'text': 'PO'}] if inv.po_id else []),
                          history=[{'at': today.isoformat(), 'text': f'Raised by the three-way match: {fl["detail"]}'}])
        db.add(x)
        db.flush()
        fl['exceptionId'] = f'EX-{x.id}'
        existing[fl['key']] = x
        notify(db, inv.entity_id, f'{fl["title"]}', f'{inv.invoice_no} · {inv.vendor_name}', f'/exceptions?ex=EX-{x.id}', 'warn')
