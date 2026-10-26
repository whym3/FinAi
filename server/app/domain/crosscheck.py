"""The same facts appear on several documents of one delivery: invoice no. on the invoice, GRN, LR and the stores stamp; vehicle on the
invoice, LR, weighbridge and gate sheet. Compare them, mark the reading that disagrees with the others, and say whether what is left
is a misread for a person to fix or a real difference to decide on. The verdict sums up what still stands between a bundle and approval."""
import difflib
import re
from copy import deepcopy

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..extract.validate import INVOICE_KINDS, LOW, norm_code, norm_vehicle, to_date, to_num
from ..models import DispatchDoc, Party, PurchaseOrder, SourceDocument, SupplierInvoice
from ..serialize import DOC_KIND_LABEL
from .link import _name_key

LORRY = ('lorry_receipt', 'eway_bill')
SLIPS = ('consignment_note', 'gate_entry')
GRN = ('goods_receipt',)
PO = ('purchase_order',)
# fact, label, comparison, [(kinds, field key)], stamp key, e-invoice QR key
FACTS = [
    ('invoice_no', 'Invoice no.', 'ref', [(INVOICE_KINDS, 'invoiceNo'), (GRN, 'invoiceNo'), (GRN, 'challanNo'), (LORRY, 'invoiceNo')], 'invoiceNo', 'DocNo'),
    ('invoice_date', 'Invoice date', 'date', [(INVOICE_KINDS, 'invoiceDate'), (GRN, 'invoiceDate'), (GRN, 'challanDate')], None, 'DocDt'),
    ('po_no', 'PO number', 'ref', [(INVOICE_KINDS, 'poRef'), (PO, 'poNo'), (GRN, 'poNo')], 'poNo', None),
    ('supplier_gstin', 'Supplier GSTIN', 'code', [(INVOICE_KINDS, 'gstin'), (PO, 'vendorGstin'), (GRN, 'vendorGstin')], None, 'SellerGstin'),
    ('buyer_gstin', 'Buyer GSTIN', 'code', [(INVOICE_KINDS, 'billTo'), (PO, 'buyerGstin')], None, 'BuyerGstin'),
    ('vehicle', 'Vehicle', 'vehicle', [(INVOICE_KINDS, 'vehicle'), (LORRY, 'vehicle'), (('weighbridge',), 'vehicle'), (SLIPS, 'vehicle'), (GRN, 'vehicle')], None, None),
    ('ewaybill', 'E-way bill', 'digits', [(INVOICE_KINDS, 'ewaybill'), (LORRY, 'ewaybill'), (GRN, 'ewaybill')], None, None),
    ('irn', 'IRN', 'code', [(INVOICE_KINDS, 'irn')], None, 'Irn'),
    ('lr_no', 'LR number', 'ref', [(('lorry_receipt',), 'lrNo'), (GRN, 'lrNo')], None, None),
    ('grn_no', 'GRN number', 'ref', [(GRN, 'grnNo')], 'grnNo', None),
    ('gate_entry_no', 'Gate entry no.', 'ref', [(GRN, 'gateEntryNo')], 'gateEntryNo', None),
    ('sap_doc', 'SAP document no.', 'ref', [], 'parkPostNo', None),
    ('transporter', 'Transporter', 'name', [(INVOICE_KINDS, 'transporter'), (LORRY, 'transporter'), (GRN, 'transporter'), (SLIPS, 'transporter')], None, None),
    ('invoice_value', 'Invoice value', 'money', [(INVOICE_KINDS, 'total'), (LORRY, 'invoiceValue')], None, 'TotInvVal'),
    ('packages', 'Packages', 'count', [(LORRY, 'packages'), (SLIPS, 'packages')], None, None),
    ('weight', 'Weight (kg)', 'weight', [(LORRY, 'weightKg'), (SLIPS, 'weightKg'), (('weighbridge',), 'netKg')], None, None),
]
FACT_LABEL = {f[0]: f[1] for f in FACTS}
# the document that issues a number reads it best: it wins a tie against a copy of the number on another document
HOME = {'irn': INVOICE_KINDS, 'invoice_no': INVOICE_KINDS, 'invoice_date': INVOICE_KINDS, 'invoice_value': INVOICE_KINDS, 'supplier_gstin': INVOICE_KINDS, 'buyer_gstin': INVOICE_KINDS,
        'ewaybill': INVOICE_KINDS, 'po_no': PO, 'grn_no': GRN, 'gate_entry_no': GRN, 'lr_no': ('lorry_receipt',)}
