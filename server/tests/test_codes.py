"""The e-invoice QR is found on the page, parsed, and compared with what the model read."""
import base64
import io
import json

import segno
from PIL import Image

from app.extract.codes import decode, einvoice_of, parse_einvoice
from app.extract.validate import LOW, apply_qr, build_fields

IRN = '8d64fa741acb8b7521cb78c5466c15bbfee5493a4e0db77a82a6f0a04ec2ebfd'
FACTS = {'SellerGstin': '07ACXPJ3115G1ZJ', 'BuyerGstin': '09AAACA1199D1ZW', 'DocNo': 'API/3166', 'DocTyp': 'INV', 'DocDt': '01/09/2026',
         'TotInvVal': 85550, 'ItemCnt': 1, 'MainHsnCode': '40091200', 'Irn': IRN, 'IrnDt': '2026-09-01 18:49:00'}


def b64(obj) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')


def signed_qr(facts=FACTS) -> str:
    return f'{b64({"alg": "RS256", "typ": "JWT"})}.{b64({"data": json.dumps(facts), "iss": "NIC"})}.c2lnbmF0dXJl'


def qr_pdf(text: str, turn: int = 0) -> bytes:
    buf = io.BytesIO()
    segno.make(text, error='m').save(buf, kind='png', scale=4, border=4)
    qr = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    page = Image.new('RGB', (qr.width * 2, qr.height * 2), 'white')
    page.paste(qr, (qr.width // 2, qr.height // 2))
    if turn:
        page = page.rotate(turn, expand=True)
    out = io.BytesIO()
    page.save(out, format='PDF', resolution=150)
    return out.getvalue()


def test_parse_einvoice():
    facts = parse_einvoice(signed_qr())
    assert facts['Irn'] == IRN and facts['DocNo'] == 'API/3166' and facts['TotInvVal'] == '85550'
    assert parse_einvoice('https://www.google.com/maps/place/Apollo') is None
    assert parse_einvoice('a.b.c') is None
    assert parse_einvoice(f'{b64({"alg": "x"})}.{b64({"data": "{}"})}.sig') is None


def test_decode_finds_the_qr_on_an_upright_and_a_turned_page():
    found = decode(qr_pdf(signed_qr()), 'application/pdf', 1, [0])
    assert len(found) == 1 and found[0]['page'] == 1 and found[0]['einvoice']['Irn'] == IRN
    turned = decode(qr_pdf(signed_qr(), turn=90), 'application/pdf', 1, [90])
    assert turned and turned[0]['einvoice']['DocNo'] == 'API/3166'
    other = decode(qr_pdf('https://example.com/plant'), 'application/pdf', 1, [0])
    assert other[0]['einvoice'] is None and einvoice_of(other) is None
    assert decode(b'<x/>', 'application/xml', 1, [0]) == []


def test_apply_qr_marks_matches_misreads_and_fills_gaps():
    read = build_fields('invoice', {'invoiceNo': {'value': 'API/3166', 'confidence': 90}, 'irn': {'value': IRN[:12] + IRN[13:], 'confidence': 95},
                                    'total': {'value': '85550.00', 'confidence': 92}, 'invoiceDate': {'value': '01-09-2026', 'confidence': 95}})
    lines = [{'desc': 'SS braided', 'hsn': '40091200', 'qty': 1000, 'rate': 72.5, 'amount': 72500, 'confidence': 94, 'read': 94}]
    out = {f['key']: f for f in apply_qr('invoice', read, lines, [{'page': 1, 'text': signed_qr(), 'einvoice': parse_einvoice(signed_qr())}])}
    assert out['invoiceNo']['check']['tone'] == 'ok' and out['invoiceNo']['confidence'] == 99
    assert out['irn']['check'] == {'tone': 'bad', 'label': f'QR code says {IRN}'} and out['irn']['qr'] == IRN and out['irn']['confidence'] == LOW
    assert out['gstin']['value'] == '07ACXPJ3115G1ZJ' and out['gstin']['check']['label'] == 'Read from the e-invoice QR code'
    assert 'check' not in lines[0]
    assert apply_qr('goods_receipt', [], [], [{'einvoice': FACTS}]) == []
