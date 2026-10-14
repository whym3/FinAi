"""DB rows → the JSON shapes in web/src/lib/types.ts."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session as DbSession

from .models import (CustomerInvoice, Entity, ExceptionItem, Firm, GoodsReceipt, Import, Mailbox, Notification, Party, PurchaseOrder, SapConnection,
                     SourceDocument, SupplierInvoice, User)

IST = timezone(timedelta(hours=5, minutes=30))
DOC_KIND_LABEL = {
    'invoice': 'Tax invoice', 'invoice_copy': 'Invoice (duplicate copy)', 'credit_note': 'Credit note', 'debit_note': 'Debit note', 'delivery_challan': 'Delivery challan',
    'lorry_receipt': 'Lorry receipt', 'consignment_note': 'Consignment note', 'weighbridge': 'Weighbridge ticket', 'gate_entry': 'Gate entry / unloading sheet',
    'eway_bill': 'E-way bill', 'purchase_order': 'Purchase order', 'goods_receipt': 'Goods receipt note', 'statement': 'Statement', 'quotation': 'Quotation',
    'bundle': 'Document bundle', 'not_finance': 'Not finance', 'unknown': 'Unknown', 'other': 'Other',
}


def f(v) -> float:
    return float(v) if isinstance(v, Decimal) else (v if v is not None else 0.0)


def ist(d: datetime | None) -> str | None:
    return d.astimezone(IST).strftime('%Y-%m-%dT%H:%M') if d else None


def iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    return ''.join(p[0] for p in parts[:2]).upper() or name[:2].upper()


_COLORS = ['a1', 'a2', 'a3', 'a4', 'a5']


def user_out(u: User, full: bool = False) -> dict:
    role = u.entities[0].role if u.entities else ('partner' if u.is_admin else 'ap')
    d = {'id': str(u.id), 'initials': initials(u.name), 'name': u.name, 'title': u.title or role.title(), 'role': role, 'color': _COLORS[u.id % 5],
         'email': u.email, 'isAdmin': u.is_admin, 'status': u.status, 'mfaEnabled': u.mfa_enabled,
         'assignments': [{'entityId': ue.entity_id, 'role': ue.role, 'approvalLimit': f(ue.approval_limit)} for ue in u.entities]}
    if full:
        d['lastLoginAt'] = ist(u.last_login_at)
    return d


def me_out(db: DbSession, u: User) -> dict:
    from .auth import approval_limit, firm_wide, role_on, visible_entities
    firm = db.get(Firm, u.firm_id)
    ents = visible_entities(db, u)
    return {'user': user_out(u), 'firm': {'id': firm.id, 'name': firm.name, 'short': firm.short_name, 'frn': firm.frn, 'entityIds': [e.id for e in ents]},
            'firmWide': firm_wide(u), 'entities': [entity_out(e) for e in ents],
            'access': {e.id: {'role': role_on(u, e.id), 'approvalLimit': approval_limit(u, e.id)} for e in ents}}


def mailbox_out(m: Mailbox, documents: int = 0) -> dict:
    return {'id': m.id, 'entityId': m.entity_id, 'provider': m.provider, 'address': m.address, 'status': m.status, 'lastSyncAt': ist(m.last_sync_at),
            'lastError': m.last_error, 'backfillDays': m.backfill_days, 'senderAllow': m.sender_allow or [], 'senderBlock': m.sender_block or [],
            'connectedBy': str(m.connected_by) if m.connected_by else None, 'documents': documents}


def entity_out(e: Entity) -> dict:
    live = [m for m in e.mailboxes if m.status != 'disconnected']
    return {
        'id': e.id, 'name': e.legal_name, 'shortName': e.short_name, 'city': e.city, 'pan': e.pan, 'tan': e.tan, 'cin': e.cin,
        'gstins': [{'gstin': g.gstin, 'code': g.state_code, 'state': g.state, 'placeOfBusiness': g.place_of_business,
                    'filingFrequency': g.filing_frequency, 'einvoiceApplicable': g.einvoice_applicable} for g in e.gstins],
        'sapCompanyCode': e.sap_company_code, 'risk': 'Low', 'riskScore': 0, 'intakeEmail': live[0].address if live else '', 'whatsapp': e.whatsapp,
        'status': e.status, 'fyStartMonth': e.fy_start_month, 'einvoiceBand': e.einvoice_band, 'msmeStatus': e.msme_status,
        'createdAt': ist(e.created_at), 'mailboxes': [mailbox_out(m) for m in live], 'plants': [{'code': p.code, 'name': p.name} for p in e.plants],
    }


def doc_out(d: SourceDocument, parts: list[SourceDocument] | None = None) -> dict:
    fl = {x['key']: x for x in d.fields or []}
    total = fl['total']['value'] if 'total' in fl else None
    try:
        amount = float(str(total).replace(',', '')) if total not in (None, '') else None
    except ValueError:
        amount = None
    return {
        'id': str(d.id), 'entityId': d.entity_id, 'channel': d.channel, 'receivedAt': ist(d.received_at), 'from': d.sender or (f'user {d.uploaded_by}' if d.uploaded_by else ''),
        'type': DOC_KIND_LABEL.get(d.kind, d.kind) if d.kind != 'unknown' else ('Reading…' if d.status == 'new' and not d.fields else 'Document'),
        'kind': d.kind, 'vendorName': fl['supplier']['value'] if 'supplier' in fl else (d.data.get('party') or '—'),
        'docNo': fl['invoiceNo']['value'] if 'invoiceNo' in fl else (d.data.get('number') or d.filename), 'amount': amount,
        'confidence': min((x['confidence'] for x in d.fields), default=None) if d.fields else None,
        'status': d.status, 'statusNote': d.status_note, 'duplicateOf': str(d.duplicate_of) if d.duplicate_of else None,
        'pages': d.pages, 'pageFrom': d.page_from, 'pageTo': d.page_to, 'sizeKb': max(1, round(d.size / 1024)), 'fields': d.fields or [], 'lines': d.lines or [],
        'confirmedBy': str(d.confirmed_by) if d.confirmed_by else None, 'fileUrl': f'/api/files/{d.id}', 'mime': d.mime, 'filename': d.filename, 'subject': d.subject,
        'bundleId': str(d.bundle_id) if d.bundle_id else None, 'poId': str(d.po_id) if d.po_id else None, 'grnId': str(d.grn_id) if d.grn_id else None,
        'invoiceId': str(d.invoice_id) if d.invoice_id else None, 'linkedPoId': str(d.po_id) if d.po_id else None,
        'parts': [doc_out(p) for p in parts] if parts else [],
    }


def party_vendor_out(p: Party, agg: dict | None = None) -> dict:
    agg = agg or {}
    tone, label = ('bad', f'Overdue {agg["overdueDays"]} days') if agg.get('overdue') else ('warn', 'MSME limit soon') if agg.get('msmeSoon') else ('ok', 'On schedule')
    return {'id': str(p.id), 'code': p.code, 'entityId': p.entity_id, 'name': p.name, 'shortName': p.name, 'gstin': p.gstin or '', 'pan': p.pan or (p.gstin[2:12] if p.gstin else ''),
            'gstinStatus': p.gstin_status if p.gstin_status in ('Active', 'Cancelled', 'Suspended') else 'Active', 'msme': p.msme_class, 'udyam': p.udyam,
            'tags': p.tags or [], 'bank': p.bank or {'bank': '', 'ifsc': '', 'account': '', 'nameAtBank': ''}, 'email': p.email or '', 'phone': p.phone or '',
            'paymentTermsDays': p.payment_terms_days, 'tdsSection': p.tds_section, 'filing': {'onTime': 0, 'of': 0},
            'outstanding': agg.get('outstanding', 0), 'overdue': agg.get('overdue', 0), 'nextDue': agg.get('nextDue'), 'status': {'tone': tone, 'label': label},
            'ytdPurchases': agg.get('ytd', 0), 'blocked': p.blocked, 'source': p.source, 'city': p.city, 'state': p.state}


def party_customer_out(p: Party, agg: dict | None = None) -> dict:
    agg = agg or {}
    return {'id': str(p.id), 'code': p.code, 'entityId': p.entity_id, 'name': p.name, 'outstanding': agg.get('outstanding', 0), 'overdue': agg.get('overdue', 0),
            'daysOverdue': agg.get('daysOverdue', 0), 'followUp': agg.get('followUp') or {'tone': 'none', 'label': 'No contact yet'}, 'gstin': p.gstin or '',
            'creditDays': p.credit_days, 'contact': p.email or '', 'city': p.city, 'state': p.state, 'invoices': agg.get('invoices', 0)}


def ar_out(ci: CustomerInvoice, customer_name: str, today: date) -> dict:
    open_amt = f(ci.total) - f(ci.received)
    if ci.doc_type == 'credit_memo':
        st = {'tone': 'none', 'label': 'Credit memo'}
    elif open_amt <= 0:
        st = {'tone': 'ok', 'label': 'Received'}
    elif ci.due_date and ci.due_date < today:
        st = {'tone': 'bad', 'label': f'Overdue {(today - ci.due_date).days} days'}
    else:
        st = {'tone': 'warn', 'label': 'Due ' + ci.due_date.strftime('%d-%m-%Y')} if ci.due_date else {'tone': 'none', 'label': 'No due date'}
    if ci.follow_up:
        st = ci.follow_up
    return {'id': str(ci.id), 'entityId': ci.entity_id, 'customerId': str(ci.customer_id) if ci.customer_id else '', 'customer': customer_name, 'invoiceNo': ci.invoice_no,
            'gstInvoiceNo': ci.gst_invoice_no, 'date': iso(ci.date), 'due': iso(ci.due_date), 'amount': f(ci.total), 'taxable': f(ci.taxable), 'tax': f(ci.tax),
            'received': f(ci.received), 'status': st, 'lastAction': (ci.follow_up or {}).get('last'), 'docType': ci.doc_type, 'state': ci.state, 'profitCenter': ci.profit_center,
            'recon': ci.recon_account, 'lines': len(ci.lines)}


def notification_out(n: Notification, user_id: int) -> dict:
    return {'id': str(n.id), 'entityId': n.entity_id, 'at': ist(n.at), 'title': n.title, 'body': n.body, 'route': n.route, 'tone': n.tone, 'read': user_id in (n.read_by or [])}


def import_out(i: Import) -> dict:
    return {'id': i.id, 'entityId': i.entity_id, 'kind': i.kind, 'filename': i.filename, 'size': i.size, 'sheet': i.sheet, 'sheets': i.sheets, 'headers': i.headers,
            'preview': i.preview, 'mapping': i.mapping, 'periodFrom': iso(i.period_from), 'periodTo': iso(i.period_to), 'status': i.status,
            'rowsTotal': i.rows_total, 'rowsDone': i.rows_done, 'rowsCreated': i.rows_created, 'rowsUpdated': i.rows_updated, 'rowsSkipped': i.rows_skipped,
            'errors': i.errors or [], 'summary': i.summary or {}, 'createdBy': str(i.created_by) if i.created_by else None, 'createdAt': ist(i.created_at), 'finishedAt': ist(i.finished_at)}


def sap_out(c: SapConnection) -> dict:
    return {'id': c.id, 'entityId': c.entity_id, 'edition': c.edition, 'host': c.host, 'client': c.client, 'companyCode': c.company_code, 'plantMapping': c.plant_mapping or {},
            'username': c.username, 'passwordSet': bool(c.enc_password), 'objects': c.objects or [], 'scheduleMinutes': c.schedule_minutes, 'status': c.status,
            'lastTestAt': ist(c.last_test_at), 'lastTestResult': c.last_test_result, 'lastSyncAt': ist(c.last_sync_at), 'lastError': c.last_error}


def grn_out(g: GoodsReceipt) -> dict:
    return {'id': str(g.id), 'grnNo': g.grn_no, 'date': iso(g.date), 'poRef': g.po_ref, 'gateEntryNo': g.gate_entry_no, 'gateEntryDate': iso(g.gate_entry_date),
            'invoiceRef': g.invoice_ref, 'lrNo': g.lr_no, 'transporter': g.transporter, 'vehicle': g.vehicle, 'ewaybill': g.ewaybill,
            'lines': [{'poItem': l.po_item, 'material': l.material_code, 'description': l.description, 'hsn': l.hsn, 'uom': l.uom, 'received': f(l.received_qty), 'accepted': f(l.accepted_qty), 'rejected': f(l.rejected_qty)} for l in g.lines]}


def invoice_out(inv: SupplierInvoice, vendor: Party | None = None) -> dict:
    m = inv.match or {}
    return {
        'id': str(inv.id), 'entityId': inv.entity_id, 'vendorId': str(inv.vendor_id) if inv.vendor_id else '', 'vendorName': vendor.name if vendor else inv.vendor_name,
        'invoiceNo': inv.invoice_no, 'date': iso(inv.date), 'receivedAt': ist(inv.received_at), 'channel': inv.channel,
        'taxable': f(inv.taxable), 'cgst': f(inv.cgst), 'sgst': f(inv.sgst), 'igst': f(inv.igst), 'freight': f(inv.freight), 'total': f(inv.total),
        'poId': str(inv.po_id) if inv.po_id else None, 'poRef': inv.po_ref, 'grnId': str(inv.grn_id) if inv.grn_id else None, 'intakeId': str(inv.source_doc_id) if inv.source_doc_id else None,
        'status': inv.status, 'flags': m.get('flags', []), 'heads': m.get('heads', []), 'rows': m.get('rows', []), 'dnLines': inv.dn_lines or [],
        'tds': m.get('tds') or {'nature': 'Not computed', 'section': '—', 'legacy': '', 'threshold': '', 'crossed': '', 'rate': '', 'base': 0, 'amount': 0, 'note': 'TDS rules not configured'},
        'itc': m.get('itc') or {'status': {'tone': 'none', 'label': 'GST portal not connected'}, 'onInvoice': f(inv.cgst) + f(inv.sgst) + f(inv.igst), 'afterDn': 0, 'ims': '—', 'imsNote': 'Connect a GSP to see IMS status', 'expected': '', 'pay180': '', 's164': '', 'filing': ''},
        'msme': m.get('msme'), 'draft': inv.draft, 'decision': inv.decision, 'docTitle': f'Tax invoice {inv.invoice_no}',
        'irn': inv.irn, 'ewaybill': inv.ewaybill, 'vehicle': inv.vehicle, 'placeOfSupply': inv.place_of_supply, 'supplierGstin': inv.supplier_gstin, 'billToGstin': inv.bill_to_gstin,
        'paymentTermsDays': inv.payment_terms_days, 'sapDocNo': inv.sap_doc_no,
        'lines': [{'line': l.line_no, 'description': l.description, 'hsn': l.hsn, 'qty': f(l.qty), 'uom': l.uom, 'rate': f(l.rate), 'taxable': f(l.taxable), 'taxRate': f(l.tax_rate)} for l in inv.lines],
    }


def exception_out(x: ExceptionItem) -> dict:
    return {'id': f'EX-{x.id}', 'nid': x.id, 'entityId': x.entity_id, 'type': x.type, 'title': x.title, 'docRef': x.doc_ref, 'docRoute': x.doc_route,
            'ownerId': str(x.owner_id) if x.owner_id else '', 'status': x.status, 'statusNote': x.status_note, 'priority': x.priority, 'due': iso(x.due),
            'createdAt': ist(x.created_at), 'amount': f(x.amount), 'snoozedUntil': iso(x.snoozed_until), 'resolvedAt': ist(x.resolved_at), 'resolution': x.resolution,
            'blocks': x.blocks, 'evidence': x.evidence, 'evidenceNote': x.evidence_note, 'sources': x.sources or [], 'checklist': x.checklist,
            'comments': [{'id': str(c.id), 'byId': str(c.user_id), 'at': ist(c.at), 'text': c.text} for c in x.comments], 'history': x.history or [],
            'invoiceId': str(x.invoice_id) if x.invoice_id else None, 'poId': str(x.po_id) if x.po_id else None}


def po_list_out(po: PurchaseOrder, vendor: Party | None, stages: list[dict], agg: dict) -> dict:
    return {'id': str(po.id), 'poNo': po.po_no, 'entityId': po.entity_id, 'vendorId': str(po.vendor_id) if po.vendor_id else '', 'vendorName': vendor.name if vendor else po.vendor_name,
            'value': f(po.total), 'taxable': f(po.taxable), 'buyerId': '', 'buyer': po.buyer or '', 'plant': po.plant or '', 'docType': po.doc_type, 'releaseState': po.release_state,
            'createdOn': iso(po.date), 'stages': stages, 'lines': agg['lines'], 'invoicedTaxable': agg['invoicedTaxable'], 'docs': agg['docs'],
            'negotiation': po.negotiation, 'sap': agg['sap'], 'msme': agg.get('msme'), 'invoiceId': agg.get('invoiceId'), 'elapsedDays': agg['elapsedDays'],
            'health': agg['health'], 'openQty': agg['openQty'], 'openValue': agg['openValue'], 'source': po.source, 'paymentTermsDays': po.payment_terms_days, 'freightTerms': po.freight_terms}