STAMP_REFS = ('grnNo', 'gateEntryNo', 'poNo', 'invoiceNo', 'parkPostNo')
NAME_NOISE = {'m', 's', 'ms', 'pvt', 'private', 'ltd', 'limited', 'co', 'company', 'llp', 'inc', 'the', 'and'}
STRONG = ('qr', 'confirmed', 'master')
WEIGHT = {'qr': 3.0, 'confirmed': 3.0, 'master': 2.0}
PHYSICAL = ('weight',)
# Date order a delivery follows; a document may share a day with the one before it.
DATE_ORDER = [('purchase_order', 'poDate'), ('invoice', 'invoiceDate'), ('lorry_receipt', 'lrDate'), ('weighbridge', 'date'), ('gate_entry', 'date'), ('goods_receipt', 'grnDate')]
CORE_KINDS = ('invoice', 'purchase_order', 'goods_receipt')


def doc_label(d: SourceDocument) -> str:
    label = DOC_KIND_LABEL.get(d.kind, d.kind)
    if d.page_from:
        label += f' (p{d.page_from}{"–" + str(d.page_to) if d.page_to and d.page_to != d.page_from else ""})'
    return label


def _ref_norm(v: str) -> str:
    return re.sub(r'[^A-Z0-9-]', '', str(v).upper())


def same_ref(a: str, b: str) -> bool:
    """Equal references, allowing the short forms people write: '3166' for 'API/3166', '5-119339' for '5000119339'."""
    x, y = _ref_norm(a), _ref_norm(b)
    if not x or not y:
        return False
    if x.replace('-', '').lstrip('0') == y.replace('-', '').lstrip('0'):
        return True
    for p, q in ((x, y), (y, x)):
        tail = re.search(r'(\d+)$', q.replace('-', ''))
        if p.isdigit() and tail and len(p) >= 3 and tail.group(1) == p and p != q:
            return True
        if p.count('-') == 1 and '-' not in q:
            head, rest = p.split('-')
            if head and rest and re.fullmatch(re.escape(head) + '0*' + re.escape(rest), q):
                return True
    return False


def _norm(how: str, v: str):
    if how == 'ref':
        return _ref_norm(v) or None
    if how == 'date':
        d = to_date(v)
        return d.isoformat() if d else None
    if how == 'code':
        return norm_code(v)
    if how == 'vehicle':
        return norm_vehicle(v)
    if how == 'digits':
        return re.sub(r'\D', '', str(v)) or None
    if how == 'name':
        words = [w for w in re.sub(r'[^a-z0-9 ]', ' ', str(v).lower()).split() if w not in NAME_NOISE]
        return _name_key(' '.join(words)) or None
    return to_num(v)


def _same(how: str, a, b, tol: dict) -> bool:
    if how == 'ref':
        return same_ref(a, b)
    if how == 'name':
        return a == b or (min(len(a), len(b)) >= 5 and (a.startswith(b) or b.startswith(a))) or difflib.SequenceMatcher(None, a, b).ratio() >= 0.92
    if how == 'money':
        return abs(a - b) <= tol.get('total_inr', 10.0)
    if how == 'count':
        return abs(a - b) < 0.001
    if how == 'weight':
        return abs(a - b) <= max(tol.get('weight_kg', 5.0), max(abs(a), abs(b)) * tol.get('weight_pct', 10.0) / 100)
    return a == b


def _weight(o: dict) -> float:
    w = WEIGHT.get(o['source']) or (1.0 if o['confidence'] >= 90 else 0.5)
    return w + (0.25 if o['source'] == 'printed' and o.get('home') else 0)


