"""The reading pipeline with the model mocked: classify a 3-page PDF into PO + invoice, split, extract, link and match."""
import io
import json
from datetime import datetime

import pytest
from pypdf import PdfWriter

from app import crypto
from app.extract import ai
from app.extract.run import process_document
from app.extract.schemas import FIELD_META, schema_for
from app.extract.validate import build_fields
from app.mail.ingest import ingest_file
from app.models import AiSetting, Job, PurchaseOrder, SourceDocument, SupplierInvoice


def pdf(pages: int) -> bytes:
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=200, height=200)
    b = io.BytesIO()
    w.write(b)
    return b.getvalue()


def test_schemas_are_strict():
    for kind in FIELD_META:
        s = schema_for(kind)
        assert s['additionalProperties'] is False and set(s['required']) == set(s['properties'])


def test_validate_checks():
    f = {x['key']: x for x in build_fields('invoice', {'gstin': {'value': '27AAPFU0939F1ZA', 'confidence': 95}, 'billTo': {'value': '29AAGCB7383J1Z4', 'confidence': 95},
                                                       'taxable': {'value': '89000', 'confidence': 95}, 'cgst': {'value': '8010', 'confidence': 95}, 'sgst': {'value': '8010', 'confidence': 95},
                                                       'total': {'value': '110000', 'confidence': 95}, 'irn': {'value': 'abc', 'confidence': 95}})}
    assert f['gstin']['confidence'] == 60 and f['total']['confidence'] == 60 and f['cgst']['confidence'] == 60 and f['irn']['confidence'] == 60
    w = {x['key']: x for x in build_fields('weighbridge', {'grossKg': {'value': '3170', 'confidence': 90}, 'tareKg': {'value': '3060', 'confidence': 90}, 'netKg': {'value': '110', 'confidence': 90}})}
    assert w['netKg']['check']['tone'] == 'ok'


def test_bundle_pipeline(db, firm, tmp_path, monkeypatch):
    f, e, admin = firm
    monkeypatch.setattr('app.mail.ingest.settings.storage_dir', str(tmp_path))
    db.add(AiSetting(provider='anthropic', model='claude-test', enc_api_key=crypto.encrypt('test-key')))
    db.flush()
    F = lambda v, c=95: {'value': v, 'confidence': c}
    answers = {
        'classify': {'documents': [{'page_from': 1, 'page_to': 2, 'kind': 'invoice', 'number': 'API/3166', 'date': '01-09-2026', 'party': 'Akshay', 'confidence': 95},
                                   {'page_from': 3, 'page_to': 3, 'kind': 'purchase_order', 'number': '4230001548', 'date': '08-08-2026', 'party': 'Apollo', 'confidence': 95}]},
        'invoice': {'supplier': F('AKSHAY PLASTIC INDUSTRIES'), 'gstin': F('07ACXPJ3115G1ZJ'), 'billTo': F('09AAACA1199D1ZW'), 'invoiceNo': F('API/3166'), 'invoiceDate': F('01-09-2026'),
                    'irn': F('8d64fa741acb8b7521cb78c5466c15bbfee5493a4e0db77a82a6f0a04ec2ebfd'), 'pos': F('Uttar Pradesh (09)'), 'poRef': F('4230001548'), 'ewaybill': F('791666006375'), 'vehicle': F('DL01LV1851'),
                    'transporter': F('AASH'), 'paymentTerms': F('30 DAYS CREDIT'), 'taxable': F('72500.00'), 'igst': F('13050.00'), 'freight': F('0.00'), 'total': F('85550.00'),
                    **{k: F(None, 0) for k in ('supplierPan', 'billToName', 'ackNo', 'reverseCharge', 'cgst', 'sgst', 'otherCharges', 'roundOff', 'bankAccount', 'ifsc')},
                    'lines': [{'description': 'SS BRAIDED HOSE', 'hsn': '40091200', 'qty': '1000', 'unit': 'Pcs', 'rate': '72.50', 'amount': '72500.00', 'taxRate': '18', 'confidence': 95}]},
        'purchase_order': {'poNo': F('4230001548'), 'poDate': F('08.08.2026'), 'vendorCode': F('1003071'), 'vendorName': F('Akshay Plastic Industries'), 'vendorGstin': F('07ACXPJ3115G1ZJ'),
                           'buyerName': F('Apollo Pipes'), 'buyerGstin': F('09AAACA1199D1ZW'), 'plant': F('Dadri'), 'paymentTerms': F('After Receipt Of Material 30 Days'), 'freightTerms': F('FREIGHT EXTRA AS ACTUAL'),
                           'deliveryTerms': F(None, 0), 'buyerContact': F(None, 0), 'taxable': F('72500.00'), 'tax': F('13050.00'), 'total': F('85550.00'),
                           'lines': [{'item': '10', 'materialCode': 'BPTAXXXX24BKHXSS', 'description': 'SS Black hose', 'hsn': '39229000', 'unit': 'PC', 'qty': '1000', 'rate': '72.50', 'taxRate': '18', 'amount': '72500.00', 'deliveryDate': '19.08.2026', 'confidence': 95}]},
    }
    calls = []

    def fake_call(cfg, system, data, mime, filename, schema, max_tokens=8000):
        kind = 'classify' if 'documents' in schema['properties'] else ('invoice' if 'irn' in schema['properties'] else 'purchase_order')
        calls.append(kind)
        return ai.Result(answers[kind], 1000, 200, 'claude-test')
    monkeypatch.setattr(ai, '_call', fake_call)

    doc = ingest_file(db, e.id, 'bundle.pdf', 'application/pdf', pdf(3), 'Upload', 'ap@apollo.in', uploaded_by=admin.id)
    db.commit()
    assert db.query(Job).filter_by(kind='process').count() == 1
    process_document(db, doc.id)
    db.refresh(doc)
    assert doc.kind == 'bundle' and doc.pages == 3 and calls == ['classify', 'invoice', 'purchase_order']
    parts = db.query(SourceDocument).filter_by(bundle_id=doc.id).order_by(SourceDocument.page_from).all()
    assert [(p.kind, p.page_from, p.page_to, p.pages) for p in parts] == [('invoice', 1, 2, 2), ('purchase_order', 3, 3, 1)]
    po = db.query(PurchaseOrder).filter_by(po_no='4230001548').one()
    inv = db.query(SupplierInvoice).filter_by(invoice_no='API/3166').one()
    assert inv.po_id == po.id and parts[0].invoice_id == inv.id and parts[1].po_id == po.id and doc.po_id == po.id
    assert {fl['key'] for fl in inv.match['flags']} == {'hsn', 'grn'}  # no GRN in this bundle, HSN differs
    assert parts[0].status == 'new' and 'high confidence' in parts[0].status_note
    # the same file again is a duplicate and is not re-read
    dup = ingest_file(db, e.id, 'bundle-again.pdf', 'application/pdf', pdf(3), 'Upload', 'ap@apollo.in')
    assert dup.status == 'duplicate' and dup.duplicate_of == doc.id and db.query(Job).filter_by(kind='process').count() == 1


