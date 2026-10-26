"""Turns an extracted document into PO / GRN / invoice / dispatch records and links them by their reference numbers."""
import re
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..extract.validate import norm_code, norm_vehicle, terms_days, to_date, to_num, values
from ..models import DispatchDoc, GoodsReceipt, GrLine, InvoiceLine, Party, PoLine, PurchaseOrder, SourceDocument, SupplierInvoice
from ..validate import GSTIN_RE, PAN_RE

DISPATCH_KINDS = {'lorry_receipt', 'consignment_note', 'weighbridge', 'gate_entry', 'eway_bill', 'delivery_challan'}


def _gstin_from(v) -> str | None:
    """Only store something in a GSTIN column if it is shaped like a GSTIN: a misread puts the
    supplier's address there, which is neither true nor useful to match on."""
    g = norm_code(v)
    return g if g and GSTIN_RE.match(g) else None


def _pan_from(pan: str | None, gstin: str | None) -> str | None:
    """A read PAN is untrusted: models hand back near misses like the GSTIN's first 11 characters,
    which the 10-char column rejects and the whole job dies with it. Keep it only if it is shaped
    like a PAN, else take the PAN out of the GSTIN."""
    cleaned = (pan or '').strip().upper()
    if PAN_RE.match(cleaned):
        return cleaned
    inner = (gstin or '')[2:12]
    return inner if PAN_RE.match(inner) else None


def _name_key(name: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (name or '').lower().replace('private', 'pvt').replace('limited', 'ltd'))


def find_or_create_party(db: Session, entity_id: str, kind: str, name: str | None, gstin: str | None = None, code: str | None = None,
                         pan: str | None = None, source: str = 'extracted', **extra) -> Party | None:
    gstin = norm_code(gstin)
    code = norm_code(code)
    pan = _pan_from(pan, gstin)
    q = select(Party).where(Party.entity_id == entity_id, Party.kind == kind)
    p = None
    if gstin:
        p = db.scalar(q.where(Party.gstin == gstin))
    if not p and code:
        p = db.scalar(q.where(Party.code == code))
    if not p and name:
        key = _name_key(name)
        for cand in db.scalars(q.where(Party.name.ilike(f'%{name.split()[0]}%'))):
            if _name_key(cand.name) == key:
                p = cand
                break
    if not p:
        if not (name or gstin or code):
            return None
        p = Party(entity_id=entity_id, kind=kind, name=(name or gstin or code).strip()[:200], gstin=gstin, code=code, pan=pan, source=source,
                 state=None, extra={})
        db.add(p)
        db.flush()
    # fill blanks, never overwrite imported/SAP values with extracted ones
    if gstin and not p.gstin:
        p.gstin = gstin
    if code and not p.code:
        p.code = code
    if pan and not p.pan:
        p.pan = pan
    for k, v in extra.items():
        if v and not getattr(p, k, None):
            setattr(p, k, v)
    return p


def find_po(db: Session, entity_id: str, ref: str | None) -> PurchaseOrder | None:
    ref = norm_code(ref)
    if not ref:
        return None
    po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.entity_id == entity_id, PurchaseOrder.po_no == ref))
    if not po and ref.lstrip('0') != ref:
        po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.entity_id == entity_id, PurchaseOrder.po_no == ref.lstrip('0')))
    return po


def apply(db: Session, doc: SourceDocument) -> None:
    """Create or update the business record behind an extracted document and link it."""
    v = values(doc.fields or [])
    kind = doc.kind
    if kind in ('invoice', 'credit_note', 'debit_note'):
        _apply_invoice(db, doc, v)
    elif kind == 'invoice_copy':
        inv = db.scalar(select(SupplierInvoice).where(SupplierInvoice.entity_id == doc.entity_id, SupplierInvoice.invoice_no == (v.get('invoiceNo') or '').strip()))
        if inv:
            doc.invoice_id, doc.po_id, doc.status, doc.status_note = inv.id, inv.po_id, 'duplicate', f'Copy of invoice {inv.invoice_no}'
    elif kind == 'purchase_order':
        _apply_po(db, doc, v)
    elif kind == 'goods_receipt':
        _apply_grn(db, doc, v)
    elif kind in DISPATCH_KINDS:
        _apply_dispatch(db, doc, v)
    db.flush()


