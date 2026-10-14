from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..auth import ROLES, audit, current_user, entity_users, require_admin, revoke_all
from ..config import settings
from ..db import get_db
from ..mailer import send
from ..models import Entity, Token, User, UserEntity
from ..serialize import user_out
from .auth import make_token

router = APIRouter(prefix='/api/users', tags=['users'])


class Assignment(BaseModel):
    entity_id: str
    role: str
    approval_limit: float = Field(0, ge=0)


def _check(assignments: list[Assignment], db: DbSession, firm_id: int) -> None:
    for a in assignments:
        if a.role not in ROLES:
            raise HTTPException(422, f'Unknown role {a.role}')
        e = db.get(Entity, a.entity_id)
        if not e or e.firm_id != firm_id:
            raise HTTPException(404, f'Client {a.entity_id} not found')


@router.get('')
def list_users(entity: str | None = None, u: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """With ?entity= : the people who can act on that client (for owner pickers). Without: the whole firm (admins only)."""
    if entity:
        return [user_out(x) for x in entity_users(db, entity)]
    require_admin(u, 'list users')
    return [user_out(x, full=True) for x in db.scalars(select(User).where(User.firm_id == u.firm_id).order_by(User.created_at))]


class InviteIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=120)
    title: str = ''
    is_admin: bool = False
    assignments: list[Assignment] = []


@router.post('/invite', status_code=201)
def invite(body: InviteIn, request: Request, u: User = Depends(current_user), db: DbSession = Depends(get_db)):
    require_admin(u, 'invite users')
    if db.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(409, 'A user with this email already exists')
    _check(body.assignments, db, u.firm_id)
    nu = User(firm_id=u.firm_id, email=body.email.lower(), name=body.name.strip(), title=body.title.strip(), is_admin=body.is_admin, status='invited')
    db.add(nu)
    db.flush()
    for a in body.assignments:
        db.add(UserEntity(user_id=nu.id, entity_id=a.entity_id, role=a.role, approval_limit=a.approval_limit))
    raw = make_token(db, 'invite', nu.id, 72, created_by=u.id)
    link = f'{settings.public_url}/invite/{raw}'
    sent = send(nu.email, f'You are invited to Pravah', f'Hello {nu.name},\n\n{u.name} invited you to Pravah Finance Control. Set your password here (valid 3 days):\n{link}')
    audit(db, u.id, None, 'Invited user', nu.email, f'{body.title} · {len(body.assignments)} client(s)' + ('' if sent else ' · link shown to admin'), request=request)
    db.commit()
    db.refresh(nu)
    return {'user': user_out(nu, full=True), 'link': None if sent else link}


@router.post('/{user_id}/reinvite')
def reinvite(user_id: int, request: Request, u: User = Depends(current_user), db: DbSession = Depends(get_db)):
    require_admin(u, 'invite users')
    nu = db.get(User, user_id)
    if not nu or nu.firm_id != u.firm_id or nu.status != 'invited':
        raise HTTPException(404, 'No pending invite for this user')
    raw = make_token(db, 'invite', nu.id, 72, created_by=u.id)
    link = f'{settings.public_url}/invite/{raw}'
    sent = send(nu.email, 'Your Pravah invite', f'Hello {nu.name},\n\nSet your password here (valid 3 days):\n{link}')
    audit(db, u.id, None, 'Re-sent invite', nu.email, request=request)
    db.commit()
    return {'link': None if sent else link}


class UserPatch(BaseModel):
    name: str | None = None
    title: str | None = None
    is_admin: bool | None = None
    status: str | None = Field(None, pattern='^(active|disabled)$')
    assignments: list[Assignment] | None = None


@router.patch('/{user_id}')
def update_user(user_id: int, body: UserPatch, request: Request, u: User = Depends(current_user), db: DbSession = Depends(get_db)):
    require_admin(u, 'edit users')
    nu = db.get(User, user_id)
    if not nu or nu.firm_id != u.firm_id:
        raise HTTPException(404, 'User not found')
    before = user_out(nu, full=True)
    if body.status == 'disabled' and nu.id == u.id:
        raise HTTPException(409, 'You cannot disable your own account')
    for k in ('name', 'title', 'is_admin'):
        v = getattr(body, k)
        if v is not None:
            setattr(nu, k, v)
    if body.status:
        if nu.status == 'invited' and body.status == 'active':
            raise HTTPException(409, 'The user must accept the invite first')
        nu.status = body.status
        if body.status == 'disabled':
            revoke_all(db, nu.id)
    if body.assignments is not None:
        _check(body.assignments, db, u.firm_id)
        nu.entities = [UserEntity(entity_id=a.entity_id, role=a.role, approval_limit=a.approval_limit) for a in body.assignments]
    db.flush()
    audit(db, u.id, None, 'Edited user', nu.email, ', '.join(body.model_dump(exclude_unset=True)), before=before, after=user_out(nu, full=True), request=request)
    db.commit()
    db.refresh(nu)
    return user_out(nu, full=True)


@router.post('/{user_id}/reset-mfa')
def reset_mfa(user_id: int, request: Request, u: User = Depends(current_user), db: DbSession = Depends(get_db)):
    require_admin(u, 'reset MFA')
    nu = db.get(User, user_id)
    if not nu or nu.firm_id != u.firm_id:
        raise HTTPException(404, 'User not found')
    nu.mfa_enabled, nu.totp_secret_enc, nu.totp_last_counter = False, None, 0
    revoke_all(db, nu.id)
    audit(db, u.id, None, 'Reset authenticator', nu.email, 'They will enrol again at next sign-in', request=request)
    db.commit()
    return {'ok': True}
