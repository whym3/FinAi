from fastapi import APIRouter, Depends, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..auth import current_user, require_entity
from ..db import get_db
from ..models import AuditLog, Notification, User
from ..serialize import ist, notification_out

router = APIRouter(prefix='/api', tags=['notifications'])


@router.get('/notifications')
def list_notifications(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    rows = db.scalars(select(Notification).where(Notification.entity_id == entity, or_(Notification.user_id.is_(None), Notification.user_id == u.id)).order_by(Notification.id.desc()).limit(50))
    return [notification_out(n, u.id) for n in rows]


@router.post('/notifications/read')
def mark_read(entity: str, request: Request, id: str | None = None, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    q = select(Notification).where(Notification.entity_id == entity)
    if id and id.isdigit():
        q = q.where(Notification.id == int(id))
    for n in db.scalars(q):
        if u.id not in (n.read_by or []):
            n.read_by = [*(n.read_by or []), u.id]
    db.commit()
    return {'ok': True}


@router.get('/audit')
def list_audit(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    rows = db.scalars(select(AuditLog).where(or_(AuditLog.entity_id == entity, AuditLog.entity_id.is_(None))).order_by(AuditLog.id.desc()).limit(1000))
    return [{'id': str(a.id), 'at': ist(a.at), 'userId': str(a.user_id) if a.user_id else 'PV', 'entityId': a.entity_id or '', 'action': a.action, 'target': a.target, 'detail': a.detail, 'ip': a.ip} for a in rows]