def _paper(o: dict):
    """Readings of the same piece of paper count once: the invoice and its transporter or triplicate copies are one print."""
    if o['source'] in ('qr', 'master'):
        return o['source']
    if o.get('annotation') is not None:
        return (o['docId'], o['annotation'])
    return o.get('paper', o['docId'])


def _group_weight(g: list[dict]) -> float:
    best: dict = {}
    for o in g:
        k = _paper(o)
        best[k] = max(best.get(k, 0.0), _weight(o))
    return sum(best.values())


def observations(docs: list[SourceDocument], extra: dict[str, list[dict]] | None = None) -> dict[str, list[dict]]:
    """Every reading of every fact in the documents: {fact: [obs]}."""
    out: dict[str, list[dict]] = {f[0]: list((extra or {}).get(f[0], [])) for f in FACTS}
    for d in docs:
        fields = {f['key']: f for f in d.fields or []}
        qr = next((c['einvoice'] for c in d.codes or [] if c.get('einvoice')), None) if d.kind in INVOICE_KINDS else None
        paper = ('invoice', d.invoice_id) if d.kind in INVOICE_KINDS and d.invoice_id else d.id
        for fact, _label, how, sources, stamp_key, qr_key in FACTS:
            for kinds, key in sources:
                f = fields.get(key)
                if d.kind in kinds and f and f.get('value'):
                    norm = _norm(how, f['value'])
                    if norm is not None:
                        out[fact].append({'docId': d.id, 'kind': d.kind, 'doc': doc_label(d), 'key': key, 'label': f['label'], 'value': f['value'], 'norm': norm,
                                          'confidence': f.get('baseConfidence', f['confidence']), 'source': 'confirmed' if f.get('confirmedBy') else 'printed', 'home': d.kind in HOME.get(fact, ()), 'paper': paper})
            if stamp_key:
                for i, a in enumerate(d.annotations or []):
                    if a.get(stamp_key):
                        norm = _norm(how, a[stamp_key])
                        if norm is not None:
                            out[fact].append({'docId': d.id, 'kind': d.kind, 'doc': doc_label(d) + ' · stamp', 'key': stamp_key, 'annotation': i, 'label': FACT_LABEL[fact],
                                              'value': a[stamp_key], 'norm': norm, 'confidence': a.get('baseConfidence', a.get('confidence', 0)), 'source': 'confirmed' if a.get('confirmedBy') else 'stamp'})
            if qr_key and qr and qr.get(qr_key):
                norm = _norm(how, qr[qr_key])
                if norm is not None:
                    out[fact].append({'docId': d.id, 'kind': d.kind, 'doc': doc_label(d) + ' · QR code', 'key': None, 'label': FACT_LABEL[fact],
                                      'value': qr[qr_key], 'norm': norm, 'confidence': 100, 'source': 'qr'})
    return {k: v for k, v in out.items() if v}


def _groups(how: str, obs: list[dict], tol: dict) -> list[list[dict]]:
    groups: list[list[dict]] = []
    for o in obs:
        g = next((g for g in groups if _same(how, g[0]['norm'], o['norm'], tol)), None)
        if g is None:
            groups.append([o])
        else:
            g.append(o)
    return sorted(groups, key=lambda g: -_group_weight(g))


def _strong(o: dict) -> bool:
    return o['source'] in STRONG


