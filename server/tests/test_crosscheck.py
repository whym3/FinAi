"""The Akshay Plastic bundle as it was really read: the sideways GRN and LR carried misreads. Each one is caught by the other documents,
marked on the field, and stays a misread to fix (not an exception) until a person confirms the differing value."""
from datetime import UTC, datetime

from app.domain import crosscheck
from app.domain.link import apply
from app.domain.match import DEFAULT_TOL, run_match
from app.extract.validate import LOW, build_annotations, build_fields
from app.models import ExceptionItem, SourceDocument, SupplierInvoice

IRN = '8d64fa741acb8b7521cb78c5466c15bbfee5493a4e0db77a82a6f0a04ec2ebfd'


def make(db, e, bundle, kind, page, conf=95, lines=None, stamps=None, data=None, **vals):
    d = SourceDocument(entity_id=e.id, channel='Upload', received_at=datetime(2026, 9, 3, tzinfo=UTC), filename=f'akshay p{page}.pdf', mime='application/pdf', size=1,
                       sha256=f'{kind}{page}', storage_path='/x', kind=kind, status='review', pages=1, bundle_id=bundle.id, page_from=page, page_to=page, data=data or {})
    d.fields = build_fields(kind, {k: {'value': v, 'confidence': conf} for k, v in vals.items()})
    d.lines = lines or []
    d.annotations = build_annotations({'stamps': stamps or []})
    db.add(d)
    db.flush()
    apply(db, d)
    return d


def bundle_of(db, e, grn_invoice='4230001548'):
    b = SourceDocument(entity_id=e.id, channel='Upload', received_at=datetime(2026, 9, 3, tzinfo=UTC), filename='akshay.pdf', mime='application/pdf', size=1, sha256='bundle',
                       storage_path='/x', kind='bundle', status='linked', pages=8)
    db.add(b)
    db.flush()
    po = make(db, e, b, 'purchase_order', 7, data={'printedPages': 2}, poNo='4230001548', poDate='08.08.2026', vendorCode='1003071', vendorName='Akshay Plastic Industries',
              vendorGstin='07ACXPJ3115G1ZJ', buyerGstin='09AAACA1199D1ZW', taxable='72500.00', tax='13050.00', total='85550.00',
              lines=[{'desc': 'SS Black hose', 'hsn': '40091200', 'qty': 1000, 'unit': 'PC', 'rate': 72.5, 'amount': 72500, 'confidence': 95, 'taxRate': 18, 'item': '10'}])
    inv = make(db, e, b, 'invoice', 1, supplier='AKSHAY PLASTIC INDUSTRIES', gstin='07ACXPJ3115G1ZJ', billTo='09AAACA1199D1ZW', invoiceNo='API/3166', invoiceDate='01-09-2026',
               irn=IRN, poRef='4230001548', ewaybill='791666006375', vehicle='UP16PT2710', transporter='AASH LOGISTICS PRIVATE LIMITED', paymentTerms='30 DAYS CREDIT',
               taxable='72500.00', igst='13050.00', freight='0.00', total='85550.00',
               lines=[{'desc': 'SS BRAIDED HOSE', 'hsn': '40091200', 'qty': 1000, 'unit': 'Pcs', 'rate': 72.5, 'amount': 72500, 'confidence': 95, 'taxRate': 18}],
               stamps=[{'type': 'receipt', 'text': 'RECEIPT', 'grnNo': '5-119339', 'gateEntryNo': '183346', 'poNo': '423-1548', 'invoiceNo': None, 'parkPostNo': None,
                        'date': '03.09.26', 'confidence': 70}])
    grn = make(db, e, b, 'goods_receipt', 8, conf=90, grnNo='5000119339', grnDate='02.09.2026', gateEntryNo='0000183346', gateEntryDate='02.09.2026', poNo='4230001548',
               vendorName='Akshay Plastic Industries', invoiceNo=grn_invoice, invoiceDate='01.09.2026', lrNo='SGT-5721', transporter='PRAKASH LOGISTICS', vehicle='UP16PT2710',
               ewaybill='691666060375',
               lines=[{'desc': 'SS Black hose', 'hsn': '40091200', 'qty': 1000, 'unit': 'PC', 'rate': 0, 'amount': 1000, 'confidence': 90, 'poItem': '10', 'accepted': 1000, 'rejected': 0}])
    lr = make(db, e, b, 'lorry_receipt', 3, conf=90, lrNo='SGT-15721', lrDate='01-09-2026', transporter='AASH LOGISTICS PVT. LTD.', invoiceNo='3166', invoiceValue='85500',
              ewaybill='791666006375', packages='10', weightKg='150')
    slip = make(db, e, b, 'consignment_note', 4, conf=65, party='Apollo Pipes', packages='10', weightKg='130')
    wb = make(db, e, b, 'weighbridge', 5, conf=90, ticketNo='109350', date='02-09-2026', vehicle='UP16PT2710', grossKg='3170', tareKg='3060', netKg='110')
    return b, {'po': po, 'inv': inv, 'grn': grn, 'lr': lr, 'slip': slip, 'wb': wb}


