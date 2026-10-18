import hashlib
import secrets
from datetime import timedelta

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .. import crypto
from ..auth import (audit, check_password_strength, csrf_guard, current_user, end_session, hash_password, load_session, now, pre_mfa_user,
                    revoke_all, start_session, verify_password)
from ..config import settings
from ..db import get_db
from ..extract import ai
from ..mailer import send
from ..models import Firm, Token, User
from ..serialize import me_out

router = APIRouter(prefix='/api/auth', tags=['auth'])
LOCK_AFTER, LOCK_MINUTES = 5, 15


def _initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    return ''.join(p[0] for p in parts[:2]).upper() or name[:2].upper()


@router.get('/status')
def status(db: DbSession = Depends(get_db)):
    """What the login screen needs before anyone is signed in."""
    return {'needsSetup': db.scalar(select(func.count(User.id))) == 0, 'smtp': bool(settings.smtp_host), 'ai': ai.configured(db)}


class SetupIn(BaseModel):
    firm_name: str = Field(min_length=2, max_length=200)
    firm_short: str = Field(min_length=2, max_length=80)
    frn: str | None = None
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str


@router.post('/setup')
def setup(body: SetupIn, request: Request, response: Response, db: DbSession = Depends(get_db)):
    """First run only: creates the firm and its first admin, then signs them in (MFA enrolment follows)."""
    csrf_guard(request)
    if db.scalar(select(func.count(User.id))):
        raise HTTPException(409, 'Pravah is already set up. Sign in instead.')
    check_password_strength(body.password)
    firm = Firm(name=body.firm_name.strip(), short_name=body.firm_short.strip(), frn=(body.frn or '').strip() or None)
    db.add(firm)
    db.flush()
    u = User(firm_id=firm.id, email=body.email.lower(), name=body.name.strip(), title='Firm admin', password_hash=hash_password(body.password), is_admin=True, status='active')
    db.add(u)
    db.flush()
    audit(db, u.id, None, 'Set up Pravah', firm.name, f'First admin {u.email}', request=request)
    return _signed_in(db, u, request, response)


def _signed_in(db: DbSession, u: User, request: Request, response: Response) -> dict:
    """Password accepted: start the session. With REQUIRE_MFA off it is complete; otherwise the authenticator step follows."""
    if not settings.require_mfa:
        start_session(db, u, request, response, mfa_passed=True)
        u.last_login_at = now()
        audit(db, u.id, None, 'Signed in', u.email, request=request)
        db.commit()
        return {'next': 'done'}
    start_session(db, u, request, response, mfa_passed=False)
    db.commit()
    return {'next': 'mfa_verify' if u.mfa_enabled else 'mfa_enrol'}


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post('/login')
def login(body: LoginIn, request: Request, response: Response, db: DbSession = Depends(get_db)):
    csrf_guard(request)
    u = db.scalar(select(User).where(User.email == body.email.lower()))
    generic = HTTPException(401, 'Email or password is incorrect')
    if not u or u.status == 'invited':
        raise generic
    if u.status == 'disabled':
        raise HTTPException(403, 'This account is disabled. Ask your firm admin.')
    if u.locked_until and u.locked_until > now():
        raise HTTPException(429, f'Too many attempts. Try again in {int((u.locked_until - now()).total_seconds() // 60) + 1} min.')
    if not verify_password(u.password_hash, body.password):
        u.failed_logins += 1
        if u.failed_logins >= LOCK_AFTER:
            u.locked_until, u.failed_logins = now() + timedelta(minutes=LOCK_MINUTES), 0
            audit(db, u.id, None, 'Account locked after failed logins', u.email, request=request)
        db.commit()
        raise generic
    u.failed_logins, u.locked_until = 0, None
    return _signed_in(db, u, request, response)


@router.post('/logout')
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)):
    csrf_guard(request)
    end_session(db, request, response)
    db.commit()
    return {'ok': True}


@router.get('/me')
def me(request: Request, db: DbSession = Depends(get_db)):
    loaded = load_session(request, db)
    if not loaded:
        raise HTTPException(401, 'unauthenticated')
    s, u = loaded
    if not s.mfa_passed:
        raise HTTPException(401, 'mfa_enrol' if not u.mfa_enabled else 'mfa_required')
    return me_out(db, u)


# ---------- MFA ----------

@router.post('/mfa/enrol')
def mfa_enrol(request: Request, db: DbSession = Depends(get_db)):
    s, u = pre_mfa_user(request, db)
    if u.mfa_enabled:
        raise HTTPException(409, 'MFA is already set up')
    # Reuse a pending (unconfirmed) secret so a reload or a repeated call shows the same QR code.
    secret = crypto.decrypt(u.totp_secret_enc) if u.totp_secret_enc else pyotp.random_base32()
    if not u.totp_secret_enc:
        u.totp_secret_enc = crypto.encrypt(secret)
        db.commit()
    firm = db.get(Firm, u.firm_id)
    return {'secret': secret, 'otpauth': pyotp.totp.TOTP(secret).provisioning_uri(name=u.email, issuer_name=f'Pravah · {firm.short_name if firm else "Finance Control"}')}


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=8)