def _apply_invoice(db: Session, doc: SourceDocument, v: dict) -> None:
    no = (v.get('invoiceNo') or '').strip()
    if not no:
        doc.status_note = 'No invoice number read'
        return
    gstin = _gstin_from(v.get('gstin'))
    vendor = find_or_create_party(db, doc.entity_id, 'vendor', v.get('supplier'), gstin, None, v.get('supplierPan'),
                                  bank={'account': v['bankAccount'], 'ifsc': v.get('ifsc', '')} if v.get('bankAccount') else None,
                                  payment_terms_days=terms_days(v.get('paymentTerms')))
    inv = db.scalar(select(SupplierInvoice).where(SupplierInvoice.entity_id == doc.entity_id, SupplierInvoice.supplier_gstin == gstin, SupplierInvoice.invoice_no == no))
    if inv and inv.decision:
        doc.invoice_id, doc.po_id, doc.status, doc.status_note = inv.id, inv.po_id, 'duplicate', f'Invoice {no} already decided'
        return
    if not inv:
        inv = SupplierInvoice(entity_id=doc.entity_id, invoice_no=no, supplier_gstin=gstin, channel=doc.channel, received_at=doc.received_at or datetime.now(UTC))
        db.add(inv)
    inv.vendor_id, inv.vendor_name = (vendor.id if vendor else None), (vendor.name if vendor else v.get('supplier') or '')
    inv.date = to_date(v.get('invoiceDate'))
    inv.bill_to_gstin = _gstin_from(v.get('billTo'))
    inv.irn, inv.ack_no, inv.ewaybill = (v.get('irn') or '').lower() or None, v.get('ackNo'), norm_code(v.get('ewaybill'))
    inv.vehicle, inv.transporter, inv.place_of_supply = norm_vehicle(v.get('vehicle')), v.get('transporter'), v.get('pos')
    inv.po_ref = norm_code(v.get('poRef'))
    inv.taxable, inv.cgst, inv.sgst, inv.igst = (to_num(v.get(k)) or 0 for k in ('taxable', 'cgst', 'sgst', 'igst'))
    inv.freight, inv.other_charges, inv.round_off = (to_num(v.get(k)) or 0 for k in ('freight', 'otherCharges', 'roundOff'))
    inv.total = to_num(v.get('total')) or 0
    inv.payment_terms_days = terms_days(v.get('paymentTerms'))
    inv.reverse_charge = str(v.get('reverseCharge', '')).strip().upper().startswith('Y')
    inv.source_doc_id = doc.id
    inv.lines = [InvoiceLine(line_no=i + 1, description=l['desc'], hsn=norm_code(l['hsn']), qty=l['qty'], uom=l['unit'], rate=l['rate'], taxable=l['amount'], tax_rate=l.get('taxRate'))
                 for i, l in enumerate(doc.lines or [])]
    po = find_po(db, doc.entity_id, inv.po_ref)
    if po:
        inv.po_id = po.id
        if not po.vendor_id and vendor:
            po.vendor_id = vendor.id
    db.flush()
    doc.invoice_id, doc.po_id = inv.id, inv.po_id
    _link_grn_to_invoice(db, inv)


def _link_grn_to_invoice(db: Session, inv: SupplierInvoice) -> None:
    q = select(GoodsReceipt).where(GoodsReceipt.entity_id == inv.entity_id)
    g = db.scalar(q.where(GoodsReceipt.invoice_ref == inv.invoice_no)) or (db.scalar(q.where(GoodsReceipt.po_id == inv.po_id).order_by(GoodsReceipt.id.desc())) if inv.po_id else None)
    if g:
        inv.grn_id = g.id
        if not inv.po_id and g.po_id:
            inv.po_id = g.po_id