def field(d, key):
    return next(f for f in d.fields if f['key'] == key)


def test_same_ref():
    assert crosscheck.same_ref('3166', 'API/3166') and crosscheck.same_ref('API/3166', 'api 3166')
    assert crosscheck.same_ref('5-119339', '5000119339') and crosscheck.same_ref('423-1548', '4230001548')
    assert crosscheck.same_ref('183346', '0000183346')
    assert not crosscheck.same_ref('SGT-5721', 'SGT-15721') and not crosscheck.same_ref('4230001548', 'API/3166') and not crosscheck.same_ref('', 'X')


def test_misreads_are_marked_and_stay_out_of_exceptions(db, firm):
    f, e, admin = firm
    b, d = bundle_of(db, e)
    inv = db.query(SupplierInvoice).filter_by(invoice_no='API/3166').one()
    assert inv.grn_id and inv.po_id
    run_match(db, inv)
    grn_inv = field(d['grn'], 'invoiceNo')
    assert grn_inv['xcheck']['tone'] == 'bad' and 'API/3166' in grn_inv['xcheck']['label'] and grn_inv['confidence'] == LOW
    assert field(d['grn'], 'ewaybill')['xcheck']['tone'] == 'bad' and field(d['grn'], 'transporter')['xcheck']['tone'] == 'bad'
    assert field(d['lr'], 'invoiceValue')['xcheck']['label'].endswith('show 85550.00')
    assert 'xcheck' not in field(d['lr'], 'transporter')  # "AASH LOGISTICS PVT. LTD." is the same transporter
    assert 'xcheck' not in field(d['inv'], 'invoiceNo') and 'xcheck' not in field(d['grn'], 'grnNo')  # the stamp's "5-119339" agrees
    found = {fd['fact']: fd for fd in inv.match['consistency']}
    assert found['invoice_no']['severity'] == 'misread' and found['grn_no']['state'] == 'agree' and found['gate_entry_no']['state'] == 'agree'
    assert found['po_no']['state'] == 'agree' and found['weight']['severity'] == 'warn'
    assert found['pages_missing']['severity'] == 'discrepancy'
    keys = {fl['key'] for fl in inv.match['flags']}
    assert 'pages' in keys and not any(k.startswith('xdoc-') for k in keys)
    v = inv.match['verdict']
    assert v['state'] == 'issues'
    checks = [i for i in v['items'] if i['action'] and i['action'].get('key') == 'invoiceNo' and i['action']['docId'] == str(d['grn'].id)]
    assert checks and checks[0]['title'] == 'Check Invoice no. on Goods receipt note (p8)'
    assert any(i['title'] == 'Not verified with GST systems' and not i['blocks'] for i in v['items'])
    assert db.query(ExceptionItem).filter_by(invoice_id=inv.id, type='pages').count() == 1
    assert b.data['checks']['verdict']['state'] == 'issues'
    # running again does not lower confidence further
    base = field(d['grn'], 'invoiceNo')['baseConfidence']
    run_match(db, inv)
    assert field(d['grn'], 'invoiceNo')['confidence'] == LOW and field(d['grn'], 'invoiceNo')['baseConfidence'] == base


def test_a_confirmed_difference_becomes_an_exception(db, firm):
    f, e, admin = firm
    b, d = bundle_of(db, e)
    inv = db.query(SupplierInvoice).filter_by(invoice_no='API/3166').one()
    fields = [dict(x) for x in d['grn'].fields]
    for x in fields:
        if x['key'] == 'invoiceNo':
            x.update(confirmedBy=str(admin.id), confidence=100, read=100, baseConfidence=100)
    d['grn'].fields = fields
    for x in d['inv'].fields:
        x['confirmedBy'] = str(admin.id)
    run_match(db, inv)
    found = {fd['fact']: fd for fd in inv.match['consistency']}
    assert found['invoice_no']['severity'] == 'discrepancy'
    assert 'xdoc-invoice_no' in {fl['key'] for fl in inv.match['flags']}
    x = db.query(ExceptionItem).filter_by(invoice_id=inv.id, flag_key='xdoc-invoice_no').one()
    assert x.type == 'xdoc' and x.rule_id == 'xdoc'


