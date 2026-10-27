"""Which GSP verifies e-invoices, e-way bills and GSTINs: Vayana's Enriched API Services, set by a firm admin."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import crypto
from ..auth import audit, current_user, require_admin
from ..db import get_db
from ..domain import verify
from ..models import GspSetting, GstRegistration, User
from ..serialize import gsp_out

router = APIRouter(prefix='/api', tags=['gsp'])


class GspIn(BaseModel):
    environment: Literal['sandbox', 'live'] = 'sandbox'
    email: str = Field('', max_length=320)
    password: str | None = None  # None keeps the stored one; '' clears it
    org_id: str = Field('', max_length=80)


def _get(db: Session) -> GspSetting:
    return verify.row(db) or GspSetting(provider='vayana', environment='sandbox', email='', org_id='')


@router.get('/gsp')
def read(u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_admin(u, 'see the GST verification settings')
    return gsp_out(_get(db))


@router.put('/gsp')
def save(body: GspIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_admin(u, 'change the GST verification settings')
    r = _get(db)
    if not r.id:
        db.add(r)
    changed_login = r.environment != body.environment or r.email != body.email.strip()
    r.provider, r.environment, r.email, r.org_id = 'vayana', body.environment, body.email.strip(), body.org_id.strip()
    if body.password is not None:
        r.enc_password = crypto.encrypt(body.password) if body.password else None
        changed_login = True
    if changed_login:
        r.enc_token, r.token_expiry, r.last_test_at, r.last_test_result = None, None, None, None
    r.updated_at = datetime.now(UTC)
    db.flush()
    audit(db, u.id, None, 'Saved GST verification settings', f'Vayana · {r.environment}', 'credentials set' if r.enc_password else 'no credentials', request=request)
    db.commit()
    return gsp_out(r)


@router.post('/gsp/test')
def test(body: GspIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Log in with the typed password, or the saved one when the field is left empty; lists the organisations the login can use.
    With an organisation saved, also runs one taxpayer search to prove the account is set up for billing."""
    require_admin(u, 'test the GST verification settings')
    r = _get(db)
    password = body.password or (crypto.decrypt(r.enc_password) if r.enc_password else '')
    if not body.email.strip() or not password:
        raise HTTPException(422, 'Enter the Vayana login email and password first')
    orgs: list[dict] = []
    try:
        got = verify.login(body.environment, body.email.strip(), password)
        orgs = got['orgs']
        ok, message = True, f'Logged in · {len(orgs)} organisation(s)'
        org = body.org_id.strip() or (r.org_id if r.id else '')
        gstin = db.scalar(select(GstRegistration.gstin).order_by(GstRegistration.id).limit(1))
        if org and gstin:
            probe = GspSetting(provider='vayana', environment=body.environment, email=body.email.strip(), enc_password=crypto.encrypt(password), org_id=org,
                               enc_token=crypto.encrypt(got['token']), token_expiry=got['expiry'])
            code, resp = verify.Client(db, probe).call('GET', verify.GSTIN_SEARCH, params={'gstin': gstin, 'action': 'TP'})
            if code == 200 and str(resp.get('status')) == '1':
                message += f' · taxpayer search works ({gstin})'
            else:
                ok = False
                err, _ = verify._error(resp)
                message += f' · taxpayer search failed: {err or f"HTTP {code}"}'
    except verify.GspError as e:
        ok, message = False, str(e)
    except ValueError as e:
        ok, message = False, f'Login refused: {e}'
    if r.id:
        r.last_test_at, r.last_test_result = datetime.now(UTC), ('OK: ' if ok else 'Failed: ') + message
        audit(db, u.id, None, 'Tested GST verification', f'Vayana · {body.environment}', r.last_test_result, request=request)
        db.commit()
    return {'ok': ok, 'message': message, 'orgs': orgs}


@router.delete('/gsp/credentials')
def revoke(request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Forget the stored password and token. Verification stops until a new one is saved."""
    require_admin(u, 'change the GST verification settings')
    r = _get(db)
    if not r.id or not r.enc_password:
        raise HTTPException(404, 'No credentials are stored')
    r.enc_password, r.enc_token, r.token_expiry, r.last_test_at, r.last_test_result = None, None, None, None, None
    r.updated_at = datetime.now(UTC)
    db.flush()
    audit(db, u.id, None, 'Revoked GST verification credentials', f'Vayana · {r.environment}', 'credentials removed', request=request)
    db.commit()
    return gsp_out(r)
