"""Rule checks on what was read, and values that can never be right are refused on edit and on confirm."""
from datetime import UTC, date, datetime

from app.extract.validate import LOW, apply_checks, blocking_error, build_annotations, build_fields, build_lines, words_to_number
from app.models import SourceDocument, User

IRN = '8d64fa741acb8b7521cb78c5466c15bbfee5493a4e0db77a82a6f0a04ec2ebfd'


def read(kind, **vals):
    return {f['key']: f for f in build_fields(kind, {k: {'value': v, 'confidence': 95} for k, v in vals.items()}, received=date(2026, 9, 2))}


def test_words_to_number():
    assert words_to_number('Rupees Eighty Five Thousand Five Hundred Fifty Only') == 85550
    assert words_to_number('One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Seventy Eight Paise Only') == 123456.78
    assert words_to_number('Rupees Two Crore Five Lakh Only') == 20500000
    assert words_to_number('Rupees Five Hundred and Paise Fifty Only') == 500.5
    assert words_to_number('Eighty-five thousand') == 85000
    assert words_to_number('Paid by cheque') is None and words_to_number('') is None


def test_placeholders_and_label_echoes_are_dropped():
    f = read('weighbridge', ticketNo='109350', challanNo='HEADING 1', supplier='-')
    assert 'challanNo' not in f and 'supplier' not in f and f['ticketNo']['value'] == '109350'
    lr = read('lorry_receipt', consignor='Consignor', consignee='APOLLO PIPES LIMITED')
    assert 'consignor' not in lr and 'consignee' in lr


def test_format_rules():
    f = read('invoice', ewaybill='7916 6600 6375', ifsc='KKBK0000183', vehicle='DL01LV1851', gstin='07ACXPJ3115G1ZJ', supplierPan='ACXPJ3115G', ackNo='172621069951951')
    assert all('check' not in f[k] for k in ('ewaybill', 'ifsc', 'vehicle', 'supplierPan', 'ackNo'))
    bad = read('invoice', ewaybill='79166600637', ifsc='KKBK000183', vehicle='DELHI TRUCK', gstin='07ACXPJ3115G1ZJ', supplierPan='ACXPJ3115H', irn=IRN[:63], ackNo='1726')
    assert bad['ewaybill']['blocking'] and bad['ifsc']['blocking'] and bad['irn']['blocking']
    assert bad['vehicle']['check']['tone'] == 'warn' and not bad['vehicle'].get('blocking') and bad['vehicle']['confidence'] == LOW
    assert bad['supplierPan']['check']['label'] == 'PAN inside the GSTIN is ACXPJ3115G' and bad['ackNo']['check']['tone'] == 'warn'
    assert read('invoice', vehicle='22BH1234AB')['vehicle'].get('check') is None
    assert read('invoice', gstin='07ACXPJ3115G1Z')['gstin']['blocking']
    dates = read('goods_receipt', grnDate='02.09.2016', invoiceDate='01.09.2026', gateEntryDate='05.09.2026')
    assert dates['grnDate']['check']['label'].startswith('Date is before GST') and 'check' not in dates['invoiceDate']
    assert dates['gateEntryDate']['check']['label'] == 'Date is after the document was received'


def test_line_and_total_rules():
    fields = list(read('invoice', taxable='72500.00', igst='13050.00', total='85550.00', amountInWords='Rupees Eighty Five Thousand Five Hundred Five Only').values())
    lines = build_lines('invoice', {'lines': [{'description': 'Hose', 'hsn': '4009120', 'qty': '1000', 'rate': '72.50', 'amount': '72500', 'taxRate': '18', 'confidence': 95}]})
    apply_checks('invoice', fields, lines)
    f = {x['key']: x for x in fields}
    assert lines[0]['check']['label'] == 'HSN is 4, 6 or 8 digits' and lines[0]['confidence'] == LOW
    assert f['amountInWords']['check']['label'] == 'Words say 85,505.00' and f['total']['check']['label'] == 'Amount in words says 85,505.00'
    lines = build_lines('invoice', {'lines': [{'description': 'Hose', 'hsn': '40091200', 'qty': '1000', 'rate': '72.50', 'amount': '75000', 'taxRate': '18', 'confidence': 95}]})
    apply_checks('invoice', fields, lines)
    assert lines[0]['check']['label'] == 'Qty × rate = 72,500.00, not 75,000.00'
    assert {x['key']: x for x in fields}['taxable']['check']['label'] == 'Lines add up to 75,000.00'
    po_lines = build_lines('purchase_order', {'lines': [{'description': 'Hose', 'qty': '1000', 'rate': '72.50', 'amount': '85550', 'taxRate': '18', 'confidence': 95}]})
    apply_checks('purchase_order', [], po_lines)
    assert 'check' not in po_lines[0]  # the PO prints amounts with tax