def test_weights_within_tolerance_agree():
    class D:
        def __init__(self, id, kind, **vals):
            self.id, self.kind, self.page_from, self.page_to, self.pages, self.data, self.codes, self.annotations = id, kind, None, None, 1, {}, [], []
            self.fields = build_fields(kind, {k: {'value': v, 'confidence': 95} for k, v in vals.items()})
    docs = [D(1, 'lorry_receipt', weightKg='150'), D(2, 'weighbridge', netKg='145')]
    assert {fd['fact']: fd for fd in crosscheck.compare(docs, DEFAULT_TOL)}['weight']['state'] == 'agree'
    docs = [D(1, 'lorry_receipt', weightKg='150'), D(2, 'weighbridge', netKg='110')]
    assert {fd['fact']: fd for fd in crosscheck.compare(docs, DEFAULT_TOL)}['weight']['severity'] == 'warn'


def test_an_invoice_and_its_copy_are_one_paper_and_irns_are_compared():
    class D:
        def __init__(self, id, kind, invoice_id=None, **vals):
            self.id, self.kind, self.invoice_id, self.page_from, self.page_to, self.pages, self.data, self.codes, self.annotations = id, kind, invoice_id, None, None, 1, {}, [], []
            self.fields = build_fields(kind, {k: {'value': v, 'confidence': 95} for k, v in vals.items()})
    docs = [D(1, 'invoice', 7, vehicle='DL01LV1851', irn=IRN), D(2, 'invoice_copy', 7, vehicle='DL01LV1851', irn=IRN[:20] + 'f' + IRN[21:]),
            D(3, 'weighbridge', vehicle='UP16PT2710'), D(4, 'goods_receipt', vehicle='UP16PT2710')]
    found = {fd['fact']: fd for fd in crosscheck.compare(docs, DEFAULT_TOL)}
    assert found['vehicle']['consensus'] == 'UP16PT2710'  # two papers against one, however many copies of it
    assert found['irn']['state'] == 'differ'


def test_only_stamps_with_references_need_a_check():
    assert crosscheck.checkable({'type': 'receipt', 'grnNo': '5-119339'})
    assert not crosscheck.checkable({'type': 'signature', 'text': 'signed', 'date': '02/09/26'})


def test_marking_a_reading_does_not_weaken_it_in_the_next_comparison(db, firm):
    f, e, admin = firm
    b, d = bundle_of(db, e)
    inv = db.query(SupplierInvoice).filter_by(invoice_no='API/3166').one()
    for _ in range(3):
        run_match(db, inv)
    found = {fd['fact']: fd for fd in inv.match['consistency']}
    grn_obs = next(o for o in found['invoice_no']['observations'] if o['docId'] == str(d['grn'].id))
    assert grn_obs['confidence'] == 90 and field(d['grn'], 'invoiceNo')['confidence'] == LOW


def test_a_confirmed_vehicle_difference_is_always_flagged(db, firm):
    f, e, admin = firm
    b, d = bundle_of(db, e)
    inv = db.query(SupplierInvoice).filter_by(invoice_no='API/3166').one()
    fields = [dict(x) for x in d['wb'].fields]
    for x in fields:
        if x['key'] == 'vehicle':
            x.update(value='UP99ZZ1111', confirmedBy=str(admin.id), confidence=100, read=100, baseConfidence=100)
    d['wb'].fields = fields
    run_match(db, inv)
    assert field(d['inv'], 'vehicle')['xcheck']['label'].endswith('show UP99ZZ1111')  # one side confirmed: check the other
    assert not {'vehicle', 'xdoc-vehicle'} & {fl['key'] for fl in inv.match['flags']}
    for x in d['inv'].fields:
        if x['key'] == 'vehicle':
            x['confirmedBy'] = str(admin.id)
    run_match(db, inv)
    keys = {fl['key'] for fl in inv.match['flags']}
    assert ('vehicle' in keys) != ('xdoc-vehicle' in keys)  # both sides confirmed: a real difference, flagged once