def compare(docs: list[SourceDocument], tol: dict, extra: dict[str, list[dict]] | None = None) -> list[dict]:
    """Findings: one per fact read on more than one document or source, plus date order and missing pages."""
    findings = []
    hows = {f[0]: f[2] for f in FACTS}
    for fact, obs in observations(docs, extra).items():
        how = hows[fact]
        sources = {(o['docId'], o.get('annotation'), o['source'] == 'qr') for o in obs}
        groups = _groups(how, obs, tol)
        base = {'fact': fact, 'label': FACT_LABEL[fact]}
        if len(groups) == 1:
            for o in obs:
                o['outlier'] = False
            findings.append({**base, 'state': 'agree' if len(sources) > 1 else 'single', 'severity': 'ok', 'consensus': obs[0]['value'], 'detail': '', 'observations': obs})
            continue
        weights = [_group_weight(g) for g in groups]
        if weights[0] > weights[1]:
            top, rest = groups[0], [o for g in groups[1:] for o in g]
            consensus = next((o['value'] for o in top if o['source'] == 'qr'), None) or next((o['value'] for o in top if _strong(o)), None) or top[0]['value']
            for o in top:
                o['outlier'] = False
            for o in rest:
                o['outlier'] = True
            if fact in PHYSICAL:
                severity = 'warn'
            elif all(_strong(o) for o in rest) and any(_strong(o) or o['confidence'] >= 90 for o in top):
                severity = 'discrepancy'
            else:
                severity = 'misread'
            shown_by = ', '.join(sorted({o['doc'] for o in top}))
            findings.append({**base, 'state': 'differ', 'severity': severity, 'consensus': consensus, 'shownBy': shown_by,
                             'detail': '; '.join(f'{o["doc"]} reads {o["value"]}' for o in rest) + f'; {shown_by} show {consensus}', 'observations': obs})
        else:
            for o in obs:
                o['outlier'] = True
            severity = 'warn' if fact in PHYSICAL else 'discrepancy' if all(_strong(o) for o in obs) else 'misread'
            findings.append({**base, 'state': 'differ', 'severity': severity, 'consensus': None,
                             'detail': 'Documents disagree: ' + '; '.join(f'{o["doc"]} says {o["value"]}' for o in obs), 'observations': obs})
    findings += _date_order(docs)
    findings += _missing_pages(docs)
    return findings


def _date_order(docs: list[SourceDocument]) -> list[dict]:
    dated = []
    for kind, key in DATE_ORDER:
        for d in docs:
            if d.kind != kind:
                continue
            f = next((f for f in d.fields or [] if f['key'] == key), None)
            day = to_date(f['value']) if f else None
            if day:
                dated.append((kind, d, f, day))
                break
    out = []
    for i, (k1, d1, f1, day1) in enumerate(dated):
        for k2, d2, f2, day2 in dated[i + 1:]:
            if day2 < day1:
                both_sure = all(f.get('confirmedBy') or f.get('baseConfidence', f['confidence']) >= 90 for f in (f1, f2))
                obs = [{'docId': d.id, 'kind': d.kind, 'doc': doc_label(d), 'key': f['key'], 'label': f['label'], 'value': f['value'], 'norm': day.isoformat(),
                        'confidence': f.get('baseConfidence', f['confidence']), 'source': 'confirmed' if f.get('confirmedBy') else 'printed', 'outlier': True}
                       for d, f, day in ((d1, f1, day1), (d2, f2, day2))]
                out.append({'fact': 'date_order', 'label': 'Date order', 'state': 'differ', 'severity': 'discrepancy' if both_sure else 'misread', 'consensus': None,
                            'detail': f'{doc_label(d2)} is dated {f2["value"]}, before the {doc_label(d1)} of {f1["value"]}', 'observations': obs})
    return out


def _missing_pages(docs: list[SourceDocument]) -> list[dict]:
    out = []
    for d in docs:
        total = (d.data or {}).get('printedPages')
        if isinstance(total, int) and total > (d.pages or 1):
            out.append({'fact': 'pages_missing', 'label': 'Pages missing', 'state': 'differ', 'severity': 'discrepancy' if d.kind in CORE_KINDS else 'warn',
                        'consensus': None, 'docId': d.id, 'detail': f'{doc_label(d)} prints {total} pages; {d.pages or 1} received', 'observations': []})
    return out