def test_checks_recompute_from_what_was_read():
    fields = list(read('invoice', taxable='100', igst='18', total='200').values())
    f = {x['key']: x for x in fields}
    assert f['total']['confidence'] == LOW and f['total']['read'] == 95
    f['total'].update(value='118')
    apply_checks('invoice', fields, [])
    assert f['total']['confidence'] == 95 and f['total']['check']['tone'] == 'ok'


def test_blocking_error_and_annotations():
    assert blocking_error('invoice', 'irn', IRN[:63]) == 'IRN should be 64 hex characters'
    assert blocking_error('invoice', 'irn', IRN) is None
    assert blocking_error('invoice', 'ewaybill', '7916600637') == 'E-way bill number has 12 digits'
    notes = build_annotations({'stamps': [
        {'type': 'receipt', 'text': 'RECEIPT', 'grnNo': '5-119339', 'gateEntryNo': '183346', 'poNo': '423-1548', 'invoiceNo': None, 'parkPostNo': '5105601213', 'date': '03.09.26',
         'confidence': 90, 'box': {'page': 1, 'x0': 580, 'y0': 470, 'x1': 900, 'y1': 560}},
        {'type': 'signature', 'text': None, 'grnNo': None, 'gateEntryNo': None, 'poNo': None, 'invoiceNo': None, 'parkPostNo': None, 'date': None, 'confidence': 80, 'box': None},
    ]}, pages=1)
    assert len(notes) == 1 and notes[0]['grnNo'] == '5-119339' and notes[0]['confidence'] == 70 and notes[0]['box']['x1'] == 900


def _invoice_doc(db, e, **vals):
    d = SourceDocument(entity_id=e.id, channel='Upload', received_at=datetime.now(UTC), filename='inv.pdf', mime='application/pdf', size=1, sha256='x', storage_path='/x',
                       kind='invoice', status='review', pages=1)
    d.fields = build_fields('invoice', {k: {'value': v, 'confidence': 95} for k, v in vals.items()})
    db.add(d)
    db.flush()
    return d


def test_edit_refuses_impossible_values_and_confirm_waits_for_them(client, db, firm, sign_in):
    f, e, admin = firm
    d = _invoice_doc(db, e, invoiceNo='API/3166', irn=IRN[:63], ewaybill='79166600637')
    sign_in(db.query(User).filter_by(email='ap@apollo.in').one())
    r = client.patch(f'/api/intake/{d.id}/fields', json={'key': 'irn', 'value': IRN[:63]})
    assert r.status_code == 422 and 'IRN should be 64 hex characters' in r.json()['detail']
    r = client.post(f'/api/intake/{d.id}/confirm')
    assert r.status_code == 409 and 'IRN' in r.json()['detail'] and 'E-way bill' in r.json()['detail']
    r = client.patch(f'/api/intake/{d.id}/fields', json={'key': 'irn', 'value': IRN})
    assert r.status_code == 200
    irn = next(x for x in r.json()['fields'] if x['key'] == 'irn')
    assert irn['confidence'] == 100 and irn['edited'] and not irn.get('blocking')
    client.patch(f'/api/intake/{d.id}/fields', json={'key': 'ewaybill', 'value': '791666006375'})
    assert client.post(f'/api/intake/{d.id}/confirm').status_code == 200
