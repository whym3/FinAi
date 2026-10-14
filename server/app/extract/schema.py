"""One output schema for every provider. Values are strings so the model never invents number formats; we parse them after."""

DOC_TYPES = ['invoice', 'credit_note', 'debit_note', 'delivery_challan', 'lorry_receipt', 'statement', 'quotation', 'purchase_order', 'not_finance']

# (key, label, mono, num): keys and labels match the web Intake review panel.
FIELDS = [
    ('supplier', 'Supplier', False, False),
    ('gstin', 'Supplier GSTIN', True, False),
    ('billTo', 'Bill-to GSTIN', True, False),
    ('invoiceNo', 'Invoice no.', True, False),
    ('invoiceDate', 'Invoice date', False, False),
    ('irn', 'IRN', True, False),
    ('pos', 'Place of supply', False, False),
    ('poRef', 'PO reference', True, False),
    ('taxable', 'Taxable value', False, True),
    ('cgst', 'CGST', False, True),
    ('sgst', 'SGST', False, True),
    ('igst', 'IGST', False, True),
    ('total', 'Invoice total', False, True),
    ('bankAccount', 'Bank account', True, False),
    ('ifsc', 'IFSC', True, False),
]

_FIELD = {'type': 'object', 'additionalProperties': False, 'required': ['value', 'confidence'],
          'properties': {'value': {'type': ['string', 'null']}, 'confidence': {'type': 'integer', 'description': '0-100: how sure you are the value is read correctly'}}}
_LINE_PROPS = ['description', 'hsn', 'qty', 'unit', 'rate', 'amount']

SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['doc_type', 'fields', 'lines'],
    'properties': {
        'doc_type': {'type': 'string', 'enum': DOC_TYPES},
        'fields': {'type': 'object', 'additionalProperties': False, 'required': [k for k, *_ in FIELDS], 'properties': {k: _FIELD for k, *_ in FIELDS}},
        'lines': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': [*_LINE_PROPS, 'confidence'],
            'properties': {**{p: {'type': ['string', 'null']} for p in _LINE_PROPS}, 'confidence': {'type': 'integer'}}}},
    },
}

PROMPT = """You read documents received by the accounts-payable team of an Indian company and return their data as JSON.
- doc_type: what the document is. Use not_finance for anything that is not a supplier commercial document.
- fields: copy values exactly as printed. Use null when a field is absent. Never guess.
  Dates as DD-MM-YYYY. Amounts as plain numbers with two decimals, no commas, no currency symbol (e.g. 89000.00).
  gstin is the supplier's GSTIN, billTo is the buyer's. pos is the place of supply as printed (state name or code).
  irn is the 64-character e-invoice reference number if printed.
- lines: one entry per item line, amounts as plain numbers.
- confidence (0-100) is how sure you are that you read that value correctly: lower it for blurry, handwritten, cut-off or ambiguous text."""