def _check_totp(u: User, code: str) -> bool:
    if not u.totp_secret_enc:
        return False
    totp = pyotp.TOTP(crypto.decrypt(u.totp_secret_enc))
    for drift in (0, -1, 1):
        counter = int(now().timestamp()) // 30 + drift
        if totp.verify(code.replace(' ', ''), for_time=counter * 30, valid_window=0) and counter > u.totp_last_counter:
            u.totp_last_counter = counter  # each code works once
            return True
    return False


@router.post('/mfa/confirm')
def mfa_confirm(body: CodeIn, request: Request, db: DbSession = Depends(get_db)):
    s, u = pre_mfa_user(request, db)
    if not _check_totp(u, body.code):
        raise HTTPException(422, 'That code did not match. Check the time on your phone and try the next code.')
    u.mfa_enabled, s.mfa_passed = True, True
    audit(db, u.id, None, 'Enrolled authenticator app', u.email, request=request)
    db.commit()
    return me_out(db, u)


@router.post('/mfa/verify')
def mfa_verify(body: CodeIn, request: Request, db: DbSession = Depends(get_db)):
    s, u = pre_mfa_user(request, db)
    if not u.mfa_enabled:
        raise HTTPException(409, 'Set up the authenticator first')
    if not _check_totp(u, body.code):
        u.failed_logins += 1
        if u.failed_logins >= LOCK_AFTER:
            u.locked_until, u.failed_logins = now() + timedelta(minutes=LOCK_MINUTES), 0
            end_session(db, request, Response())
        db.commit()
        raise HTTPException(422, 'That code did not match.')
    s.mfa_passed, u.failed_logins, u.last_login_at = True, 0, now()
    audit(db, u.id, None, 'Signed in', u.email, request=request)
    db.commit()
    return me_out(db, u)


# ---------- invites and password reset ----------

def make_token(db: DbSession, kind: str, user_id: int, hours: int, created_by: int | None = None) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(Token(kind=kind, user_id=user_id, token_hash=hashlib.sha256(raw.encode()).hexdigest(), expires_at=now() + timedelta(hours=hours), created_by=created_by))
    return raw


def take_token(db: DbSession, kind: str, raw: str) -> Token:
    t = db.scalar(select(Token).where(Token.kind == kind, Token.token_hash == hashlib.sha256(raw.encode()).hexdigest()))
    if not t or t.used_at or t.expires_at < now():
        raise HTTPException(400, 'This link is invalid or has expired. Ask for a new one.')
    t.used_at = now()
    return t


class ForgotIn(BaseModel):
    email: EmailStr


@router.post('/password/forgot')
def forgot(body: ForgotIn, request: Request, db: DbSession = Depends(get_db)):
    csrf_guard(request)
    u = db.scalar(select(User).where(User.email == body.email.lower(), User.status == 'active'))
    if u:
        raw = make_token(db, 'reset', u.id, 2)
        link = f'{settings.public_url}/reset/{raw}'
        send(u.email, 'Reset your Pravah password', f'Hello {u.name},\n\nReset your password here (valid 2 hours):\n{link}\n\nIf you did not ask for this, ignore this email.')
        audit(db, u.id, None, 'Requested password reset', u.email, request=request)
        db.commit()
    return {'ok': True}  # same answer whether or not the address exists


class ResetIn(BaseModel):
    token: str
    password: str


@router.post('/password/reset')
def reset(body: ResetIn, request: Request, db: DbSession = Depends(get_db)):
    csrf_guard(request)
    check_password_strength(body.password)
    t = take_token(db, 'reset', body.token)
    u = db.get(User, t.user_id)
    u.password_hash = hash_password(body.password)
    revoke_all(db, u.id)
    audit(db, u.id, None, 'Password reset', u.email, request=request)
    db.commit()
    return {'ok': True}


@router.get('/invite/{token}')
def invite_info(token: str, db: DbSession = Depends(get_db)):
    t = db.scalar(select(Token).where(Token.kind == 'invite', Token.token_hash == hashlib.sha256(token.encode()).hexdigest()))
    if not t or t.used_at or t.expires_at < now():
        raise HTTPException(400, 'This invite is invalid or has expired. Ask your firm admin for a new one.')
    u = db.get(User, t.user_id)
    firm = db.get(Firm, u.firm_id)
    return {'email': u.email, 'name': u.name, 'firm': firm.name}


class AcceptIn(BaseModel):
    token: str
    name: str = Field(min_length=2, max_length=120)
    password: str


@router.post('/invite/accept')
def invite_accept(body: AcceptIn, request: Request, response: Response, db: DbSession = Depends(get_db)):
    csrf_guard(request)
    check_password_strength(body.password)
    t = take_token(db, 'invite', body.token)
    u = db.get(User, t.user_id)
    u.name, u.password_hash, u.status = body.name.strip(), hash_password(body.password), 'active'
    audit(db, u.id, None, 'Accepted invite', u.email, request=request)
    return _signed_in(db, u, request, response)


class ChangeIn(BaseModel):
    current: str
    password: str


@router.post('/password')
def set_password(body: ChangeIn, request: Request, u: User = Depends(current_user), db: DbSession = Depends(get_db)):
    if not verify_password(u.password_hash, body.current):
        raise HTTPException(422, 'Current password is incorrect')
    check_password_strength(body.password)
    u.password_hash = hash_password(body.password)
    audit(db, u.id, None, 'Changed password', u.email, request=request)
    db.commit()
    return {'ok': True}
