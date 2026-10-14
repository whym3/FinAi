"""One JSON schema per document kind. Values are strings so the model never invents number formats; we parse them after.
Each header field is {value, confidence 0-100}. FIELD_META gives the web label and formatting for each key."""

KINDS = ['invoice', 'invoice_copy', 'credit_note', 'debit_note', 'delivery_challan', 'lorry_receipt', 'consignment_note', 'weighbridge', 'gate_entry',
         'eway_bill', 'purchase_order', 'goods_receipt', 'statement', 'quotation', 'other', 'not_finance']

_F = {'type': 'object', 'additionalProperties': False, 'required': ['value', 'confidence'],
      'properties': {'value': {'type': ['string', 'null']}, 'confidence': {'type': 'integer', 'description': '0-100: how sure you are the value is read correctly'}}}


def _obj(keys: list[str], extra: dict | None = None) -> dict:
    props = {k: _F for k in keys}
    if extra:
        props.update(extra)
    return {'type': 'object', 'additionalProperties': False, 'required': list(props), 'properties': props}


def _lines(cols: list[str]) -> dict:
    return {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': [*cols, 'confidence'],
                                        'properties': {**{c: {'type': ['string', 'null']} for c in cols}, 'confidence': {'type': 'integer'}}}}


# key -> (label, mono, num)
FIELD_META: dict[str, dict[str, tuple[str, bool, bool]]] = {
    'invoice': {
        'supplier': ('Supplier', False, False), 'gstin': ('Supplier GSTIN', True, False), 'supplierPan': ('Supplier PAN', True, False), 'billTo': ('Bill-to GSTIN', True, False),
        'billToName': ('Bill-to name', False, False), 'invoiceNo': ('Invoice no.', True, False), 'invoiceDate': ('Invoice date', False, False), 'irn': ('IRN', True, False),
        'ackNo': ('IRN ack. no.', True, False), 'pos': ('Place of supply', False, False), 'reverseCharge': ('Reverse charge', False, False), 'poRef': ('PO reference', True, False),
        'ewaybill': ('E-way bill', True, False), 'vehicle': ('Vehicle', True, False), 'transporter': ('Transporter', False, False), 'paymentTerms': ('Payment terms', False, False),
        'taxable': ('Taxable value', False, True), 'cgst': ('CGST', False, True), 'sgst': ('SGST', False, True), 'igst': ('IGST', False, True),
        'freight': ('Freight / P&F', False, True), 'otherCharges': ('Other charges', False, True), 'roundOff': ('Round-off', False, True), 'total': ('Invoice total', False, True),
        'bankAccount': ('Bank account', True, False), 'ifsc': ('IFSC', True, False),
    },
    'purchase_order': {
        'poNo': ('PO number', True, False), 'poDate': ('PO date', False, False), 'vendorCode': ('Vendor code', True, False), 'vendorName': ('Vendor', False, False),
        'vendorGstin': ('Vendor GSTIN', True, False), 'buyerName': ('Buyer', False, False), 'buyerGstin': ('Buyer GSTIN', True, False), 'plant': ('Plant / delivery', False, False),
        'paymentTerms': ('Payment terms', False, False), 'freightTerms': ('Freight terms', False, False), 'deliveryTerms': ('Delivery terms', False, False),
        'buyerContact': ('Buyer contact', False, False), 'taxable': ('Basic value', False, True), 'tax': ('Tax', False, True), 'total': ('Total value', False, True),
    },
    'goods_receipt': {
        'grnNo': ('GRN number', True, False), 'grnDate': ('GRN date', False, False), 'gateEntryNo': ('Gate entry no.', True, False), 'gateEntryDate': ('Gate entry date', False, False),
        'poNo': ('PO number', True, False), 'vendorCode': ('Vendor code', True, False), 'vendorName': ('Vendor', False, False), 'vendorGstin': ('Vendor GSTIN', True, False),
        'challanNo': ('Challan no.', True, False), 'challanDate': ('Challan date', False, False), 'invoiceNo': ('Invoice no.', True, False), 'invoiceDate': ('Invoice date', False, False),
        'lrNo': ('LR number', True, False), 'lrDate': ('LR date', False, False), 'transporter': ('Transporter', False, False), 'vehicle': ('Vehicle', True, False), 'ewaybill': ('E-way bill', True, False),
    },
    'lorry_receipt': {
        'lrNo': ('LR / GR number', True, False), 'lrDate': ('LR date', False, False), 'transporter': ('Transporter', False, False), 'transporterGstin': ('Transporter GSTIN', True, False),
        'udyam': ('Transporter Udyam', True, False), 'vehicle': ('Vehicle', True, False), 'consignor': ('Consignor', False, False), 'consignee': ('Consignee', False, False),
        'fromPlace': ('From', False, False), 'toPlace': ('To', False, False), 'packages': ('Packages', False, True), 'weightKg': ('Weight (kg)', False, True),
        'invoiceNo': ('Invoice no.', True, False), 'invoiceValue': ('Invoice value', False, True), 'ewaybill': ('E-way bill', True, False),
        'freightBasis': ('Freight', False, False), 'freightAmount': ('Freight amount', False, True),
    },
    'weighbridge': {
        'ticketNo': ('Ticket no.', True, False), 'date': ('Date', False, False), 'vehicle': ('Vehicle', True, False), 'supplier': ('Supplier', False, False),
        'transporter': ('Transporter', False, False), 'product': ('Product', False, False), 'grossKg': ('Gross (kg)', False, True), 'tareKg': ('Tare (kg)', False, True),
        'netKg': ('Net (kg)', False, True), 'inTime': ('In time', False, False), 'outTime': ('Out time', False, False), 'challanNo': ('Challan no.', True, False),
    },
    'gate_entry': {
        'number': ('Entry / bill no.', True, False), 'date': ('Date', False, False), 'vehicle': ('Vehicle', True, False), 'party': ('Party', False, False),
        'transporter': ('Transporter', False, False), 'description': ('Material', False, False), 'packages': ('Packages', False, True), 'weightKg': ('Net weight (kg)', False, True),
        'inTime': ('In time', False, False), 'outTime': ('Out time', False, False),
    },
    'generic': {'number': ('Document no.', True, False), 'date': ('Date', False, False), 'party': ('Party', False, False), 'counterparty': ('Counterparty', False, False),
                'amount': ('Amount', False, True), 'summary': ('Summary', False, False)},
}
FIELD_META['consignment_note'] = FIELD_META['gate_entry']
FIELD_META['delivery_challan'] = FIELD_META['invoice']
FIELD_META['credit_note'] = FIELD_META['invoice']
FIELD_META['debit_note'] = FIELD_META['invoice']
FIELD_META['invoice_copy'] = FIELD_META['invoice']
FIELD_META['eway_bill'] = FIELD_META['lorry_receipt']
for k in ('statement', 'quotation', 'other', 'not_finance'):
    FIELD_META[k] = FIELD_META['generic']