def _apply_po(db: Session, doc: SourceDocument, v: dict) -> None:
    no = norm_code(v.get('poNo'))
    if not no:
        doc.status_note = 'No PO number read'
        return
    vendor = find_or_create_party(db, doc.entity_id, 'vendor', v.get('vendorName'), v.get('vendorGstin'), v.get('vendorCode'))
    po = find_po(db, doc.entity_id, no)
    if not po:
        po = PurchaseOrder(entity_id=doc.entity_id, po_no=no, source='extracted')
        db.add(po)
    if po.source != 'extracted':  # SAP/import data is the truth: only attach the document and fill blanks
        po.source_doc_id = po.source_doc_id or doc.id
        po.payment_terms_days = po.payment_terms_days or terms_days(v.get('paymentTerms'))
        po.freight_terms = po.freight_terms or v.get('freightTerms')
        po.delivery_terms = po.delivery_terms or v.get('deliveryTerms')
        po.vendor_id = po.vendor_id or (vendor.id if vendor else None)
        db.flush()
        doc.po_id = po.id
        return
    po.vendor_id, po.vendor_name = (vendor.id if vendor else None), (vendor.name if vendor else v.get('vendorName') or '')
    po.date, po.plant, po.buyer = to_date(v.get('poDate')), v.get('plant'), v.get('buyerContact')
    po.payment_terms_days, po.freight_terms, po.delivery_terms = terms_days(v.get('paymentTerms')), v.get('freightTerms'), v.get('deliveryTerms')
    po.taxable, po.tax, po.total = (to_num(v.get(k)) or 0 for k in ('taxable', 'tax', 'total'))
    po.source_doc_id = doc.id
    if po.lines:  # a re-read: drop the old lines first, or the new ones collide on (po_id, item)
        po.lines = []
        db.flush()
    po.lines = [PoLine(item=int(to_num(l.get('item')) or (i + 1) * 10), material_code=l.get('material'), description=l['desc'], hsn=norm_code(l['hsn']), uom=l['unit'],
                       qty=l['qty'], rate=l['rate'], tax_rate=l.get('taxRate'), amount=l['amount'], delivery_date=to_date(l.get('deliveryDate'))) for i, l in enumerate(doc.lines or [])]
    db.flush()
    doc.po_id = po.id
    relink_po(db, po)


def _apply_grn(db: Session, doc: SourceDocument, v: dict) -> None:
    no = norm_code(v.get('grnNo'))
    if not no:
        doc.status_note = 'No GRN number read'
        return
    vendor = find_or_create_party(db, doc.entity_id, 'vendor', v.get('vendorName'), v.get('vendorGstin'), v.get('vendorCode'))
    g = db.scalar(select(GoodsReceipt).where(GoodsReceipt.entity_id == doc.entity_id, GoodsReceipt.grn_no == no))
    if not g:
        g = GoodsReceipt(entity_id=doc.entity_id, grn_no=no, source='extracted')
        db.add(g)
    g.date, g.po_ref = to_date(v.get('grnDate')), norm_code(v.get('poNo'))
    g.vendor_id, g.vendor_name = (vendor.id if vendor else None), (vendor.name if vendor else v.get('vendorName') or '')
    g.gate_entry_no, g.gate_entry_date = norm_code(v.get('gateEntryNo')), to_date(v.get('gateEntryDate'))
    g.challan_no, g.challan_date = v.get('challanNo'), to_date(v.get('challanDate'))
    g.invoice_ref, g.invoice_date = (v.get('invoiceNo') or '').strip() or None, to_date(v.get('invoiceDate'))
    g.lr_no, g.lr_date, g.transporter = norm_code(v.get('lrNo')), to_date(v.get('lrDate')), v.get('transporter')
    g.vehicle, g.ewaybill, g.source_doc_id = norm_vehicle(v.get('vehicle')), norm_code(v.get('ewaybill')), doc.id
    g.lines = [GrLine(po_item=int(to_num(l.get('poItem')) or 0) or None, material_code=l.get('material'), description=l['desc'], hsn=norm_code(l['hsn']), uom=l['unit'],
                      received_qty=l['qty'], accepted_qty=l.get('accepted') or 0, rejected_qty=l.get('rejected') or 0, batch=l.get('batch'), storage_location=l.get('storageLoc'))
               for l in (doc.lines or [])]
    po = find_po(db, doc.entity_id, g.po_ref)
    if po:
        g.po_id = po.id
        if not po.vendor_id and vendor:
            po.vendor_id = vendor.id
    db.flush()
    doc.grn_id, doc.po_id = g.id, g.po_id
    if g.invoice_ref:
        for inv in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == doc.entity_id,
                                                           SupplierInvoice.invoice_no == g.invoice_ref)):
            _link_grn_to_invoice(db, inv)
    if po:
        relink_po(db, po)


