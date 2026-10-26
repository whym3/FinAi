"""Checks against GST systems through Vayana's Enriched API Services (the GSP set in Settings -> Integrations):
GSTIN status from the taxpayer search, the IRP signature on the e-invoice QR we decoded, and the e-way bill against the invoice.
The buyer cannot look up a supplier's IRN (that needs the seller's consent), so the signed QR is what proves the e-invoice."""
import json
import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import crypto
from ..auth import audit
from ..extract.codes import einvoice_of
from ..extract.validate import GSTIN_RE, norm_code
from ..models import GspSetting, GstRegistration, Job, Party, SourceDocument, SupplierInvoice, Verification

log = logging.getLogger('pravah.verify')
AUTH_URL = {'sandbox': 'https://sandbox.services.vayananet.com/theodore/apis/v1', 'live': 'https://services.vayana.com/theodore/apis/v1'}
EAS_URL = {'sandbox': 'https://solo.enriched-api.vayana.com', 'live': 'https://live.enriched-api.vayana.com'}
GSTIN_SEARCH = '/basic/gstn/v3.0/commonapi/v0.3/search'
QR_VERIFY = '/enriched/einv/v1.0/invoices/verify-scanned-qrcode'
EWB_VERIFY = '/enriched/eway/v3.0/ew1/eway-bills/verify-ewb'
TASK_STATUS = '/enriched/tasks/v1.0/status/{}'
TASK_DOWNLOAD = '/enriched/tasks/v1.0/download/{}'
TOKEN_MINUTES = 360
GSTIN_CACHE = timedelta(hours=24)
POLL_SECONDS = 15
MAX_POLLS = 40
TIMEOUT = 30.0


class GspError(Exception):
    """Vayana could not be reached or failed on its side; the check can be tried again."""


def row(db: Session) -> GspSetting | None:
    return db.scalar(select(GspSetting).order_by(GspSetting.id).limit(1))


def configured(db: Session) -> bool:
    r = row(db)
    return bool(r and r.email and r.enc_password and r.org_id)


def _error(body: dict) -> tuple[str, list]:
    err = body.get('error') if isinstance(body, dict) else None
    if isinstance(err, list):
        err = err[0] if err else None
    if not isinstance(err, dict):
        return '', []
    args = err.get('args') or []
    if isinstance(args, dict):
        args = [f'{k}: {v}' for k, v in args.items()]
    return str(err.get('message') or ''), [str(a) for a in args]


def login(environment: str, email: str, password: str) -> dict:
    """Theodore login: {token, expiry (datetime), orgs: [{id, name}]}. Raises GspError when Vayana is unreachable, ValueError when refused."""
    try:
        r = httpx.post(AUTH_URL[environment] + '/authtokens', json={'handle': email, 'password': password, 'handleType': 'email', 'tokenDurationInMins': TOKEN_MINUTES},
                       timeout=TIMEOUT)
    except httpx.HTTPError as e:
        raise GspError(f'Could not reach Vayana: {type(e).__name__}') from e
    if r.status_code >= 500:
        raise GspError(f'Vayana login failed with HTTP {r.status_code}')
    try:
        body = r.json()
    except ValueError as e:
        raise GspError(f'Vayana login returned HTTP {r.status_code} without JSON') from e
    data = body.get('data') if isinstance(body, dict) else None
    if r.status_code != 200 or not isinstance(data, dict) or not data.get('token'):
        message, _ = _error(body)
        raise ValueError(message or f'Login refused (HTTP {r.status_code})')
    exp = data.get('expiry')
    if isinstance(exp, (int, float)):
        expiry = datetime.fromtimestamp(exp / 1000 if exp > 1e12 else exp, UTC)
    else:
        expiry = datetime.now(UTC) + timedelta(minutes=TOKEN_MINUTES)
    orgs = [{'id': str(o['organisation']['id']), 'name': o['organisation'].get('name') or ''} for o in data.get('associatedOrgs') or []
            if isinstance(o, dict) and isinstance(o.get('organisation'), dict) and o['organisation'].get('id')]
    return {'token': data['token'], 'expiry': expiry, 'orgs': orgs}


