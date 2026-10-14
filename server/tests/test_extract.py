from app.extract.schema import FIELDS, SCHEMA
from app.extract.validate import build_fields, build_lines


def raw(**vals):
    return {'doc_type': 'invoice', 'fields': {k: {'value': vals.get(k), 'confidence': 97} for k, *_ in FIELDS}, 'lines': []}


def test_schema_is_strict_compatible():
    # OpenAI strict mode: every object lists all its properties as required and forbids extras.
    def walk(s):
        if s.get('type') == 'object':
            assert s['additionalProperties'] is False and set(s['required']) == set(s['properties'])
            for p in s['properties'].values():
                walk(p)
        if s.get('type') == 'array':
            walk(s['items'])
    walk(SCHEMA)


def test_clean_invoice_keeps_confidence():
    f = {x['key']: x for x in build_fields(raw(gstin='27AAPFU0939F1ZV', billTo='27AAGCB7383J1Z4', taxable='89000.00', cgst='8010.00', sgst='8010.00', total='105020.00'))}
    assert f['total']['check']['tone'] == 'ok' and f['total']['confidence'] == 97 and f['gstin']['confidence'] == 97
    assert 'irn' not in f  # null values are dropped


def test_checks_lower_confidence():
    f = {x['key']: x for x in build_fields(raw(gstin='27AAPFU0939F1ZA', billTo='29AAGCB7383J1Z4', taxable='89000', cgst='8010', sgst='8010', total='110000'))}
    assert f['gstin']['confidence'] == 60 and f['gstin']['check']['tone'] == 'warn'  # bad check digit
    assert f['total']['confidence'] == 60  # arithmetic off
    assert f['cgst']['confidence'] == 60  # inter-state with CGST


def test_lines():
    out = build_lines({'lines': [{'description': 'Carton', 'hsn': '4819', 'qty': '1,000', 'unit': 'pc', 'rate': '87', 'amount': '87000.00', 'confidence': 88}]})
    assert out == [{'desc': 'Carton', 'hsn': '4819', 'qty': 1000.0, 'unit': 'pc', 'rate': 87.0, 'amount': 87000.0, 'confidence': 88}]
