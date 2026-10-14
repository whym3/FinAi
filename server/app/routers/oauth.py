"""Mailbox connection: OAuth code flow with PKCE and an HMAC-signed state. Browser navigations, so the user comes as a query param."""
import base64
import hashlib
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, BackgroundTasks, Cookie, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from .. import crypto
from ..auth import ADMIN_ROLES, audit, load_session, require_entity, require_role
from ..config import settings
from ..db import SessionLocal
from ..mail import gmail, outlook
from ..mail.ingest import sync_mailbox
from ..models import Entity, Mailbox, User

router = APIRouter(prefix='/api/oauth', tags=['oauth'])
PROVIDERS = {'google': ('gmail', gmail), 'microsoft': ('outlook', outlook)}
COOKIE = 'pv_oauth'


def _configured(provider: str) -> bool:
    return bool(settings.google_client_id and settings.google_client_secret) if provider == 'google' else bool(settings.ms_client_id and settings.ms_client_secret)


def _safe_ret(ret: str) -> str:
    return ret if ret.startswith('/') and not ret.startswith('//') else '/settings'


def _back(ret: str, **params) -> RedirectResponse:
    sep = '&' if '?' in ret else '?'
    r = RedirectResponse(f'{_safe_ret(ret)}{sep}{urlencode(params)}', status_code=302)
    r.delete_cookie(COOKIE, path='/api/oauth')
    return r


def _redirect_uri(provider: str) -> str:
    return f'{settings.public_url}/api/oauth/{provider}/callback'


@router.get('/{provider}/start')
def start(provider: str, entity: str, request: Request, ret: str = '/settings', backfill: int = 7):
    if provider not in PROVIDERS:
        raise HTTPException(404)
    if not _configured(provider):
        return _back(ret, mailbox_error=f'{provider.title()} sign-in is not set up on the server yet (see server/README.md)')
    with SessionLocal() as db:
        loaded = load_session(request, db)
        if not loaded or not loaded[0].mfa_passed:
            return _back('/login', mailbox_error='Sign in first')
        u = loaded[1]
        require_role(u, entity, ADMIN_ROLES, 'connect mailboxes')
        require_entity(u, entity)
        if not db.get(Entity, entity):
            raise HTTPException(404, 'Client not found')
        user_id = u.id
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    state = crypto.sign({'e': entity, 'u': user_id, 'r': _safe_ret(ret), 'b': max(0, min(backfill, 90)), 'n': secrets.token_hex(8)})
    auth_url = PROVIDERS[provider][1].AUTH_URL + '?' + urlencode(PROVIDERS[provider][1].auth_params(_redirect_uri(provider), state, challenge))
    r = RedirectResponse(auth_url, status_code=302)
    r.set_cookie(COOKIE, verifier, max_age=600, httponly=True, samesite='lax', path='/api/oauth', secure=settings.public_url.startswith('https'))
    return r


def _first_sync(mailbox_id: int) -> None:
    with SessionLocal() as db:
        mb = db.get(Mailbox, mailbox_id)
        if mb:
            sync_mailbox(db, mb)


@router.get('/{provider}/callback')
def callback(provider: str, background: BackgroundTasks, state: str, code: str | None = None, error: str | None = None,
             error_description: str | None = None, pv_oauth: str | None = Cookie(None)):
    if provider not in PROVIDERS:
        raise HTTPException(404)
    try:
        st = crypto.unsign(state)
    except ValueError:
        raise HTTPException(400, 'Sign-in link is invalid or was tampered with')
    if error or not code:
        return _back(st['r'], mailbox_error=error_description or error or 'Sign-in was cancelled')
    if not pv_oauth:
        return _back(st['r'], mailbox_error='Sign-in took too long or cookies are blocked. Try again.')
    kind, mod = PROVIDERS[provider]
    try:
        tokens = mod.exchange(code, _redirect_uri(provider), pv_oauth)
        with httpx.Client(headers={'Authorization': f"Bearer {tokens['access_token']}"}, timeout=30) as c:
            address = gmail.profile(c)['emailAddress'] if kind == 'gmail' else (lambda m: m.get('mail') or m['userPrincipalName'])(outlook.me(c))
    except Exception as e:
        return _back(st['r'], mailbox_error=f'Could not finish sign-in: {e}'[:200])
    if not tokens.get('refresh_token'):
        return _back(st['r'], mailbox_error='The provider did not grant offline access. Remove the app from your account permissions and connect again.')
    with SessionLocal() as db:
        u = db.get(User, st['u'])
        if not u or u.status != 'active':
            return _back(st['r'], mailbox_error='Your account is no longer active')
        require_role(u, st['e'], ADMIN_ROLES, 'connect mailboxes')
        require_entity(u, st['e'])
        address = address.lower()
        mb = db.scalar(select(Mailbox).where(Mailbox.entity_id == st['e'], Mailbox.address == address))
        if not mb:
            mb = Mailbox(entity_id=st['e'], provider=kind, address=address, backfill_days=st['b'], sender_allow=[], sender_block=[])
            db.add(mb)
        elif mb.status == 'disconnected':
            mb.cursor = None  # start fresh, dedupe stops repeats
        mb.provider, mb.enc_refresh_token, mb.status, mb.last_error, mb.connected_by = kind, crypto.encrypt(tokens['refresh_token']), 'active', None, u.id
        db.flush()
        audit(db, u.id, st['e'], 'Connected mailbox', address, f'{kind} · backfill {mb.backfill_days} days')
        db.commit()
        background.add_task(_first_sync, mb.id)
    return _back(st['r'], mailbox='connected', address=address)