def apply(docs: list[SourceDocument], findings: list[dict]) -> None:
    """Mark the readings that disagree. Recomputed from each field's own confidence every time, so running it again never compounds."""
    marks: dict[tuple, dict] = {}
    for fd in findings:
        if fd['severity'] not in ('misread', 'discrepancy') or fd['fact'] in ('date_order', 'pages_missing'):
            continue
        for o in fd['observations']:
            if not o.get('outlier') or o['source'] in ('qr', 'master'):
                continue
            label = f'{fd["shownBy"]} show {fd["consensus"]}' if fd.get('consensus') else fd['detail']
            tone = 'bad' if fd.get('consensus') else 'warn'
            marks[(o['docId'], o.get('annotation'), o['key'])] = {'tone': tone, 'label': label}
    for d in docs:
        fields = deepcopy(d.fields or [])
        for f in fields:
            f.pop('xcheck', None)
            f.setdefault('baseConfidence', f['confidence'])
            if not f.get('confirmedBy'):
                f['confidence'] = f['baseConfidence']
            mark = marks.get((d.id, None, f['key']))
            if mark:
                f['xcheck'] = mark
                if not f.get('confirmedBy'):
                    f['confidence'] = min(f['confidence'], LOW)
        d.fields = fields
        notes = deepcopy(d.annotations or [])
        for i, a in enumerate(notes):
            a.pop('xcheck', None)
            a.setdefault('baseConfidence', a.get('confidence', 0))
            if not a.get('confirmedBy'):
                a['confidence'] = a['baseConfidence']
            mark = next((m for (doc_id, idx, _k), m in marks.items() if doc_id == d.id and idx == i), None)
            if mark:
                a['xcheck'] = mark
                if not a.get('confirmedBy'):
                    a['confidence'] = min(a['confidence'], LOW)
        d.annotations = notes
        doc_status(d)


def checkable(a: dict) -> bool:
    """A stamp or note worth a person's check: it carries a reference the other documents can be compared with."""
    return any(a.get(k) for k in STAMP_REFS)


def doc_status(doc: SourceDocument, fresh: bool = False) -> None:
    """Status from the weakest field: right after a read (fresh), or later for documents still open and unconfirmed."""
    if doc.kind == 'not_finance' and (fresh or not doc.confirmed_by):
        doc.status, doc.status_note = 'notfinance', 'Read as not a finance document'
        return
    if (fresh and doc.status == 'duplicate') or (not fresh and (doc.confirmed_by or doc.status not in ('new', 'review'))):
        return
    low = sum(1 for x in doc.fields or [] if x['confidence'] < 90 and not x.get('confirmedBy'))
    low += sum(1 for a in doc.annotations or [] if checkable(a) and a.get('confidence', 0) < 90 and not a.get('confirmedBy'))
    total = (doc.data or {}).get('printedPages')
    missing = f'Page {(doc.pages or 1) + 1} of {total} missing' if isinstance(total, int) and total > (doc.pages or 1) else ''
    doc.status = 'review' if (low or not doc.fields or missing) else 'new'
    note = f'{low} field(s) to confirm' if low else ('All fields read with high confidence' if doc.fields else 'Nothing could be read')
    doc.status_note = f'{missing} · {note}' if missing else note


def run_for_bundle(db: Session, bundle: SourceDocument, tol: dict) -> list[dict]:
    parts = [p for p in db.scalars(select(SourceDocument).where(SourceDocument.bundle_id == bundle.id)) if p.status not in ('rejected', 'notfinance')]
    findings = compare(parts, tol)
    apply(parts, findings)
    return findings


