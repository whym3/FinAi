"""One job per uploaded or emailed file: classify → split → turn pages upright → read QR codes → extract each part → link records →
compare the documents with each other → three-way match → queue verification with GST systems."""
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import audit
from ..domain import crosscheck, link, verify
from ..domain.match import refresh_bundle_checks, run_match, tolerances
from ..mail.ingest import store
from ..models import Extraction, PurchaseOrder, SourceDocument, SupplierInvoice
from ..notify import notify
from ..serialize import DOC_KIND_LABEL
from . import ai, codes, render
from .split import clean_rotations, page_count, slice_pdf
from .validate import assess, build_annotations, build_fields, build_lines, values

log = logging.getLogger('pravah.extract')


def _extract_part(db: Session, cfg: ai.Config, part: SourceDocument, data: bytes) -> None:
    rotations = part.page_rotations or []
    try:
        part.codes = codes.decode(data, part.mime, part.pages or 1, rotations)
    except Exception:
        log.exception('QR scan failed for document %s', part.id)
        part.codes = []
    sent, sent_mime = render.for_model(data, part.mime, rotations)
    res = ai.extract(cfg, part.kind, sent, sent_mime, part.filename)
    db.add(Extraction(document_id=part.id, step='extract', model=res.model, status='done', raw=res.raw, input_tokens=res.input_tokens, output_tokens=res.output_tokens))
    pages = part.pages or 1
    fields, lines = build_fields(part.kind, res.raw, pages), build_lines(part.kind, res.raw, pages)
    part.fields = assess(part.kind, fields, lines, part.codes, part.received_at.date() if part.received_at else None)
    part.lines = lines
    part.annotations = build_annotations(res.raw, pages)
    v = values(part.fields)
    part.data = {'number': v.get('invoiceNo') or v.get('poNo') or v.get('grnNo') or v.get('lrNo') or v.get('ticketNo') or v.get('number'),
                 'party': v.get('supplier') or v.get('vendorName') or v.get('transporter') or v.get('party'),
                 'date': v.get('invoiceDate') or v.get('poDate') or v.get('grnDate') or v.get('lrDate') or v.get('date'),
                 **({'printedPages': part.data['printedPages']} if (part.data or {}).get('printedPages') else {})}
    link.apply(db, part)
    crosscheck.doc_status(part, fresh=True)


def _printed_pages(d: dict) -> dict:
    total = d.get('printed_page_total')
    return {'printedPages': total} if isinstance(total, int) and not isinstance(total, bool) and total > 0 else {}