class Client:
    def __init__(self, db: Session, setting: GspSetting):
        self.db, self.s = db, setting
        self.base = EAS_URL.get(setting.environment, EAS_URL['sandbox'])

    def _token(self, fresh: bool = False) -> str:
        s = self.s
        if not fresh and s.enc_token and s.token_expiry and s.token_expiry > datetime.now(UTC) + timedelta(minutes=2):
            return crypto.decrypt(s.enc_token)
        try:
            got = login(s.environment, s.email, crypto.decrypt(s.enc_password or ''))
        except ValueError as e:
            raise GspError(f'Vayana refused the saved login: {e}') from e
        s.enc_token, s.token_expiry = crypto.encrypt(got['token']), got['expiry']
        self.db.flush()
        return got['token']

    def call(self, method: str, path: str, body: dict | None = None, params: dict | None = None, headers: dict | None = None) -> tuple[int, dict]:
        """(HTTP status, JSON body). Logs in again once when the token is refused; raises GspError for network and server failures."""
        for attempt in (0, 1):
            h = {'accept': 'application/json', 'Content-Type': 'application/json', 'X-FLYNN-N-ORG-ID': self.s.org_id,
                 'X-FLYNN-N-USER-TOKEN': self._token(fresh=attempt == 1), **(headers or {})}
            try:
                r = httpx.request(method, self.base + path, json=body, params=params, headers=h, timeout=TIMEOUT)
            except httpx.HTTPError as e:
                raise GspError(f'Could not reach Vayana: {type(e).__name__}') from e
            try:
                data = r.json()
            except ValueError:
                data = {}
            message, _ = _error(data)
            if attempt == 0 and (r.status_code == 401 or 'token' in message.lower()):
                continue
            if r.status_code >= 500 and r.status_code != 502:
                raise GspError(f'Vayana returned HTTP {r.status_code}' + (f': {message}' if message else ''))
            return r.status_code, data if isinstance(data, dict) else {}
        raise GspError('Vayana refused the token twice')


def _row(db: Session, inv: SupplierInvoice, kind: str, ref: str) -> Verification:
    v = Verification(entity_id=inv.entity_id, invoice_id=inv.id, kind=kind, ref=ref[:80], status='pending', detail={}, polls=0)
    db.add(v)
    return v


def _done(v: Verification, status: str, message: str, detail: dict | None = None) -> None:
    v.status, v.message, v.checked_at = status, message, datetime.now(UTC)
    if detail is not None:
        v.detail = {**(v.detail or {}), **detail}


def _latest(db: Session, inv: SupplierInvoice, kind: str, ref: str) -> Verification | None:
    return db.scalar(select(Verification).where(Verification.invoice_id == inv.id, Verification.kind == kind, Verification.ref == ref).order_by(Verification.id.desc()).limit(1))


def _gstins(db: Session, inv: SupplierInvoice) -> list[str]:
    from .crosscheck import group_for_invoice
    out = [inv.supplier_gstin] if inv.supplier_gstin else []
    for d in group_for_invoice(db, inv):
        if d.kind == 'lorry_receipt':
            g = norm_code(next((f['value'] for f in d.fields or [] if f['key'] == 'transporterGstin'), None))
            if g and GSTIN_RE.match(g) and g not in out:
                out.append(g)
    return out


def check_gstin(db: Session, client: Client, inv: SupplierInvoice, gstin: str) -> Verification:
    since = datetime.now(UTC) - GSTIN_CACHE
    cached = db.scalar(select(Verification).where(Verification.entity_id == inv.entity_id, Verification.kind == 'gstin', Verification.ref == gstin,
                                                  Verification.status == 'ok', Verification.checked_at >= since).order_by(Verification.id.desc()).limit(1))
    v = _row(db, inv, 'gstin', gstin)
    if cached:
        _done(v, 'ok', cached.message or '', dict(cached.detail or {}))
        v.checked_at = cached.checked_at
        return v
    try:
        code, body = client.call('GET', GSTIN_SEARCH, params={'gstin': gstin, 'action': 'TP'})
    except GspError as e:
        _done(v, 'error', str(e))
        return v
    data = body.get('data')
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            data = None
    message, _ = _error(body)
    if code == 200 and isinstance(data, dict) and data.get('sts'):
        detail = {k: data.get(k) for k in ('lgnm', 'tradeNam', 'sts', 'cxdt', 'rgdt', 'dty')}
        _done(v, 'ok', f'{data.get("lgnm") or gstin}: {data["sts"]}', detail)
        for p in db.scalars(select(Party).where(Party.entity_id == inv.entity_id, Party.gstin == gstin)):
            p.gstin_status = str(data['sts'])[:12]
    elif code == 404:
        _done(v, 'mismatch', 'GSTIN not found on the GST portal', {'sts': 'Not found'})
    elif code == 502:
        _done(v, 'error', 'GST portal did not answer; verify again later' + (f' ({message})' if message else ''))
    else:
        _done(v, 'failed', message or f'Taxpayer search failed (HTTP {code})')
    return v


