from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import WORK_ROLES, audit, current_user, require_admin, require_entity, require_role, role_on, users_with_role
from ..db import get_db
from ..models import ExceptionComment, ExceptionItem, ExceptionRule, Party, User
from ..notify import notify
from ..serialize import exception_out

router = APIRouter(prefix='/api', tags=['exceptions'])
STATUS_TEXT = {'open': 'Open', 'in-progress': 'In progress', 'waiting-vendor': 'Waiting on vendor', 'awaiting-approval': 'Awaiting approval', 'resolved': 'Resolved'}
EX_ROLES = WORK_ROLES | {'stores', 'ar'}


def _id(s: str) -> int:
    s = str(s).removeprefix('EX-')
    if not s.isdigit():
        raise HTTPException(404, 'Exception not found')
    return int(s)


def get_ex(db: Session, u: User, ex_id: str) -> ExceptionItem:
    x = db.get(ExceptionItem, _id(ex_id))
    if not x:
        raise HTTPException(404, 'Exception not found')
    require_entity(u, x.entity_id)
    require_role(u, x.entity_id, EX_ROLES, 'work on exceptions')
    return x


def _h(x: ExceptionItem, text: str) -> None:
    x.history = [*(x.history or []), {'at': datetime.now(UTC).isoformat(), 'text': text}]


def _resolve(x: ExceptionItem, who: str, how: str) -> None:
    x.status, x.resolved_at, x.resolution = 'resolved', datetime.now(UTC), how
    _h(x, f'Resolved by {who}: {how}')