LINE_COLS = {
    'invoice': ['description', 'hsn', 'qty', 'unit', 'rate', 'amount', 'taxRate'],
    'purchase_order': ['item', 'materialCode', 'description', 'hsn', 'unit', 'qty', 'rate', 'taxRate', 'amount', 'deliveryDate'],
    'goods_receipt': ['poItem', 'materialCode', 'description', 'hsn', 'unit', 'receivedQty', 'acceptedQty', 'rejectedQty', 'batch', 'storageLoc'],
}


def schema_for(kind: str) -> dict:
    meta = FIELD_META.get(kind, FIELD_META['generic'])
    extra = {'lines': _lines(LINE_COLS[kind])} if kind in LINE_COLS else None
    return _obj(list(meta), extra)


CLASSIFY_SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['documents'],
    'properties': {'documents': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False, 'required': ['page_from', 'page_to', 'kind', 'number', 'date', 'party', 'confidence'],
        'properties': {'page_from': {'type': 'integer'}, 'page_to': {'type': 'integer'}, 'kind': {'type': 'string', 'enum': KINDS},
                       'number': {'type': ['string', 'null']}, 'date': {'type': ['string', 'null']}, 'party': {'type': ['string', 'null']}, 'confidence': {'type': 'integer'}}}}},
}

