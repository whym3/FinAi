"""Sessions, passwords, MFA and permissions. Every router depends on `current_user`."""
import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .config import settings
from .db import get_db
from .models import AuditLog, Entity, Session, User, UserEntity

COOKIE = 'pv_session'
CSRF_HEADER = 'x-pravah'
ROLES = ('partner', 'manager', 'cfo', 'controller', 'ap', 'ar', 'gst', 'procurement', 'stores', 'auditor')
FIRM_WIDE = {'partner', 'manager'}  # see every client of the firm
ADMIN_ROLES = {'partner', 'cfo', 'controller'}  # may connect integrations and edit client details
WORK_ROLES = {'ap', 'controller', 'cfo', 'partner', 'manager', 'gst', 'procurement'}
_pw = PasswordHash.recommended()


def hash_password(p: str) -> str:
    return _pw.hash(p)


def verify_password(h: str | None, p: str) -> bool:
    return bool(h) and _pw.verify(p, h)


def check_password_strength(p: str) -> None:
    if len(p) < 12:
        raise HTTPException(422, 'Use at least 12 characters')


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def now() -> datetime:
    return datetime.now(UTC)


# ---------- sessions ----------

def start_session(db: DbSession, user: User, request: Request, response: Response, mfa_passed: bool) -> None:
    raw = secrets.token_urlsafe(32)
    db.add(Session(id=_h(raw), user_id=user.id, mfa_passed=mfa_passed, expires_at=now() + timedelta(hours=settings.session_hours),
                   ip=request.client.host if request.client else None, user_agent=(request.headers.get('user-agent') or '')[:300]))
    response.set_cookie(COOKIE, raw, httponly=True, samesite='lax', secure=settings.secure_cookies, path='/', max_age=settings.session_hours * 3600)


def end_session(db: DbSession, request: Request, response: Response) -> None:
    raw = request.cookies.get(COOKIE)
    if raw:
        s = db.get(Session, _h(raw))
        if s:
            db.delete(s)
    response.delete_cookie(COOKIE, path='/')


def revoke_all(db: DbSession, user_id: int) -> None:
    for s in db.scalars(select(Session).where(Session.user_id == user_id)):
        db.delete(s)


def load_session(request: Request, db: DbSession) -> tuple[Session, User] | None:
    raw = request.cookies.get(COOKIE)
    if not raw:
        return None
    s = db.get(Session, _h(raw))
    if not s or s.expires_at < now():
        return None
    u = db.get(User, s.user_id)
    if not u or u.status != 'active':
        return None
    if (now() - s.last_seen_at) > timedelta(minutes=5):  # sliding expiry, written at most every 5 min
        s.last_seen_at = now()
        s.expires_at = now() + timedelta(hours=settings.session_hours)
        db.commit()
    return s, u


def csrf_guard(request: Request) -> None:
    """Browsers cannot add custom headers cross-site without CORS, so this header proves a same-origin script sent the request."""
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.headers.get(CSRF_HEADER) != '1':
        raise HTTPException(403, 'Missing X-Pravah header')


def current_user(request: Request, db: DbSession = Depends(get_db)) -> User:
    csrf_guard(request)
    loaded = load_session(request, db)
    if not loaded:
        raise HTTPException(401, 'unauthenticated')
    s, u = loaded
    if not s.mfa_passed:
        raise HTTPException(401, 'mfa_enrol' if not u.mfa_enabled else 'mfa_required')
    request.state.user = u
    return u


def pre_mfa_user(request: Request, db: DbSession = Depends(get_db)) -> tuple[Session, User]:
    """A session that passed the password but not yet MFA (used by the MFA endpoints only)."""
    csrf_guard(request)
    loaded = load_session(request, db)
    if not loaded:
        raise HTTPException(401, 'unauthenticated')
    return loaded


# ---------- permissions ----------

def firm_wide(u: User) -> bool:
    return u.is_admin or any(ue.role in FIRM_WIDE for ue in u.entities)


def role_on(u: User, entity_id: str) -> str | None:
    for ue in u.entities:
        if ue.entity_id == entity_id:
            return ue.role
    if u.is_admin:
        return 'partner'
    fw = [ue.role for ue in u.entities if ue.role in FIRM_WIDE]
    return fw[0] if fw else None


def visible_entities(db: DbSession, u: User) -> list[Entity]:
    q = select(Entity).where(Entity.firm_id == u.firm_id).order_by(Entity.created_at)
    ents = list(db.scalars(q))
    if firm_wide(u):
        return ents
    mine = {ue.entity_id for ue in u.entities}
    return [e for e in ents if e.id in mine]


def can_see(u: User, entity_id: str) -> bool:
    return role_on(u, entity_id) is not None


def require_entity(u: User, entity_id: str) -> str:
    r = role_on(u, entity_id)
    if not r:
        raise HTTPException(403, 'You do not have access to this client')
    return r


def require_role(u: User, entity_id: str | None, roles: set[str], what: str) -> None:
    if u.is_admin:
        return
    r = role_on(u, entity_id) if entity_id else ('partner' if firm_wide(u) else None)
    if r == 'auditor':
        raise HTTPException(403, 'Your role is read-only.')
    if r not in roles:
        raise HTTPException(403, f'Your role cannot {what}.')


def require_admin(u: User, what: str = 'change firm settings') -> None:
    if not (u.is_admin or any(ue.role == 'partner' for ue in u.entities)):
        raise HTTPException(403, f'Only a firm admin or partner can {what}.')


def approval_limit(u: User, entity_id: str) -> float:
    for ue in u.entities:
        if ue.entity_id == entity_id:
            return float(ue.approval_limit or 0)
    return 1e12 if (u.is_admin or firm_wide(u)) else 0.0


def is_read_only(u: User, entity_id: str) -> bool:
    return role_on(u, entity_id) == 'auditor'


# ---------- audit ----------

def audit(db: DbSession, user_id: int | None, entity_id: str | None, action: str, target: str = '', detail: str = '',
          before: dict | None = None, after: dict | None = None, request: Request | None = None) -> None:
    db.add(AuditLog(user_id=user_id, entity_id=entity_id, action=action, target=target[:200], detail=detail, before=before, after=after,
                    ip=request.client.host if request and request.client else None,
                    user_agent=(request.headers.get('user-agent') or '')[:300] if request else None))


def user_label(db: DbSession, user_id: int | None) -> str:
    if user_id is None:
        return 'Pravah'
    u = db.get(User, user_id)
    return u.name if u else f'user {user_id}'


def entity_users(db: DbSession, entity_id: str) -> list[User]:
    """Everyone who can see the entity: assigned users plus firm-wide roles and admins."""
    e = db.get(Entity, entity_id)
    if not e:
        return []
    out = []
    for u in db.scalars(select(User).where(User.firm_id == e.firm_id, User.status == 'active')):
        if can_see(u, entity_id):
            out.append(u)
    return out


def users_with_role(db: DbSession, entity_id: str, roles: set[str]) -> list[User]:
    return [u for u in entity_users(db, entity_id) if role_on(u, entity_id) in roles]
