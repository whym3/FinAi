"""Verification through Vayana, with its APIs mocked: GSTIN status, the signed e-invoice QR, and the e-way bill task."""
import base64
import json
import time
from datetime import UTC, datetime

import httpx
import respx

from app import crypto
from app.domain import verify
from app.domain.link import apply
from app.domain.match import run_match
from app.extract.codes import parse_einvoice
from app.extract.validate import build_fields
from app.models import ExceptionItem, GspSetting, GstRegistration, Job, Party, SourceDocument, SupplierInvoice, User, Verification

AUTH = verify.AUTH_URL['sandbox']
EAS = verify.EAS_URL['sandbox']
IRN = '8d64fa741acb8b7521cb78c5466c15bbfee5493a4e0db77a82a6f0a04ec2ebfd'


def b64(obj) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')


SIGNED = f'{b64({"alg": "RS256"})}.{b64({"data": json.dumps({"SellerGstin": "07ACXPJ3115G1ZJ", "BuyerGstin": "09AAACA1199D1ZW", "DocNo": "API/3166", "DocDt": "01/09/2026", "TotInvVal": 85550, "Irn": IRN})})}.c2ln'


def configure(db, e, ewb_user=True):
    db.add(GspSetting(provider='vayana', environment='sandbox', email='ops@mehtarao.in', enc_password=crypto.encrypt('vayana-pass'), org_id='org-1'))
    if ewb_user:
        reg = db.query(GstRegistration).filter_by(gstin='09AAACA1199D1ZW').one()
        reg.ewb_username, reg.enc_ewb_password = 'apollo_api', crypto.encrypt('ewb-pass')
    db.flush()


def invoice(db, e, qr=True, invoice_no='API/3166', sha='inv'):
    d = SourceDocument(entity_id=e.id, channel='Upload', received_at=datetime.now(UTC), filename='inv.pdf', mime='application/pdf', size=1, sha256=sha, storage_path='/x',
                       kind='invoice', status='review', pages=1, codes=[{'page': 1, 'text': SIGNED, 'einvoice': parse_einvoice(SIGNED)}] if qr else [])
    d.fields = build_fields('invoice', {k: {'value': v, 'confidence': 95} for k, v in dict(
        supplier='AKSHAY PLASTIC INDUSTRIES', gstin='07ACXPJ3115G1ZJ', billTo='09AAACA1199D1ZW', invoiceNo=invoice_no, invoiceDate='01-09-2026', irn=IRN,
        ewaybill='791666006375', taxable='72500.00', igst='13050.00', total='85550.00').items()})
    db.add(d)
    db.flush()
    apply(db, d)
    return db.query(SupplierInvoice).filter_by(invoice_no=invoice_no).one()


def login_route():
    return respx.post(f'{AUTH}/authtokens').mock(return_value=httpx.Response(200, json={'data': {
        'token': 'tok-1', 'expiry': int(time.time()) + 3600, 'associatedOrgs': [{'organisation': {'id': 'org-1', 'name': 'Mehta & Rao'}}]}}))


def gstin_route(sts='Active'):
    return respx.get(f'{EAS}{verify.GSTIN_SEARCH}').mock(return_value=httpx.Response(200, json={'status': '1', 'data': {
        'gstin': '07ACXPJ3115G1ZJ', 'lgnm': 'AKSHAY PLASTIC INDUSTRIES', 'sts': sts, 'cxdt': '01/10/2026' if sts != 'Active' else None, 'rgdt': '01/07/2017', 'dty': 'Regular'}}))


def test_nothing_queued_without_gsp(db, firm):
    f, e, admin = firm
    inv = invoice(db, e)
    assert verify.queue(db, inv) is False and db.query(Job).filter_by(kind='verify').count() == 0
    run_match(db, inv)
    assert any(i['title'] == 'Not verified with GST systems' for i in inv.match['verdict']['items'])