def _apply_dispatch(db: Session, doc: SourceDocument, v: dict) -> None:
    kind = doc.kind
    number = v.get('lrNo') or v.get('ticketNo') or v.get('number')
    d = db.scalar(select(DispatchDoc).where(DispatchDoc.source_doc_id == doc.id)) or DispatchDoc(entity_id=doc.entity_id, kind=kind, source_doc_id=doc.id)
    db.add(d)
    d.number = norm_code(number)
    d.date = to_date(v.get('lrDate') or v.get('date'))
    d.transporter, d.vehicle = v.get('transporter'), norm_vehicle(v.get('vehicle'))
    d.consignor, d.consignee = v.get('consignor') or v.get('supplier') or v.get('party'), v.get('consignee')
    d.packages, d.gross_wt, d.tare_wt = to_num(v.get('packages')), to_num(v.get('grossKg')), to_num(v.get('tareKg'))
    d.net_wt = to_num(v.get('netKg') or v.get('weightKg'))
    d.freight_basis = (v.get('freightBasis') or '').lower().replace(' ', '-') or None
    d.freight_amount = to_num(v.get('freightAmount'))
    d.invoice_ref, d.ewaybill = (v.get('invoiceNo') or '').strip() or None, norm_code(v.get('ewaybill'))
    d.data = v
    if kind == 'lorry_receipt' and v.get('transporter'):
        find_or_create_party(db, doc.entity_id, 'vendor', v.get('transporter'), v.get('transporterGstin'), None, udyam=v.get('udyam'), tags=['GTA'])
    db.flush()
    doc.dispatch_id = d.id
    _link_dispatch(db, d)
    doc.po_id, doc.grn_id = d.po_id, d.grn_id


def _link_dispatch(db: Session, d: DispatchDoc) -> None:
    ent = d.entity_id
    inv = None
    if d.invoice_ref:
        inv = db.scalar(select(SupplierInvoice).where(SupplierInvoice.entity_id == ent, SupplierInvoice.invoice_no.ilike(f'%{d.invoice_ref.split("/")[-1]}')))
    if not inv and d.ewaybill:
        inv = db.scalar(select(SupplierInvoice).where(SupplierInvoice.entity_id == ent, SupplierInvoice.ewaybill == d.ewaybill))
    if inv:
        d.po_id, d.grn_id = d.po_id or inv.po_id, d.grn_id or inv.grn_id
    g = None
    if d.number:
        g = db.scalar(select(GoodsReceipt).where(GoodsReceipt.entity_id == ent, GoodsReceipt.lr_no == d.number))
    if not g and d.vehicle:
        g = db.scalar(select(GoodsReceipt).where(GoodsReceipt.entity_id == ent, GoodsReceipt.vehicle == d.vehicle).order_by(GoodsReceipt.id.desc()))
    if g:
        d.grn_id, d.po_id = d.grn_id or g.id, d.po_id or g.po_id


def relink_po(db: Session, po: PurchaseOrder) -> None:
    """Attach invoices, GRNs and dispatch documents that quote this PO but were read before it existed."""
    ent, no = po.entity_id, po.po_no
    refs = [no, no.lstrip('0')]
    for g in db.scalars(select(GoodsReceipt).where(GoodsReceipt.entity_id == ent, GoodsReceipt.po_id.is_(None), GoodsReceipt.po_ref.in_(refs))):
        g.po_id = po.id
        for sd in db.scalars(select(SourceDocument).where(SourceDocument.grn_id == g.id)):
            sd.po_id = po.id
    for inv in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == ent, SupplierInvoice.po_id.is_(None), SupplierInvoice.po_ref.in_(refs))):
        inv.po_id = po.id
        _link_grn_to_invoice(db, inv)
        for sd in db.scalars(select(SourceDocument).where(SourceDocument.invoice_id == inv.id)):
            sd.po_id = po.id
    for inv in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == ent, SupplierInvoice.po_id == po.id)):
        _link_grn_to_invoice(db, inv)
    db.flush()
    for d in db.scalars(select(DispatchDoc).where(DispatchDoc.entity_id == ent, DispatchDoc.po_id.is_(None))):
        _link_dispatch(db, d)
        if d.po_id:
            for sd in db.scalars(select(SourceDocument).where(SourceDocument.dispatch_id == d.id)):
                sd.po_id, sd.grn_id = d.po_id, d.grn_id
    db.flush()
