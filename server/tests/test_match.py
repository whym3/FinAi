"""The Akshay Plastic bundle: PO 4230001548, GRN 5000119339, invoice API/3166. HSN and vehicle differ; qty, rate, total and terms agree."""
from datetime import date

import pytest

from app.domain.link import apply
from app.domain.match import run_match
from app.domain.p2p import po_view
from app.models import ExceptionItem, GoodsReceipt, PurchaseOrder, SourceDocument, SupplierInvoice


def fields(kind, **vals):
    from app.extract.validate import build_fields
    return build_fields(kind, {k: {'value': v, 'confidence': 95} for k, v in vals.items()})


def doc(db, e, kind, lines=None, **vals):
    d = SourceDocument(entity_id=e.id, channel='Upload', received_at=__import__('datetime').datetime.now(), filename=f'{kind}.pdf', mime='application/pdf', size=1, sha256=kind, storage_path='/x', kind=kind)
    d.fields = fields(kind, **vals)
    d.lines = lines or []
    db.add(d)
    db.flush()
    apply(db, d)
    return d


@pytest.fixture
def bundle(db, firm):
    f, e, admin = firm
    po = doc(db, e, 'purchase_order', poNo='4230001548', poDate='08.08.2026', vendorCode='1003071', vendorName='Akshay Plastic Industries', vendorGstin='07ACXPJ3115G1ZJ',
             buyerGstin='09AAACA1199D1ZW', paymentTerms='After Receipt Of Material 30 Days', freightTerms='FREIGHT EXTRA AS ACTUAL', taxable='72500.00', tax='13050.00', total='85550.00',
             lines=[{'desc': 'SS Black hose Brss Nut& Insert 24" TP094', 'hsn': '39229000', 'qty': 1000, 'unit': 'PC', 'rate': 72.5, 'amount': 72500, 'confidence': 95, 'taxRate': 18, 'item': '10', 'material': 'BPTAXXXX24BKHXSS'}])
    grn = doc(db, e, 'goods_receipt', grnNo='5000119339', grnDate='02.09.2026', gateEntryNo='0000183346', gateEntryDate='02.09.2026', poNo='4230001548', vendorCode='1003071',
              vendorName='Akshay Plastic Industries', invoiceNo='API/3166', invoiceDate='01.09.2026', lrNo='SGT-15721', transporter='AASH LOGISTICS', vehicle='UP16PT2710', ewaybill='791666006375',
              lines=[{'desc': 'SS Black hose', 'hsn': '39229000', 'qty': 1000, 'unit': 'PC', 'rate': 0, 'amount': 1000, 'confidence': 95, 'poItem': '10', 'accepted': 1000, 'rejected': 0}])
    inv = doc(db, e, 'invoice', supplier='AKSHAY PLASTIC INDUSTRIES', gstin='07ACXPJ3115G1ZJ', billTo='09AAACA1199D1ZW', invoiceNo='API/3166', invoiceDate='01-09-2026',
              irn='8d64fa741acb8b7521cb78c5466c15bbfee5493a4e0db77a82a6f0a04ec2ebfd', pos='Uttar Pradesh (09)', poRef='4230001548', ewaybill='791666006375', vehicle='DL01LV1851',
              transporter='AASH LOGISTICS PRIVATE LIMITED', paymentTerms='30 DAYS CREDIT', taxable='72500.00', igst='13050.00', freight='0.00', total='85550.00',
              lines=[{'desc': 'SS BRAIDED HOSE CONNECTION PIPE', 'hsn': '40091200', 'qty': 1000, 'unit': 'Pcs', 'rate': 72.5, 'amount': 72500, 'confidence': 95, 'taxRate': 18}])
    return e, po, grn, inv


def test_link_and_match(db, bundle):
    e, po_doc, grn_doc, inv_doc = bundle
    po = db.query(PurchaseOrder).filter_by(po_no='4230001548').one()
    grn = db.query(GoodsReceipt).filter_by(grn_no='5000119339').one()
    inv = db.query(SupplierInvoice).filter_by(invoice_no='API/3166').one()
    assert grn.po_id == po.id and inv.po_id == po.id and inv.grn_id == grn.id
    assert inv.vendor_id == po.vendor_id == grn.vendor_id
    assert po.payment_terms_days == 30 and inv.payment_terms_days == 30
    run_match(db, inv, today=date(2026, 9, 3))
    keys = {f['key'] for f in inv.match['flags']}
    assert keys == {'hsn', 'vehicle'}, inv.match['flags']
    rows = {r['field']: r for r in inv.match['rows']}
    assert rows['Qty']['cells'][3]['s'] == 'ok' and rows['Rate']['cells'][3]['s'] == 'ok' and rows['Total']['cells'][3]['s'] == 'ok'
    assert rows['HSN']['cells'][3]['s'] == 'bad' and rows['Vehicle']['cells'][3]['s'] == 'bad'
    assert rows['Tax type']['cells'][3]['v'] == 'IGST' and rows['Tax type']['cells'][3]['s'] == 'ok'
    assert rows['Payment terms']['cells'][3]['s'] == 'ok'
    assert inv.dn_lines == []
    exs = db.query(ExceptionItem).filter_by(invoice_id=inv.id).all()
    assert {x.type for x in exs} == {'hsn', 'vehicle'} and all(x.doc_route == f'/review/{inv.id}' for x in exs)
    run_match(db, inv, today=date(2026, 9, 3))  # idempotent
    assert db.query(ExceptionItem).filter_by(invoice_id=inv.id).count() == 2
    stages, agg = po_view(db, po, today=date(2026, 9, 3))
    states = {s['key']: s['state'] for s in stages}
    assert states['po'] == 'done' and states['grn'] == 'done' and states['invoice'] == 'done' and states['review'] == 'cur' and states['posting'] == 'ns'
    assert agg['lines'][0] == {**agg['lines'][0], 'ordered': 1000.0, 'received': 1000.0, 'accepted': 1000.0, 'invoiced': 1000.0, 'posted': 0, 'paid': 0}
    assert agg['sap']['grn'] == '5000119339' and agg['sap']['gateEntry'] == '0000183346'