@respx.mock
def test_full_verification_run(db, firm):
    f, e, admin = firm
    configure(db, e)
    inv = invoice(db, e)
    login = login_route()
    gstin_route('Cancelled')
    respx.post(f'{EAS}{verify.QR_VERIFY}').mock(return_value=httpx.Response(400, json={'status': '0', 'data': None, 'error': {
        'type': 'ClientRequest', 'message': 'err-signed-qr-code-validation-failed', 'args': ['invalid totInvVal']}}))
    ewb = respx.post(f'{EAS}{verify.EWB_VERIFY}').mock(return_value=httpx.Response(200, json={'status': '1', 'data': {'task-id': 'T1'}}))
    status = respx.get(f'{EAS}{verify.TASK_STATUS.format("T1")}').mock(side_effect=[
        httpx.Response(200, json={'status': '1', 'data': {'id': 'T1', 'status': 'in-progress'}}),
        httpx.Response(200, json={'status': '1', 'data': {'id': 'T1', 'status': 'completed'}})])
    respx.get(f'{EAS}{verify.TASK_DOWNLOAD.format("T1")}').mock(return_value=httpx.Response(200, json={'status': '1', 'data': [
        {'status': '1', 'data': {'details': {}}, 'additionalInfo': {'key': {'ewb-number': '791666006375'}}}]}))

    assert verify.queue(db, inv) and verify.queue(db, inv)
    assert db.query(Job).filter_by(kind='verify').count() == 1
    verify.run_for_invoice(db, inv.id)
    rows = {v.kind: v for v in db.query(Verification).filter_by(invoice_id=inv.id)}
    assert rows['gstin'].status == 'ok' and rows['gstin'].detail['sts'] == 'Cancelled'
    assert db.query(Party).filter_by(gstin='07ACXPJ3115G1ZJ').one().gstin_status == 'Cancelled'
    assert rows['einvoice_qr'].status == 'mismatch' and 'totInvVal' in rows['einvoice_qr'].message
    assert rows['ewb'].status == 'pending' and rows['ewb'].task_id == 'T1'
    sent = json.loads(ewb.calls[0].request.content)
    assert sent['payload'][0] == {'ewbNumber': '791666006375', 'docNo': 'API/3166', 'docDate': '01/09/2026', 'fromGstin': '07ACXPJ3115G1ZJ', 'toGstin': '09AAACA1199D1ZW', 'totInvValue': 85550.0}
    assert ewb.calls[0].request.headers['X-FLYNN-N-EWB-GSTIN'] == '09AAACA1199D1ZW' and ewb.calls[0].request.headers['X-FLYNN-N-ORG-ID'] == 'org-1'
    keys = {fl['key'] for fl in inv.match['flags']}
    assert {'gstin-status', 'einv'} <= keys and inv.match['verdict']['state'] == 'pending'
    assert db.query(ExceptionItem).filter_by(invoice_id=inv.id, flag_key='gstin-status').one().type == 'gstin'
    assert db.query(ExceptionItem).filter_by(invoice_id=inv.id, flag_key='einv').one().type == 'einv'

    verify.poll(db, rows['ewb'].id)
    assert rows['ewb'].status == 'pending' and rows['ewb'].polls == 1 and db.query(Job).filter_by(kind='verify_poll').count() == 2
    verify.poll(db, rows['ewb'].id)
    assert rows['ewb'].status == 'ok' and status.call_count == 2
    assert login.call_count == 1  # the token is reused
    assert {v['kind']: v['status'] for v in inv.match['verifications']}['ewb'] == 'ok'
    assert inv.match['verdict']['state'] == 'issues'
    secrets = json.dumps(inv.match)
    assert 'vayana-pass' not in secrets and 'ewb-pass' not in secrets


@respx.mock
def test_login_again_when_the_token_is_refused_and_gstin_cache(db, firm):
    f, e, admin = firm
    configure(db, e, ewb_user=False)
    db.query(GspSetting).one().enc_token, db.query(GspSetting).one().token_expiry = crypto.encrypt('stale'), datetime.fromtimestamp(time.time() + 3600, UTC)
    inv = invoice(db, e, qr=False)
    login = login_route()
    search = respx.get(f'{EAS}{verify.GSTIN_SEARCH}').mock(side_effect=[
        httpx.Response(401, json={'status': '0', 'error': {'message': 'err-invalid-token'}}),
        httpx.Response(200, json={'status': '1', 'data': {'gstin': '07ACXPJ3115G1ZJ', 'lgnm': 'AKSHAY', 'sts': 'Active'}})])
    verify.run_for_invoice(db, inv.id)
    rows = {v.kind: v for v in db.query(Verification).filter_by(invoice_id=inv.id)}
    assert login.call_count == 1 and search.call_count == 2 and rows['gstin'].status == 'ok'
    assert rows['einvoice_qr'].status == 'skipped' and 'QR code not readable' in rows['einvoice_qr'].message
    assert rows['ewb'].status == 'skipped' and 'client settings' in rows['ewb'].message
    items = inv.match['verdict']['items']
    assert any(i['action'] == {'kind': 'setup', 'to': f'/settings/clients/{e.id}'} for i in items)
    other = invoice(db, e, qr=False, invoice_no='API/3170', sha='inv2')
    verify.run_for_invoice(db, other.id)
    assert search.call_count == 2  # GSTIN status reused within a day
    assert db.query(Verification).filter_by(invoice_id=other.id, kind='gstin').one().status == 'ok'


