"""A combined PO, invoice and late GRN travels through every document-processing node."""
import hashlib
from datetime import UTC, datetime

from pypdf import PdfWriter

from app.extract import ai
from app.extract import run
from app.models import GoodsReceipt, PurchaseOrder, SourceDocument, SupplierInvoice


def test_bundle_split_link_and_match(db, firm, monkeypatch, tmp_path):
    _, entity, admin = firm
    writer = PdfWriter()
    for _ in range(3):
        writer.add_blank_page(width=595, height=842)
    path = tmp_path / 'bundle.pdf'
    with path.open('wb') as stream:
        writer.write(stream)
    data = path.read_bytes()
    doc = SourceDocument(entity_id=entity.id, channel='Upload', received_at=datetime.now(UTC), uploaded_by=admin.id,
                         filename='bundle.pdf', mime='application/pdf', size=len(data), sha256=hashlib.sha256(data).hexdigest(), storage_path=str(path))
    db.add(doc)
    db.flush()

    monkeypatch.setattr(ai, 'config', lambda _: ai.Config('openai', 'gpt-4.1', 'test-key'))
    monkeypatch.setattr(ai, 'classify', lambda *_: ai.Result({'documents': [
        {'kind': 'purchase_order', 'page_from': 1, 'page_to': 1},
        {'kind': 'invoice', 'page_from': 2, 'page_to': 2},
        {'kind': 'goods_receipt', 'page_from': 3, 'page_to': 3},
    ]}, 0, 0, 'gpt-4.1'))
    rows = {
        'purchase_order': {'poNo': 'PO-3', 'vendorName': 'Supplier', 'total': '118'},
        'invoice': {'invoiceNo': 'INV-3', 'poRef': 'PO-3', 'supplier': 'Supplier', 'taxable': '100', 'igst': '18', 'total': '118'},
        'goods_receipt': {'grnNo': 'GRN-3', 'poNo': 'PO-3', 'invoiceNo': 'INV-3', 'vendorName': 'Supplier'},
    }
    monkeypatch.setattr(ai, 'extract', lambda _cfg, kind, *_: ai.Result(
        {key: {'value': value, 'confidence': 95} for key, value in rows[kind].items()}, 0, 0, 'gpt-4.1'))

    def store(_entity_id, pdf):
        digest = hashlib.sha256(pdf).hexdigest()
        part_path = tmp_path / f'{digest}.pdf'
        part_path.write_bytes(pdf)
        return digest, str(part_path)

    monkeypatch.setattr(run, 'store', store)
    run.process_document(db, doc.id)

    po = db.query(PurchaseOrder).filter_by(entity_id=entity.id, po_no='PO-3').one()
    grn = db.query(GoodsReceipt).filter_by(entity_id=entity.id, grn_no='GRN-3').one()
    inv = db.query(SupplierInvoice).filter_by(entity_id=entity.id, invoice_no='INV-3').one()
    assert doc.kind == 'bundle'
    assert len(db.query(SourceDocument).filter_by(bundle_id=doc.id).all()) == 3
    assert grn.po_id == inv.po_id == po.id
    assert inv.grn_id == grn.id
    assert inv.match['heads'][2]['ref'] == 'GRN-3'
    assert 'grn' not in {flag['key'] for flag in inv.match['flags']}
