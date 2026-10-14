from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user, require_entity
from ..db import get_db
from ..models import AuditLog, User
from ..serialize import ist

router = APIRouter(prefix='/api', tags=['audit'])


@router.get('/audit')
def list_audit(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    rows = db.scalars(select(AuditLog).where(AuditLog.entity_id == entity).order_by(AuditLog.id.desc()).limit(500))
    return [{'id': f'srv-{a.id}', 'at': ist(a.at), 'userId': a.user_id, 'entityId': a.entity_id, 'action': a.action, 'target': a.target, 'detail': a.detail} for a in rows]
