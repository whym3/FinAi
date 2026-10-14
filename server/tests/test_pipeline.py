"""The reading pipeline with Claude mocked: classify a 3-page PDF into PO + invoice, split, extract, link and match."""
import io
import json
from datetime import datetime

import pytest
from pypdf import PdfWriter

from app.extract import claude
from app.extract.run import process_document
from app.extract.schemas import FIELD_META, schema_for
from app.extract.validate import build_fields
from app.mail.ingest import ingest_file
from app.models import Job, PurchaseOrder, SourceDocument, SupplierInvoice


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
    monkeypatch.setattr('app.extract.claude.settings.anthropic_api_key', 'test-key')
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

    def fake_call(system, part, schema, max_tokens=8000):
        kind = 'classify' if 'documents' in schema['properties'] else ('invoice' if 'irn' in schema['properties'] else 'purchase_order')
        calls.append(kind)
        return claude.Result(answers[kind], 1000, 200, 'claude-test')
    monkeypatch.setattr(claude, '_call', fake_call)

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