def check_einvoice(db: Session, client: Client, inv: SupplierInvoice) -> Verification | None:
    doc = db.get(SourceDocument, inv.source_doc_id) if inv.source_doc_id else None
    qr = einvoice_of(doc.codes if doc else None)
    if not qr:
        if not inv.irn:
            return None
        v = _row(db, inv, 'einvoice_qr', inv.irn)
        _done(v, 'skipped', 'QR code not readable on the scan; the IRN cannot be verified without it')
        return v
    facts, signed = qr
    payload = {'signedQRCode': signed}
    if inv.supplier_gstin:
        payload['sellerGstin'] = inv.supplier_gstin
    if inv.bill_to_gstin:
        payload['buyerGstin'] = inv.bill_to_gstin
    if inv.invoice_no:
        payload['docNo'] = inv.invoice_no
    if inv.date:
        payload['docDt'] = inv.date.strftime('%d/%m/%Y')
    if inv.total:
        payload['totInvVal'] = float(inv.total)
    ref = (facts.get('Irn') or inv.irn or '')[:80]
    prev = _latest(db, inv, 'einvoice_qr', ref)
    if prev and prev.status in ('ok', 'mismatch', 'failed') and (prev.detail or {}).get('input') == {k: v for k, v in payload.items() if k != 'signedQRCode'}:
        return prev
    v = _row(db, inv, 'einvoice_qr', ref)
    v.detail = {'input': {k: val for k, val in payload.items() if k != 'signedQRCode'}}
    try:
        code, body = client.call('POST', QR_VERIFY, {'payload': payload, 'meta': {'tolerance': 1, 'isToleranceInPercentage': False}})
    except GspError as e:
        _done(v, 'error', str(e))
        return v
    message, args = _error(body)
    if code == 200 and str(body.get('status')) == '1':
        _done(v, 'ok', 'Signed by the IRP; matches the invoice', {'einvoice': body.get('data') if isinstance(body.get('data'), dict) else {}})
    elif message == 'err-signed-qrcode-verification-failed':
        _done(v, 'failed', 'The QR signature does not verify: it was not issued by an IRP or was altered')
    elif message == 'err-signed-qr-code-validation-failed':
        _done(v, 'mismatch', 'Differs from the signed e-invoice: ' + ', '.join(a.removeprefix('invalid ') for a in args), {'args': args})
    else:
        _done(v, 'error', message or f'E-invoice check failed (HTTP {code})')
    return v


def check_ewb(db: Session, client: Client, inv: SupplierInvoice) -> Verification | None:
    ewb = ''.join(ch for ch in (inv.ewaybill or '') if ch.isdigit())
    if not ewb:
        return None
    payload = {'ewbNumber': ewb}
    if inv.invoice_no:
        payload['docNo'] = inv.invoice_no
    if inv.date:
        payload['docDate'] = inv.date.strftime('%d/%m/%Y')
    if inv.supplier_gstin:
        payload['fromGstin'] = inv.supplier_gstin
    if inv.bill_to_gstin:
        payload['toGstin'] = inv.bill_to_gstin
    if inv.total:
        payload['totInvValue'] = float(inv.total)
    prev = _latest(db, inv, 'ewb', ewb)
    if prev and prev.status in ('ok', 'mismatch', 'failed', 'pending') and (prev.detail or {}).get('input') == payload:
        return prev
    v = _row(db, inv, 'ewb', ewb)
    v.detail = {'input': payload}
    reg = db.scalar(select(GstRegistration).where(GstRegistration.entity_id == inv.entity_id, GstRegistration.gstin == (inv.bill_to_gstin or '')))
    if not reg:
        _done(v, 'skipped', f'Bill-to GSTIN {inv.bill_to_gstin or "(none)"} is not a registration of this client')
        return v
    if not (reg.ewb_username and reg.enc_ewb_password):
        _done(v, 'skipped', f'Add the e-way bill API user for GSTIN {reg.gstin} in client settings')
        return v
    headers = {'X-FLYNN-N-EWB-GSP-CODE': 'vay', 'X-FLYNN-N-EWB-GSTIN': reg.gstin, 'X-FLYNN-N-EWB-USERNAME': reg.ewb_username,
               'X-FLYNN-N-EWB-PWD': crypto.decrypt(reg.enc_ewb_password)}
    try:
        code, body = client.call('POST', EWB_VERIFY, {'payload': [payload], 'meta': {'json': 'N', 'pdf': 'N', 'tolerance': 1, 'isToleranceInPercentage': False}}, headers=headers)
    except GspError as e:
        _done(v, 'error', str(e))
        return v
    data = body.get('data') if isinstance(body.get('data'), dict) else {}
    task = data.get('task-id') or data.get('taskId')
    if code == 200 and str(body.get('status')) == '1' and task:
        v.task_id = str(task)[:80]
        db.flush()
        db.add(Job(kind='verify_poll', payload={'verification_id': v.id}, run_after=datetime.now(UTC) + timedelta(seconds=POLL_SECONDS)))
        return v
    message, args = _error(body)
    _done(v, 'failed' if message else 'error', ' '.join([message or f'E-way bill check failed (HTTP {code})', *args]))
    return v


