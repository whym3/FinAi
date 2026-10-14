from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .db import get_db
from .models import AuditLog, User

ADMIN_ROLES = {'partner', 'cfo', 'controller'}  # may connect mailboxes and change AI settings


def load_user(db: Session, user_id: str | None) -> User:
    u = db.get(User, user_id or '')
    if not u:
        raise HTTPException(401, 'Unknown user')
    return u


# shortcut: trusts the X-User-Id header set by the "Act as" switcher; replace with SSO + MFA before any real deployment.
def current_user(x_user_id: str | None = Header(None), db: Session = Depends(get_db)) -> User:
    return load_user(db, x_user_id)


def can_see(u: User, entity_id: str) -> bool:
    return u.entity_ids == 'all' or entity_id in (u.entity_ids or [])


def require_entity(u: User, entity_id: str) -> None:
    if not can_see(u, entity_id):
        raise HTTPException(403, 'You do not have access to this client')


def require_role(u: User, roles: set[str], what: str) -> None:
    if u.role == 'auditor':
        raise HTTPException(403, 'Your role is read-only.')
    if u.role not in roles:
        raise HTTPException(403, f'Your role cannot {what}.')


def audit(db: Session, user_id: str, entity_id: str | None, action: str, target: str = '', detail: str = '', before: dict | None = None, after: dict | None = None) -> None:
    db.add(AuditLog(user_id=user_id, entity_id=entity_id, action=action, target=target, detail=detail, before=before, after=after))
