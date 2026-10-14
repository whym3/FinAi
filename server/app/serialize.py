"""DB rows → the JSON shapes in web/src/lib/types.ts, so existing screens render server data unchanged."""
from datetime import datetime, timedelta, timezone

from .extract.validate import to_num
from .models import Entity, Mailbox, SourceDocument

IST = timezone(timedelta(hours=5, minutes=30))  # India has no DST
DOC_TYPE_LABEL = {'invoice': 'Tax invoice', 'credit_note': 'Credit note', 'debit_note': 'Debit note', 'delivery_challan': 'Delivery challan',
                  'lorry_receipt': 'Lorry receipt', 'statement': 'Statement', 'quotation': 'Quotation', 'purchase_order': 'Purchase order', 'not_finance': 'Not finance'}


def ist(d: datetime | None) -> str | None:
    return d.astimezone(IST).strftime('%Y-%m-%dT%H:%M') if d else None


def mailbox_out(m: Mailbox, documents: int = 0) -> dict:
    return {'id': m.id, 'entityId': m.entity_id, 'provider': m.provider, 'address': m.address, 'status': m.status, 'lastSyncAt': ist(m.last_sync_at),
            'lastError': m.last_error, 'backfillDays': m.backfill_days, 'senderAllow': m.sender_allow or [], 'senderBlock': m.sender_block or [],
            'connectedBy': m.connected_by, 'documents': documents}


def entity_out(e: Entity) -> dict:
    live = [m for m in e.mailboxes if m.status != 'disconnected']
    return {
        'id': e.id, 'name': e.legal_name, 'shortName': e.short_name, 'city': e.city, 'pan': e.pan, 'tan': e.tan, 'cin': e.cin,
        'gstins': [{'gstin': g.gstin, 'code': g.state_code, 'state': g.state, 'placeOfBusiness': g.place_of_business,
                    'filingFrequency': g.filing_frequency, 'einvoiceApplicable': g.einvoice_applicable} for g in e.gstins],
        'sapCompanyCode': e.sap_company_code, 'risk': 'Low', 'riskScore': 0, 'intakeEmail': live[0].address if live else '', 'whatsapp': e.whatsapp,
        'status': e.status, 'fyStartMonth': e.fy_start_month, 'einvoiceBand': e.einvoice_band, 'msmeStatus': e.msme_status,
        'createdAt': ist(e.created_at), 'mailboxes': [mailbox_out(m) for m in live],
    }


def doc_out(d: SourceDocument) -> dict:
    f = {x['key']: x for x in d.fields or []}
    total = to_num(f['total']['value']) if 'total' in f else None
    return {
        'id': f'em-{d.id}', 'entityId': d.entity_id, 'channel': d.channel, 'receivedAt': ist(d.received_at), 'from': d.sender,
        'type': DOC_TYPE_LABEL.get(d.doc_type or '', 'Extracting…' if d.status == 'new' and not d.fields else 'Attachment'),
        'vendorName': f['supplier']['value'] if 'supplier' in f else '—', 'docNo': f['invoiceNo']['value'] if 'invoiceNo' in f else d.filename,
        'amount': total, 'confidence': min((x['confidence'] for x in d.fields), default=None) if d.fields else None,
        'status': d.status, 'statusNote': d.status_note, 'duplicateOf': f'em-{d.duplicate_of}' if d.duplicate_of else None,
        'pages': 1, 'sizeKb': max(1, round(d.size / 1024)), 'fields': d.fields or [], 'lines': d.lines or [], 'confirmedBy': d.confirmed_by,
        'server': True, 'fileUrl': f'/api/files/{d.id}', 'mime': d.mime, 'filename': d.filename, 'subject': d.subject,
    }