def run_for_invoice(db: Session, invoice_id: int) -> None:
    """Every check for one invoice, then the match again so results become flags and the verdict."""
    from .match import run_match
    inv = db.get(SupplierInvoice, invoice_id)
    s = row(db)
    if not inv or not configured(db):
        return
    client = Client(db, s)
    done = []
    for g in _gstins(db, inv):
        done.append(check_gstin(db, client, inv, g))
    for v in (check_einvoice(db, client, inv), check_ewb(db, client, inv)):
        if v:
            done.append(v)
    db.flush()
    summary = ', '.join(f'{v.kind} {v.ref}: {v.status}' for v in done) or 'nothing to verify'
    audit(db, None, inv.entity_id, 'Verified with GST systems', inv.invoice_no, summary[:1000])
    if inv.status == 'needs-decision':
        run_match(db, inv)


def poll(db: Session, verification_id: int) -> None:
    """Follow an e-way bill check that Vayana runs as a task."""
    from .match import run_match
    v = db.get(Verification, verification_id)
    if not v or v.status != 'pending' or not v.task_id:
        return
    s = row(db)
    if not configured(db):
        _done(v, 'error', 'GST verification was disconnected before the e-way bill check finished')
        return
    client = Client(db, s)
    v.polls += 1
    try:
        code, body = client.call('GET', TASK_STATUS.format(v.task_id))
        data = body.get('data') if isinstance(body.get('data'), dict) else {}
        state = str(data.get('status') or (data.get('task') or {}).get('status') or '').lower()
        if code == 200 and state == 'completed':
            code, body = client.call('GET', TASK_DOWNLOAD.format(v.task_id))
            items = body.get('data') if isinstance(body.get('data'), list) else []
            item = next((i for i in items if isinstance(i, dict) and str(((i.get('additionalInfo') or {}).get('key') or {}).get('ewb-number')) == v.ref), None) \
                or next((i for i in items if isinstance(i, dict)), None)
            if item and str(item.get('status')) == '1':
                _done(v, 'ok', 'E-way bill found on the portal and matches the invoice')
            elif item:
                message, args = _error(item)
                if message == 'err-ewb-verification-failed':
                    _done(v, 'mismatch', 'Differs from the e-way bill: ' + ', '.join(a.removeprefix('invalid ') for a in args), {'args': args})
                else:
                    _done(v, 'failed', ' '.join([message or 'E-way bill not verified', *args]))
            else:
                message, _ = _error(body)
                _done(v, 'error', message or f'E-way bill result could not be downloaded (HTTP {code})')
        elif code in (400, 404):
            message, _ = _error(body)
            _done(v, 'error', message or f'E-way bill task not found (HTTP {code})')
        elif v.polls >= MAX_POLLS:
            _done(v, 'error', 'E-way bill check timed out; verify again')
        else:
            db.add(Job(kind='verify_poll', payload={'verification_id': v.id}, run_after=datetime.now(UTC) + timedelta(seconds=POLL_SECONDS)))
            return
    except GspError as e:
        if v.polls >= MAX_POLLS:
            _done(v, 'error', str(e))
        else:
            db.add(Job(kind='verify_poll', payload={'verification_id': v.id}, run_after=datetime.now(UTC) + timedelta(seconds=POLL_SECONDS)))
            return
    inv = db.get(SupplierInvoice, v.invoice_id) if v.invoice_id else None
    if inv and inv.status == 'needs-decision':
        run_match(db, inv)


def queue(db: Session, inv: SupplierInvoice) -> bool:
    """Queue the checks for an invoice unless GSP is not set up or a run is already waiting."""
    if not configured(db):
        return False
    waiting = db.scalar(select(Job.id).where(Job.kind == 'verify', Job.done_at.is_(None), Job.payload['invoice_id'].as_integer() == inv.id))
    if not waiting:
        db.add(Job(kind='verify', payload={'invoice_id': inv.id}))
    return True