@router.get('/exceptions')
def list_exceptions(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    return [exception_out(x) for x in db.scalars(select(ExceptionItem).where(ExceptionItem.entity_id == entity).order_by(ExceptionItem.created_at.desc()).limit(1000))]


@router.get('/exception-rules')
def list_rules(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return [{'id': r.id, 'name': r.name, 'type': r.type, 'description': r.description, 'enabled': r.enabled, 'priority': r.priority, 'slaDays': r.sla_days, 'defaultRole': r.default_role}
            for r in db.scalars(select(ExceptionRule).order_by(ExceptionRule.name))]


class RulePatch(BaseModel):
    enabled: bool | None = None
    priority: Literal['Critical', 'High', 'Medium', 'Low'] | None = None
    sla_days: int | None = None
    default_role: str | None = None


@router.patch('/exception-rules/{rule_id}')
def update_rule(rule_id: str, body: RulePatch, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_admin(u, 'change exception rules')
    r = db.get(ExceptionRule, rule_id)
    if not r:
        raise HTTPException(404, 'Rule not found')
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(r, k, v)
    audit(db, u.id, None, 'Changed exception rule', r.name, ', '.join(f'{k}={v}' for k, v in changes.items()), request=request)
    db.commit()
    return {'id': r.id, 'enabled': r.enabled, 'priority': r.priority, 'slaDays': r.sla_days}


class ExPatch(BaseModel):
    ids: list[str]
    ownerId: str | None = None
    priority: Literal['Critical', 'High', 'Medium', 'Low'] | None = None
    due: date | None = None
    status: Literal['open', 'in-progress', 'waiting-vendor', 'awaiting-approval', 'resolved'] | None = None
    snoozeDays: int | None = None
    resolution: str | None = None


@router.post('/exceptions/update')
def update_exceptions(body: ExPatch, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    out = []
    for ex_id in body.ids:
        x = get_ex(db, u, ex_id)
        if body.ownerId is not None and body.ownerId.isdigit() and int(body.ownerId) != x.owner_id:
            new = db.get(User, int(body.ownerId))
            if not new:
                raise HTTPException(404, 'Owner not found')
            _h(x, f'Assigned to {new.name} by {u.name}')
            x.owner_id = new.id
            notify(db, x.entity_id, f'EX-{x.id} assigned to you', x.title, f'/exceptions?ex=EX-{x.id}', 'acc', user_id=new.id)
        if body.priority and body.priority != x.priority:
            _h(x, f'Priority {x.priority} → {body.priority} by {u.name}')
            x.priority = body.priority
        if body.due and body.due != x.due:
            _h(x, f'Due date set to {body.due.strftime("%d-%m-%Y")} by {u.name}')
            x.due = body.due
        if body.snoozeDays:
            x.snoozed_until = date.today() + timedelta(days=body.snoozeDays)
            _h(x, f'Snoozed until {x.snoozed_until.strftime("%d-%m-%Y")} by {u.name}')
        if body.status == 'resolved':
            _resolve(x, u.name, body.resolution or 'Resolved')
        elif body.status and body.status != x.status:
            _h(x, f'Status {STATUS_TEXT[x.status]} → {STATUS_TEXT[body.status]} by {u.name}')
            x.status, x.status_note = body.status, None
        changes = {k: v for k, v in body.model_dump(exclude_unset=True, exclude={'ids'}).items() if v is not None}
        audit(db, u.id, x.entity_id, 'Updated exception', f'EX-{x.id}', ', '.join(f'{k}: {v}' for k, v in changes.items()), request=request)
        out.append(x)
    db.commit()
    return [exception_out(x) for x in out]


class CommentIn(BaseModel):
    text: str


@router.post('/exceptions/{ex_id}/comments')
def add_comment(ex_id: str, body: CommentIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    x = get_ex(db, u, ex_id)
    if not body.text.strip():
        raise HTTPException(422, 'Comment is empty.')
    db.add(ExceptionComment(exception_id=x.id, user_id=u.id, text=body.text.strip()))
    for m in users_with_role(db, x.entity_id, EX_ROLES | {'auditor'}):
        if m.id != u.id and ('@' + m.name.split()[0]) in body.text:
            notify(db, x.entity_id, f'{u.name} mentioned you', f'EX-{x.id}: {body.text[:80]}', f'/exceptions?ex=EX-{x.id}', 'none', user_id=m.id)
    audit(db, u.id, x.entity_id, 'Commented', f'EX-{x.id}', body.text[:120], request=request)
    db.commit()
    db.refresh(x)
    return exception_out(x)


@router.post('/exceptions/{ex_id}/checklist/{item_id}')
def toggle_checklist(ex_id: str, item_id: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    x = get_ex(db, u, ex_id)
    items = [dict(c) for c in (x.checklist or [])]
    c = next((c for c in items if c['id'] == item_id), None)
    if not c:
        raise HTTPException(404, 'Checklist item not found')
    if c.get('role') and not c['done'] and role_on(u, x.entity_id) != c['role'] and not u.is_admin:
        raise HTTPException(403, f'Only the {c["role"].upper()} can tick this item.')
    c['done'] = not c['done']
    x.checklist = items
    _h(x, f'{"Completed" if c["done"] else "Reopened"}: {c["label"]} ({u.name})')
    if all(i['done'] for i in items) and x.blocks:
        _resolve(x, u.name, 'Bank change verified; master updated and payments released')
        v = db.get(Party, x.vendor_id) if x.vendor_id else None
        if v:
            v.blocked = False
    audit(db, u.id, x.entity_id, 'Checklist', f'EX-{x.id}', f'{"✓" if c["done"] else "✗"} {c["label"]}', request=request)
    db.commit()
    return exception_out(x)


class CallbackIn(BaseModel):
    outcome: Literal['confirmed', 'denied', 'no-answer']
    note: str = ''


@router.post('/exceptions/{ex_id}/callback')
def record_callback(ex_id: str, body: CallbackIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    x = get_ex(db, u, ex_id)
    text = {'confirmed': 'Vendor confirmed the change on call-back', 'denied': 'Vendor denied making the request — likely fraud', 'no-answer': 'No answer on call-back'}[body.outcome]
    _h(x, f'{text} ({u.name})' + (f': {body.note}' if body.note else ''))
    db.add(ExceptionComment(exception_id=x.id, user_id=u.id, text=f'Call-back: {text}.' + (f' {body.note}' if body.note else '')))
    if x.checklist:
        items = [dict(c) for c in x.checklist]
        for c in items:
            if c['id'] == 'c1' and body.outcome == 'confirmed':
                c['done'] = True
        x.checklist = items
    if body.outcome == 'denied':
        x.priority = 'Critical'
        _h(x, 'Flagged as suspected fraud')
    audit(db, u.id, x.entity_id, 'Recorded call-back', f'EX-{x.id}', text, request=request)
    db.commit()
    db.refresh(x)
    return exception_out(x)


@router.post('/exceptions/{ex_id}/reject-change')
def reject_change(ex_id: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    x = get_ex(db, u, ex_id)
    _resolve(x, u.name, 'Bank change rejected; vendor master unchanged')
    v = db.get(Party, x.vendor_id) if x.vendor_id else None
    if v:
        v.blocked = False
    audit(db, u.id, x.entity_id, 'Rejected bank change', f'EX-{x.id}', 'Vendor master unchanged', request=request)
    db.commit()
    return exception_out(x)


@router.post('/exceptions/{ex_id}/escalate')
def escalate(ex_id: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    x = get_ex(db, u, ex_id)
    targets = users_with_role(db, x.entity_id, {'cfo'}) or users_with_role(db, x.entity_id, {'controller', 'partner'})
    targets = [t for t in targets if t.id != u.id] or targets
    if not targets:
        raise HTTPException(409, 'No CFO, controller or partner is assigned to this client')
    t = targets[0]
    _h(x, f'Escalated to {t.name} by {u.name}')
    x.owner_id = t.id
    if x.priority not in ('Critical',):
        x.priority = 'High'
    notify(db, x.entity_id, f'EX-{x.id} escalated to you', x.title, f'/exceptions?ex=EX-{x.id}', 'bad', user_id=t.id)
    audit(db, u.id, x.entity_id, 'Escalated', f'EX-{x.id}', 'to ' + t.name, request=request)
    db.commit()
    return exception_out(x)