def group_for_invoice(db: Session, inv: SupplierInvoice) -> list[SourceDocument]:
    """The documents of this one delivery: the invoice and its copies, its bundle, its PO, its GRN, and transport papers that point at it."""
    q = select(SourceDocument).where(SourceDocument.entity_id == inv.entity_id, SourceDocument.kind != 'bundle', SourceDocument.duplicate_of.is_(None),
                                     SourceDocument.status.notin_(('rejected', 'notfinance')))
    conds = [SourceDocument.invoice_id == inv.id]
    if inv.po_id:
        conds.append((SourceDocument.po_id == inv.po_id) & (SourceDocument.kind == 'purchase_order'))
    if inv.grn_id:
        conds.append(SourceDocument.grn_id == inv.grn_id)
    disp_ids = []
    for dd in db.scalars(select(DispatchDoc).where(DispatchDoc.entity_id == inv.entity_id, or_(DispatchDoc.po_id == inv.po_id, DispatchDoc.grn_id == inv.grn_id)
                                                   if inv.po_id or inv.grn_id else DispatchDoc.invoice_ref.is_not(None))):
        if dd.po_id and inv.po_id and dd.po_id != inv.po_id:
            continue
        if (dd.invoice_ref and same_ref(dd.invoice_ref, inv.invoice_no)) or (inv.grn_id and dd.grn_id == inv.grn_id) or (inv.ewaybill and dd.ewaybill == inv.ewaybill):
            disp_ids.append(dd.id)
    if disp_ids:
        conds.append(SourceDocument.dispatch_id.in_(disp_ids))
    docs = {d.id: d for d in db.scalars(q.where(or_(*conds)))}
    bundles = {d.bundle_id for d in docs.values() if d.bundle_id and d.invoice_id == inv.id}
    if bundles:
        for d in db.scalars(q.where(SourceDocument.bundle_id.in_(bundles))):
            if not d.invoice_id or d.invoice_id == inv.id:
                docs.setdefault(d.id, d)
    return [d for d in sorted(docs.values(), key=lambda d: d.id) if not d.invoice_id or d.invoice_id == inv.id]


def master_observations(db: Session, inv: SupplierInvoice) -> dict[str, list[dict]]:
    """Values the client's own records hold: the PO vendor's GSTIN from SAP or an import, and the SAP document once posted."""
    extra: dict[str, list[dict]] = {}
    po = db.get(PurchaseOrder, inv.po_id) if inv.po_id else None
    vendor = db.get(Party, po.vendor_id) if po and po.vendor_id else None
    if vendor and vendor.gstin and vendor.source in ('import', 'sap', 'manual'):
        extra['supplier_gstin'] = [{'docId': None, 'kind': 'master', 'doc': 'Vendor master', 'key': None, 'label': 'Supplier GSTIN', 'value': vendor.gstin,
                                    'norm': norm_code(vendor.gstin), 'confidence': 100, 'source': 'master'}]
    if inv.sap_doc_no:
        extra['sap_doc'] = [{'docId': None, 'kind': 'master', 'doc': 'SAP', 'key': None, 'label': 'SAP document no.', 'value': inv.sap_doc_no,
                             'norm': _ref_norm(inv.sap_doc_no), 'confidence': 100, 'source': 'master'}]
    return extra


def run_for_invoice(db: Session, inv: SupplierInvoice, tol: dict) -> tuple[list[SourceDocument], list[dict]]:
    docs = group_for_invoice(db, inv)
    findings = compare(docs, tol, master_observations(db, inv))
    apply(docs, findings)
    return docs, findings


