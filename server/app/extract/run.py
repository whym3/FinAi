"""One job per uploaded or emailed file: classify → split → extract each part → link records → three-way match."""
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import audit
from ..config import settings
from ..domain import link
from ..domain.match import run_match
from ..mail.ingest import store
from ..models import Extraction, PurchaseOrder, SourceDocument, SupplierInvoice
from ..notify import notify
from ..serialize import DOC_KIND_LABEL
from . import claude
from .split import page_count, slice_pdf
from .validate import build_fields, build_lines, values

log = logging.getLogger('pravah.extract')


def _status_for(doc: SourceDocument) -> None:
    if doc.kind == 'not_finance':
        doc.status, doc.status_note = 'notfinance', 'Read as not a finance document'
        return
    if doc.status == 'duplicate':
        return
    low = sum(1 for x in doc.fields if x['confidence'] < 90)
    doc.status = 'review' if (low or not doc.fields) else 'new'
    doc.status_note = f'{low} field(s) to confirm' if low else ('All fields read with high confidence' if doc.fields else 'Nothing could be read')


def _extract_part(db: Session, part: SourceDocument, data: bytes) -> None:
    res = claude.extract(part.kind, data, part.mime, part.filename)
    db.add(Extraction(document_id=part.id, step='extract', model=res.model, status='done', raw=res.raw, input_tokens=res.input_tokens, output_tokens=res.output_tokens))
    part.fields, part.lines = build_fields(part.kind, res.raw), build_lines(part.kind, res.raw)
    v = values(part.fields)
    part.data = {'number': v.get('invoiceNo') or v.get('poNo') or v.get('grnNo') or v.get('lrNo') or v.get('ticketNo') or v.get('number'),
                 'party': v.get('supplier') or v.get('vendorName') or v.get('transporter') or v.get('party'),
                 'date': v.get('invoiceDate') or v.get('poDate') or v.get('grnDate') or v.get('lrDate') or v.get('date')}
    link.apply(db, part)
    _status_for(part)


def process_document(db: Session, doc_id: int) -> None:
    doc = db.get(SourceDocument, doc_id)
    if not doc or doc.confirmed_by or doc.status in ('duplicate', 'rejected'):
        return
    if not claude.configured():
        doc.status_note = 'Claude is not configured on the server (ANTHROPIC_API_KEY)'
        db.commit()
        return
    data = Path(doc.storage_path).read_bytes()
    doc.pages = page_count(data, doc.mime)
    try:
        cls = claude.classify(data, doc.mime, doc.filename)
    except claude.Unsupported as e:
        doc.status, doc.status_note = 'review', str(e)
        db.commit()
        return
    except Exception as e:
        db.add(Extraction(document_id=doc.id, step='classify', model=settings.anthropic_model, status='failed', error=f'{type(e).__name__}: {e}'[:2000]))
        doc.status, doc.status_note = 'review', f'Reading failed: {e}'[:300]
        db.commit()
        raise
    db.add(Extraction(document_id=doc.id, step='classify', model=cls.model, status='done', raw=cls.raw, input_tokens=cls.input_tokens, output_tokens=cls.output_tokens))
    found = [d for d in cls.raw.get('documents', []) if d.get('page_from')]
    if doc.mime != 'application/pdf' or doc.pages <= 1 or len(found) <= 1:
        doc.kind = found[0]['kind'] if found else 'other'
        doc.page_from, doc.page_to = 1, doc.pages
        _extract_part(db, doc, data)
        touched = [doc]
    else:
        # a bundle: one row per document, each its own PDF so it can be viewed and re-read on its own
        doc.kind, doc.status, doc.status_note = 'bundle', 'linked', f'{len(found)} documents'
        existing = {(p.page_from, p.page_to): p for p in db.scalars(select(SourceDocument).where(SourceDocument.bundle_id == doc.id))}
        touched = []
        for d in sorted(found, key=lambda x: x['page_from']):
            pf, pt = int(d['page_from']), int(d.get('page_to') or d['page_from'])
            part = existing.get((pf, pt))
            if not part:
                pdata = slice_pdf(data, pf, pt)
                sha, path = store(doc.entity_id, pdata)
                part = SourceDocument(entity_id=doc.entity_id, channel=doc.channel, mailbox_id=doc.mailbox_id, sender=doc.sender, subject=doc.subject, received_at=doc.received_at,
                                      uploaded_by=doc.uploaded_by, filename=f'{Path(doc.filename).stem} · p{pf}{"-" + str(pt) if pt != pf else ""}.pdf', mime='application/pdf',
                                      size=len(pdata), sha256=sha, storage_path=path, pages=pt - pf + 1, bundle_id=doc.id, page_from=pf, page_to=pt)
                db.add(part)
            part.kind = d['kind']
            db.flush()
            if part.kind in ('not_finance', 'other', 'statement', 'quotation'):
                part.fields, part.data = [], {'number': d.get('number'), 'party': d.get('party'), 'date': d.get('date')}
                _status_for(part)
            else:
                try:
                    _extract_part(db, part, Path(part.storage_path).read_bytes())
                except Exception as e:
                    db.add(Extraction(document_id=part.id, step='extract', model=settings.anthropic_model, status='failed', error=f'{type(e).__name__}: {e}'[:2000]))
                    part.status, part.status_note = 'review', f'Reading failed: {e}'[:300]
                    log.exception('extract failed for part %s', part.id)
            touched.append(part)
        db.flush()
    # re-link now that every part exists, then match every invoice we touched or that joined a PO
    po_ids = {p.po_id for p in touched if p.po_id}
    for po_id in po_ids:
        po = db.get(PurchaseOrder, po_id)
        if po:
            link.relink_po(db, po)
    inv_ids = {p.invoice_id for p in touched if p.invoice_id}
    if po_ids:
        inv_ids |= {i.id for i in db.scalars(select(SupplierInvoice).where(SupplierInvoice.po_id.in_(po_ids)))}
    for inv in (db.scalars(select(SupplierInvoice).where(SupplierInvoice.id.in_(inv_ids))) if inv_ids else []):
        if inv.status == 'needs-decision':
            run_match(db, inv)
    doc.po_id = doc.po_id or next((p.po_id for p in touched if p.po_id), None)
    kinds = ', '.join(DOC_KIND_LABEL.get(p.kind, p.kind).lower() for p in touched)
    audit(db, None, doc.entity_id, 'Read document', doc.filename, f'{len(touched)} document(s): {kinds}' + (f' · linked to PO {doc.po_id}' if doc.po_id else ''))
    invs = [p for p in touched if p.kind == 'invoice' and p.invoice_id]
    if invs:
        notify(db, doc.entity_id, 'Invoice ready for review' if len(invs) == 1 else f'{len(invs)} invoices ready for review', f'{invs[0].data.get("number")} · {invs[0].data.get("party")}', '/review', 'acc')
    else:
        notify(db, doc.entity_id, 'Document read', f'{doc.filename}: {kinds}', '/intake', 'none')
    db.commit()