CLASSIFY_PROMPT = """You sort scanned paperwork received by the accounts-payable team of an Indian company.
The file may hold several documents one after another. Split it into documents with 1-based page ranges that cover every page exactly once.
Kinds: invoice (the original tax invoice), invoice_copy (a duplicate/transporter/triplicate copy of an invoice already in the file), credit_note, debit_note,
delivery_challan, lorry_receipt (transporter GR/LR/consignment receipt with GR number), consignment_note (a handwritten or simple consignor/consignee slip without a GR number),
weighbridge (weighbridge/weighment ticket with gross/tare/net), gate_entry (gate entry, unloading or material information sheet of the receiving plant),
eway_bill, purchase_order, goods_receipt (GRN / goods receipt note / MIGO printout), statement, quotation, other, not_finance.
number = the document's own number (invoice no., PO no., GRN no., GR no., ticket no.); date as printed; party = the issuing party's name."""

COMMON = """Copy values exactly as printed. Use null when a field is absent; never guess.
Dates as DD-MM-YYYY. Amounts and quantities as plain numbers with decimals and no commas or symbols (e.g. 72500.00, 1000.000).
Vehicle numbers without spaces (DL01LV1851). GSTINs are 15 characters. IRN is 64 hex characters.
confidence (0-100) is how sure you are the value is read correctly: lower it for blurry, handwritten, stamped-over, cut-off or ambiguous text.
Handwritten values must get confidence 70 or lower."""

PROMPTS = {
    'invoice': 'You read an Indian GST tax invoice (or credit/debit note or delivery challan) received from a supplier.\n'
               'gstin is the supplier\'s GSTIN, billTo is the buyer\'s. pos is place of supply as printed (state name or code). poRef is the buyer\'s PO number quoted on the invoice.\n'
               'paymentTerms as printed (e.g. "30 DAYS CREDIT"). freight is packing & forwarding / freight charged on the invoice (0.00 if a line shows zero). reverseCharge Y or N.\n'
               'lines: one entry per item line; taxRate is the GST % for that line.\n' + COMMON,
    'purchase_order': 'You read a purchase order issued by the buyer (an Indian company) to a vendor. vendorCode is the buyer\'s number for the vendor (e.g. 1003071).\n'
                      'paymentTerms, freightTerms (e.g. "FREIGHT EXTRA AS ACTUAL", "FOR destination") and deliveryTerms as printed. plant = the delivery plant/address name.\n'
                      'lines: item is the PO line number (10, 20…); materialCode the buyer\'s material code; deliveryDate the required delivery date.\n' + COMMON,
    'goods_receipt': 'You read a goods receipt note (GRN) printed by the receiving plant\'s ERP, often rotated. Read every reference number on it: GRN no., gate entry no. and date, '
                     'PO no., challan/invoice no. and dates, LR no. and date, transporter, vehicle, e-way bill. lines: receivedQty is the actual store receipt quantity, acceptedQty the accepted quantity.\n' + COMMON,
    'lorry_receipt': 'You read a transporter\'s lorry receipt / goods receipt (GR) / consignment note. lrNo is the GR/LR/CN number. freightBasis is "paid" or "to-pay" as marked. '
                     'packages and weightKg as printed. udyam is the transporter\'s Udyam registration number if printed.\n' + COMMON,
    'weighbridge': 'You read a weighbridge (weighment) ticket. Read ticket/transaction no., date, truck number, supplier, transporter, product, gross, tare and net weight in kg, in and out times.\n' + COMMON,
    'gate_entry': 'You read a gate entry, unloading or material information sheet, often handwritten. Read the entry or bill number, date, vehicle number, party (billing party), '
                  'transporter, material description, number of packages, net weight and in/out times. Handwritten values get low confidence.\n' + COMMON,
    'generic': 'You read a business document. Give its number, date, issuing party, counterparty, main amount and a one-line summary.\n' + COMMON,
}
PROMPTS['consignment_note'] = PROMPTS['gate_entry']
PROMPTS['invoice_copy'] = PROMPTS['credit_note'] = PROMPTS['debit_note'] = PROMPTS['delivery_challan'] = PROMPTS['invoice']
PROMPTS['eway_bill'] = PROMPTS['lorry_receipt']


def prompt_for(kind: str) -> str:
    return PROMPTS.get(kind, PROMPTS['generic'])