def verdict(docs: list[SourceDocument], findings: list[dict], flags: list[dict] | None = None, verifications: list[dict] | None = None,
            gsp_configured: bool = False, pending: bool = False, include_discrepancies: bool = False) -> dict:
    """What stands between these documents and approval. clean = nothing a person must do; issues = the list; pending = still reading or verifying."""
    items: list[dict] = []
    by_id = {d.id: d for d in docs}
    for fl in flags or []:
        items.append({'tone': 'bad', 'title': fl['title'], 'detail': fl['detail'], 'blocks': True, 'action': {'kind': 'flag', 'key': fl['key'], 'exceptionId': fl.get('exceptionId')}})
    covered: set[tuple] = set()
    for fd in findings:
        if fd['severity'] == 'misread':
            for o in fd['observations']:
                if o.get('outlier') and o['source'] in ('printed', 'stamp') and o['docId'] in by_id:
                    covered.add((o['docId'], o.get('annotation'), o['key']))
                    action = {'kind': 'annotation', 'docId': str(o['docId']), 'index': o['annotation']} if o.get('annotation') is not None else {'kind': 'field', 'docId': str(o['docId']), 'key': o['key']}
                    items.append({'tone': 'warn', 'title': f'Check {o["label"]} on {o["doc"]}', 'detail': f'Reads {o["value"]}; ' + (f'{fd["shownBy"]} show {fd["consensus"]}' if fd.get('consensus') else fd['detail']),
                                  'blocks': True, 'action': action})
        elif fd['severity'] == 'discrepancy' and include_discrepancies:
            doc_id = fd.get('docId') or next((o['docId'] for o in fd['observations'] if o['docId']), None)
            items.append({'tone': 'bad', 'title': f'{fd["label"]} differs between documents' if fd['fact'] != 'pages_missing' else 'Pages missing', 'detail': fd['detail'], 'blocks': True,
                          'action': {'kind': 'field', 'docId': str(doc_id), 'key': None} if doc_id else None})
        elif fd['severity'] == 'warn':
            doc_id = fd.get('docId') or next((o['docId'] for o in fd['observations'] if o['docId']), None)
            items.append({'tone': 'warn', 'title': f'{fd["label"]} differs between documents' if fd['fact'] != 'pages_missing' else 'Pages missing', 'detail': fd['detail'], 'blocks': False,
                          'action': {'kind': 'field', 'docId': str(doc_id), 'key': None} if doc_id else None})
    for d in docs:
        if d.confirmed_by:
            continue
        low = [f for f in d.fields or [] if f['confidence'] < 90 and not f.get('confirmedBy') and (d.id, None, f['key']) not in covered]
        notes = [i for i, a in enumerate(d.annotations or []) if checkable(a) and a.get('confidence', 0) < 90 and not a.get('confirmedBy') and (d.id, i, None) not in covered
                 and not any((d.id, i, k) in covered for k in ('invoiceNo', 'poNo', 'grnNo', 'gateEntryNo', 'parkPostNo'))]
        if low or notes:
            n = len(low) + len(notes)
            first = {'kind': 'field', 'docId': str(d.id), 'key': low[0]['key']} if low else {'kind': 'annotation', 'docId': str(d.id), 'index': notes[0]}
            items.append({'tone': 'warn', 'title': f'Confirm {n} value{"s" if n > 1 else ""} on {doc_label(d)}',
                          'detail': ', '.join([f['label'] for f in low] + ['stamp' for _ in notes])[:300], 'blocks': True, 'action': first})
    for v in verifications or []:
        if v['status'] == 'pending':
            pending = True
        elif v['status'] in ('error', 'skipped'):
            items.append({'tone': 'warn', 'title': {'gstin': 'GSTIN status', 'einvoice_qr': 'E-invoice', 'ewb': 'E-way bill'}[v['kind']] + (' not verified' if v['status'] == 'skipped' else ' check failed to run'),
                          'detail': v.get('message') or '', 'blocks': v['status'] == 'error',
                          'action': {'kind': 'setup', 'to': f'/settings/clients/{docs[0].entity_id}'} if v['status'] == 'skipped' and 'client settings' in (v.get('message') or '') and docs
                          else {'kind': 'verify', 'verificationId': str(v['id'])}})
    if not gsp_configured:
        items.append({'tone': 'none', 'title': 'Not verified with GST systems', 'detail': 'Connect Vayana in Settings → Integrations to verify GSTINs, e-invoices and e-way bills.',
                      'blocks': False, 'action': {'kind': 'setup', 'to': '/settings/integrations'}})
    state = 'pending' if pending else ('issues' if any(i['blocks'] for i in items) else 'clean')
    return {'state': state, 'issues': sum(1 for i in items if i['blocks']), 'items': items}


def reading(docs: list[SourceDocument]) -> bool:
    """Any document still waiting to be read."""
    return any(d.kind == 'unknown' or (d.status_note or '').startswith('Queued') for d in docs)


def clean_findings(findings: list[dict]) -> list[dict]:
    """Findings as the web shows them: ids as strings."""
    out = []
    for fd in findings:
        out.append({**fd, 'docId': str(fd['docId']) if fd.get('docId') else None,
                    'observations': [{k: (str(v) if k == 'docId' and v is not None else v) for k, v in o.items() if k not in ('norm', 'paper', 'home')} for o in fd['observations']]})
    return out