def test_pipeline_turns_pages_and_keeps_boxes_stamps_and_confirmed_parts(db, firm, tmp_path, monkeypatch):
    f, e, admin = firm
    monkeypatch.setattr('app.mail.ingest.settings.storage_dir', str(tmp_path))
    db.add(AiSetting(provider='anthropic', model='claude-test', enc_api_key=crypto.encrypt('test-key')))
    db.flush()
    box = {'page': 1, 'x0': 100, 'y0': 200, 'x1': 300, 'y1': 240}
    F = lambda v, c=95: {'value': v, 'confidence': c, 'box': box}
    answers = {
        'classify': {'documents': [{'page_from': 1, 'page_to': 1, 'kind': 'invoice', 'number': 'API/3166', 'date': None, 'party': None, 'printed_page_total': None, 'confidence': 95},
                                   {'page_from': 2, 'page_to': 2, 'kind': 'goods_receipt', 'number': '5000119339', 'date': None, 'party': None, 'printed_page_total': 2, 'confidence': 95}],
                     'pages': [{'page': 1, 'rotation': 0}, {'page': 2, 'rotation': 90}]},
        'invoice': {'supplier': F('AKSHAY PLASTIC INDUSTRIES'), 'gstin': F('07ACXPJ3115G1ZJ'), 'billTo': F('09AAACA1199D1ZW'), 'invoiceNo': F('API/3166'), 'invoiceDate': F('01-09-2026'),
                    'poRef': F('4230001548'), 'taxable': F('100.00'), 'igst': F('18.00'), 'total': F('118.00'),
                    'stamps': [{'type': 'receipt', 'text': 'RECEIPT', 'grnNo': '5-119339', 'gateEntryNo': None, 'poNo': None, 'invoiceNo': None, 'parkPostNo': None, 'date': None,
                                'confidence': 90, 'box': {'page': 1, 'x0': 500, 'y0': 400, 'x1': 900, 'y1': 520}}]},
        'goods_receipt': {'grnNo': F('5000119339'), 'grnDate': F('02.09.2026'), 'poNo': F('4230001548'), 'invoiceNo': F('API/3166'), 'vendorName': F('Akshay Plastic Industries')},
    }
    sent = []

    def fake_call(cfg, system, data, mime, filename, schema, max_tokens=8000):
        kind = 'classify' if 'documents' in schema['properties'] else ('invoice' if 'irn' in schema['properties'] else 'goods_receipt')
        sent.append((kind, data))
        return ai.Result(answers[kind], 1000, 200, 'claude-test')
    monkeypatch.setattr(ai, '_call', fake_call)
    doc = ingest_file(db, e.id, 'turned.pdf', 'application/pdf', pdf(2), 'Upload', 'ap@apollo.in', uploaded_by=admin.id)
    db.commit()
    process_document(db, doc.id)
    db.refresh(doc)
    assert doc.page_rotations == [0, 90]
    inv_part, grn_part = db.query(SourceDocument).filter_by(bundle_id=doc.id).order_by(SourceDocument.page_from).all()
    assert inv_part.page_rotations == [0] and grn_part.page_rotations == [90]
    from pypdf import PdfReader
    grn_sent = next(data for kind, data in sent if kind == 'goods_receipt')
    assert PdfReader(io.BytesIO(grn_sent)).pages[0].rotation == 90  # the model sees the page upright
    assert next(x for x in inv_part.fields if x['key'] == 'invoiceNo')['box'] == box
    assert inv_part.annotations[0]['grnNo'] == '5-119339' and inv_part.annotations[0]['confidence'] == 70
    assert grn_part.data['printedPages'] == 2 and grn_part.status_note.startswith('Page 2 of 2 missing')
    checks = doc.data['checks']
    assert {fd['fact']: fd['state'] for fd in checks['findings']}['grn_no'] == 'agree' and checks['verdict']['state'] == 'issues'
    # a part a person confirmed is not read again
    grn_part.confirmed_by = admin.id
    db.commit()
    sent.clear()
    process_document(db, doc.id)
    assert [kind for kind, _ in sent] == ['classify', 'invoice']