@respx.mock
def test_poll_gives_up_and_unreachable_vayana_is_an_error(db, firm):
    f, e, admin = firm
    configure(db, e)
    inv = invoice(db, e, qr=False)
    v = Verification(entity_id=e.id, invoice_id=inv.id, kind='ewb', ref='791666006375', status='pending', task_id='T9', detail={}, polls=verify.MAX_POLLS - 1)
    db.add(v)
    db.flush()
    login_route()
    respx.get(f'{EAS}{verify.TASK_STATUS.format("T9")}').mock(return_value=httpx.Response(200, json={'status': '1', 'data': {'status': 'in-progress'}}))
    verify.poll(db, v.id)
    assert v.status == 'error' and 'timed out' in v.message
    respx.get(f'{EAS}{verify.GSTIN_SEARCH}').mock(side_effect=httpx.ConnectError('down'))
    respx.post(f'{EAS}{verify.EWB_VERIFY}').mock(side_effect=httpx.ConnectError('down'))
    verify.run_for_invoice(db, inv.id)
    rows = {r.kind: r for r in db.query(Verification).filter_by(invoice_id=inv.id).order_by(Verification.id)}
    assert rows['gstin'].status == 'error' and 'Could not reach Vayana' in rows['gstin'].message
    assert rows['ewb'].status == 'error'


@respx.mock
def test_settings_endpoints(client, db, firm, sign_in):
    f, e, admin = firm
    ap = db.query(User).filter_by(email='ap@apollo.in').one()
    sign_in(ap)
    assert client.get('/api/gsp').status_code == 403
    sign_in(admin)
    r = client.put('/api/gsp', json={'environment': 'sandbox', 'email': 'ops@mehtarao.in', 'password': 'vayana-pass', 'org_id': ''})
    assert r.status_code == 200 and r.json()['passwordSet'] and not r.json()['configured'] and 'vayana-pass' not in r.text
    login_route()
    gstin_route()
    r = client.post('/api/gsp/test', json={'environment': 'sandbox', 'email': 'ops@mehtarao.in', 'org_id': 'org-1'})
    assert r.json()['ok'] and r.json()['orgs'] == [{'id': 'org-1', 'name': 'Mehta & Rao'}] and 'taxpayer search works' in r.json()['message']
    r = client.put('/api/gsp', json={'environment': 'sandbox', 'email': 'ops@mehtarao.in', 'org_id': 'org-1'})
    assert r.json()['configured'] and verify.configured(db)
    assert client.get('/api/integrations').json()['gsp']['configured']
    inv = invoice(db, e, qr=False)
    sign_in(ap)
    assert client.post(f'/api/invoices/{inv.id}/verify').status_code == 200 and db.query(Job).filter_by(kind='verify').count() == 1
    sign_in(admin)
    assert client.delete('/api/gsp/credentials').json()['passwordSet'] is False
    assert client.delete('/api/gsp/credentials').status_code == 404
    sign_in(ap)
    assert client.post(f'/api/invoices/{inv.id}/verify').status_code == 409


def test_ewb_user_endpoints(client, db, firm, sign_in):
    f, e, admin = firm
    sign_in(admin)
    r = client.put(f'/api/entities/{e.id}/gstins/09AAACA1199D1ZW/ewb-user', json={'username': 'apollo_api', 'password': 'ewb-pass'})
    assert r.status_code == 200 and 'ewb-pass' not in r.text
    g = r.json()['gstins'][0]
    assert g['ewbUserSet'] and g['ewbUsername'] == 'apollo_api'
    assert crypto.decrypt(db.query(GstRegistration).filter_by(gstin='09AAACA1199D1ZW').one().enc_ewb_password) == 'ewb-pass'
    assert client.put(f'/api/entities/{e.id}/gstins/27AAACA1199D1ZX/ewb-user', json={'username': 'x', 'password': 'y'}).status_code == 404
    assert client.delete(f'/api/entities/{e.id}/gstins/09AAACA1199D1ZW/ewb-user').json()['gstins'][0]['ewbUserSet'] is False
    sign_in(db.query(User).filter_by(email='ap@apollo.in').one())
    assert client.put(f'/api/entities/{e.id}/gstins/09AAACA1199D1ZW/ewb-user', json={'username': 'x', 'password': 'y'}).status_code == 403
