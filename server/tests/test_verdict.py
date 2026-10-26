"""A delivery whose documents all agree is clean; approving it untouched counts as straight-through."""
from datetime import UTC, datetime

from app.domain.link import apply
from app.domain.match import run_match
from app.extract.validate import build_fields
from app.models import SourceDocument, SupplierInvoice, User, Verification

IRN = '8d64fa741acb8b7521cb78c5466c15bbfee5493a4e0db77a82a6f0a04ec2ebfd'


def make(db, e, kind, lines=None, **vals):
    d = SourceDocument(entity_id=e.id, channel='Upload', received_at=datetime.now(UTC), filename=f'{kind}.pdf', mime='application/pdf', size=1, sha256=kind,
                       storage_path='/x', kind=kind, status='new', pages=1)
    d.fields = build_fields(kind, {k: {'value': v, 'confidence': 96} for k, v in vals.items()})
    d.lines = lines or []
    db.add(d)
    db.flush()
    apply(db, d)
    return d


def clean_delivery(db, e):
    line = {'desc': 'SS braided hose', 'hsn': '40091200', 'qty': 1000, 'unit': 'PC', 'rate': 72.5, 'amount': 72500, 'confidence': 96, 'taxRate': 18}
    make(db, e, 'purchase_order', poNo='4230001548', poDate='08.08.2026', vendorName='Akshay Plastic Industries', vendorGstin='07ACXPJ3115G1ZJ', buyerGstin='09AAACA1199D1ZW',
         paymentTerms='30 Days', taxable='72500.00', tax='13050.00', total='85550.00', lines=[{**line, 'item': '10'}])
    make(db, e, 'goods_receipt', grnNo='5000119339', grnDate='02.09.2026', poNo='4230001548', vendorName='Akshay Plastic Industries', invoiceNo='API/3166',
         invoiceDate='01.09.2026', vehicle='UP16PT2710', ewaybill='791666006375',
         lines=[{**line, 'rate': 0, 'amount': 1000, 'poItem': '10', 'accepted': 1000, 'rejected': 0}])
    make(db, e, 'invoice', supplier='AKSHAY PLASTIC INDUSTRIES', gstin='07ACXPJ3115G1ZJ', billTo='09AAACA1199D1ZW', invoiceNo='API/3166', invoiceDate='01-09-2026', irn=IRN,
         poRef='4230001548', ewaybill='791666006375', vehicle='UP16PT2710', paymentTerms='30 DAYS CREDIT', taxable='72500.00', igst='13050.00', total='85550.00', lines=[line])
    return db.query(SupplierInvoice).filter_by(invoice_no='API/3166').one()


def test_clean_delivery_and_pending_verification(db, firm):
    f, e, admin = firm
    inv = clean_delivery(db, e)
    run_match(db, inv)
    v = inv.match['verdict']
    assert inv.match['flags'] == [] and v['state'] == 'clean' and v['issues'] == 0
    assert [i['title'] for i in v['items']] == ['Not verified with GST systems']
    db.add(Verification(entity_id=e.id, invoice_id=inv.id, kind='ewb', ref='791666006375', status='pending', detail={}, polls=0))
    db.flush()
    run_match(db, inv)
    assert inv.match['verdict']['state'] == 'pending'


def test_straight_through_and_stats(client, db, firm, sign_in):
    f, e, admin = firm
    inv = clean_delivery(db, e)
    run_match(db, inv)
    sign_in(db.query(User).filter_by(email='ap@apollo.in').one())
    r = client.get(f'/api/invoices/{inv.id}')
    assert r.json()['verdict']['state'] == 'clean' and r.json()['consistency'] and r.json()['verifications'] == []
    assert client.get(f'/api/invoices/stats?entity={e.id}').json() == {'days': 30, 'decided': 0, 'straightThrough': 0, 'clean': 1, 'issues': 0, 'pending': 0}
    r = client.post(f'/api/invoices/{inv.id}/decision', json={'kind': 'approve', 'reasons': ['OK-00'], 'note': ''})
    assert r.status_code == 200 and r.json()['decision']['straightThrough'] is True
    stats = client.get(f'/api/invoices/stats?entity={e.id}&days=7').json()
    assert stats['decided'] == 1 and stats['straightThrough'] == 1 and stats['clean'] == 0
    assert client.get('/api/invoices/stats?entity=other').status_code == 403