def test_late_grn_relinks_existing_invoice_and_refreshes_difference(db, firm):
    _, e, _ = firm
    doc(db, e, 'purchase_order', poNo='PO-9', vendorName='Supplier', total='118',
        lines=[{'desc': 'Part', 'hsn': '3926', 'qty': 1, 'unit': 'pc', 'rate': 100, 'amount': 100, 'confidence': 95, 'item': '10'}])
    doc(db, e, 'invoice', supplier='Supplier', invoiceNo='INV-9', poRef='PO-9', taxable='100', igst='18', total='118',
        lines=[{'desc': 'Part', 'hsn': '3926', 'qty': 1, 'unit': 'pc', 'rate': 100, 'amount': 100, 'confidence': 95}])
    inv = db.query(SupplierInvoice).filter_by(invoice_no='INV-9').one()
    assert inv.po_id and not inv.grn_id
    run_match(db, inv, today=date(2026, 10, 25))
    grn_exception = db.query(ExceptionItem).filter_by(invoice_id=inv.id, flag_key='grn').one()
    assert grn_exception.status == 'open'
    grn_doc = doc(db, e, 'goods_receipt', grnNo='GRN-9', poNo='PO-9', invoiceNo='INV-9',
                  lines=[{'desc': 'Part', 'hsn': '3926', 'qty': 1, 'unit': 'pc', 'rate': 0, 'amount': 0, 'confidence': 95, 'poItem': '10', 'accepted': 1}])
    assert inv.grn_id == grn_doc.grn_id
    run_match(db, inv, today=date(2026, 10, 25))
    assert 'grn' not in {flag['key'] for flag in inv.match['flags']}
    assert grn_exception.status == 'open'  # a reviewer closes the previously raised exception
    assert grn_exception.status_note == 'Difference no longer detected; review evidence and resolve'
    run_match(db, inv, today=date(2026, 10, 25))
    assert sum('Difference no longer detected' in h['text'] for h in grn_exception.history) == 1


def test_rate_and_freight_flags(db, firm):
    f, e, admin = firm
    doc(db, e, 'purchase_order', poNo='4500012345', vendorName='Sahyadri Packaging', vendorGstin='27AAPFU0939F1ZV', paymentTerms='30 days', freightTerms='FOR destination, included', total='100300.00',
        lines=[{'desc': 'Carton', 'hsn': '3926', 'qty': 1000, 'unit': 'pc', 'rate': 85, 'amount': 85000, 'confidence': 95, 'taxRate': 18, 'item': '10'}])
    doc(db, e, 'invoice', supplier='Sahyadri Packaging', gstin='27AAPFU0939F1ZV', billTo='09AAACA1199D1ZW', invoiceNo='SPK/0418', invoiceDate='10-10-2026', poRef='4500012345', paymentTerms='15 days',
        taxable='89000.00', igst='16020.00', freight='2000.00', total='107020.00', lines=[{'desc': 'Carton', 'hsn': '3923', 'qty': 1000, 'unit': 'pc', 'rate': 87, 'amount': 87000, 'confidence': 95, 'taxRate': 18}])
    inv = db.query(SupplierInvoice).filter_by(invoice_no='SPK/0418').one()
    run_match(db, inv, today=date(2026, 10, 13))
    keys = {f['key']: f for f in inv.match['flags']}
    assert {'rate', 'freight', 'hsn', 'terms', 'irn', 'grn'} <= set(keys)
    assert keys['rate']['amount'] == 2000 and keys['freight']['amount'] == 2000
    assert sum(l['taxable'] for l in inv.dn_lines) == 4000


def test_vehicle_only_when_dispatch_docs_exist(db, firm):
    f, e, admin = firm
    doc(db, e, 'invoice', supplier='X', gstin='07ACXPJ3115G1ZJ', billTo='09AAACA1199D1ZW', invoiceNo='X/1', invoiceDate='01-09-2026', vehicle='DL01AA1111', taxable='100', igst='18', total='118',
        irn='8d64fa741acb8b7521cb78c5466c15bbfee5493a4e0db77a82a6f0a04ec2ebfd')
    inv = db.query(SupplierInvoice).filter_by(invoice_no='X/1').one()
    run_match(db, inv, today=date(2026, 9, 3))
    assert {f['key'] for f in inv.match['flags']} == {'po'}