def process_document(db: Session, doc_id: int) -> None:
    doc = db.get(SourceDocument, doc_id)
    if not doc or doc.confirmed_by or doc.status in ('duplicate', 'rejected'):
        return
    cfg = ai.config(db)
    if not cfg.configured:
        doc.status_note = 'No API key for document reading. Set one in Settings → Integrations.'
        db.commit()
        return
    data = Path(doc.storage_path).read_bytes()
    doc.pages = page_count(data, doc.mime)
    try:
        cls = ai.classify(cfg, data, doc.mime, doc.filename)
    except ai.Unsupported as e:
        doc.status, doc.status_note = 'review', str(e)
        db.commit()
        return
    except Exception as e:
        db.add(Extraction(document_id=doc.id, step='classify', model=cfg.model, status='failed', error=f'{type(e).__name__}: {e}'[:2000]))
        doc.status, doc.status_note = 'review', f'Reading failed: {e}'[:300]
        db.commit()
        raise
    db.add(Extraction(document_id=doc.id, step='classify', model=cls.model, status='done', raw=cls.raw, input_tokens=cls.input_tokens, output_tokens=cls.output_tokens))
    found = [d for d in cls.raw.get('documents', []) if d.get('page_from')]
    by_page = {p.get('page'): p.get('rotation') for p in cls.raw.get('pages') or [] if isinstance(p, dict)}
    doc.page_rotations = clean_rotations([by_page.get(i + 1, 0) for i in range(doc.pages)], doc.pages)
    if doc.mime != 'application/pdf' or doc.pages <= 1 or len(found) <= 1:
        doc.kind = found[0]['kind'] if found else 'other'
        doc.page_from, doc.page_to = 1, doc.pages
        doc.data = {**{k: v for k, v in (doc.data or {}).items() if k != 'printedPages'}, **(_printed_pages(found[0]) if found else {})}
        _extract_part(db, cfg, doc, data)
        touched = [doc]
    else:
        # a bundle: one row per document, each its own PDF so it can be viewed and re-read on its own
        doc.kind, doc.status, doc.status_note = 'bundle', 'linked', f'{len(found)} documents'
        existing = {(p.page_from, p.page_to): p for p in db.scalars(select(SourceDocument).where(SourceDocument.bundle_id == doc.id))}
        touched = []
        for d in sorted(found, key=lambda x: x['page_from']):
            pf, pt = int(d['page_from']), int(d.get('page_to') or d['page_from'])
            part = existing.get((pf, pt))
            if part and part.confirmed_by:
                touched.append(part)  # a person confirmed it: keep what they checked
                continue
            if not part:
                pdata = slice_pdf(data, pf, pt)
                sha, path = store(doc.entity_id, pdata)
                part = SourceDocument(entity_id=doc.entity_id, channel=doc.channel, mailbox_id=doc.mailbox_id, sender=doc.sender, subject=doc.subject, received_at=doc.received_at,
                                      uploaded_by=doc.uploaded_by, filename=f'{Path(doc.filename).stem} · p{pf}{"-" + str(pt) if pt != pf else ""}.pdf', mime='application/pdf',
                                      size=len(pdata), sha256=sha, storage_path=path, pages=pt - pf + 1, bundle_id=doc.id, page_from=pf, page_to=pt)
                db.add(part)
            part.kind = d['kind']
            part.page_rotations = clean_rotations(doc.page_rotations[pf - 1:pt], pt - pf + 1)
            part.data = {**{k: v for k, v in (part.data or {}).items() if k != 'printedPages'}, **_printed_pages(d)}
            db.flush()
            if part.kind in ('not_finance', 'other', 'statement', 'quotation'):
                part.fields, part.data = [], {'number': d.get('number'), 'party': d.get('party'), 'date': d.get('date'), **_printed_pages(d)}
                crosscheck.doc_status(part, fresh=True)
            else:
                try:
                    _extract_part(db, cfg, part, Path(part.storage_path).read_bytes())
                except Exception as e:
                    db.add(Extraction(document_id=part.id, step='extract', model=cfg.model, status='failed', error=f'{type(e).__name__}: {e}'[:2000]))
                    part.status, part.status_note = 'review', f'Reading failed: {e}'[:300]
                    log.exception('extract failed for part %s', part.id)
            touched.append(part)
        db.flush()
        crosscheck.run_for_bundle(db, doc, tolerances(db, doc.entity_id))
    # re-link now that every part exists, then match every invoice we touched or that joined a PO
    po_ids = {p.po_id for p in touched if p.po_id}
    for po_id in po_ids:
        po = db.get(PurchaseOrder, po_id)
        if po:
            link.relink_po(db, po)
    inv_ids = {p.invoice_id for p in touched if p.invoice_id}
    grn_ids = {p.grn_id for p in touched if p.grn_id}
    if grn_ids:
        inv_ids |= {i.id for i in db.scalars(select(SupplierInvoice).where(SupplierInvoice.grn_id.in_(grn_ids)))}
    if po_ids:
        inv_ids |= {i.id for i in db.scalars(select(SupplierInvoice).where(SupplierInvoice.po_id.in_(po_ids)))}
    invoices = list(db.scalars(select(SupplierInvoice).where(SupplierInvoice.id.in_(inv_ids)))) if inv_ids else []
    for inv in invoices:
        if inv.status == 'needs-decision':
            run_match(db, inv)
    if doc.kind == 'bundle':
        refresh_bundle_checks(db, doc)
    for inv in invoices:
        if inv.status == 'needs-decision':
            verify.queue(db, inv)
    doc.po_id = doc.po_id or next((p.po_id for p in touched if p.po_id), None)
    kinds = ', '.join(DOC_KIND_LABEL.get(p.kind, p.kind).lower() for p in touched)
    audit(db, None, doc.entity_id, 'Read document', doc.filename, f'{len(touched)} document(s): {kinds}' + (f' · linked to PO {doc.po_id}' if doc.po_id else ''))
    invs = [p for p in touched if p.kind == 'invoice' and p.invoice_id]
    if invs:
        notify(db, doc.entity_id, 'Invoice ready for review' if len(invs) == 1 else f'{len(invs)} invoices ready for review', f'{invs[0].data.get("number")} · {invs[0].data.get("party")}', '/review', 'acc')
    else:
        notify(db, doc.entity_id, 'Document read', f'{doc.filename}: {kinds}', '/intake', 'none')
    db.commit()
