from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import crypto
from ..auth import ADMIN_ROLES, audit, current_user, require_entity, require_role
from ..db import get_db
from ..models import Job, SapConnection, User
from ..sap.odata import OBJECTS, SapClient
from ..serialize import sap_out

router = APIRouter(prefix='/api', tags=['sap'])


class SapIn(BaseModel):
    edition: Literal['public-cloud', 'private-cloud', 'on-premise'] = 'private-cloud'
    host: str = ''
    client: str = Field('', max_length=3)
    company_code: str = ''
    plant_mapping: dict[str, str] = {}
    username: str = ''
    password: str | None = None  # None keeps the stored one; '' clears it
    objects: list[str] = []
    schedule_minutes: int = Field(60, ge=15, le=1440)
    status: Literal['draft', 'active', 'paused'] | None = None


def _get(db: Session, entity: str) -> SapConnection:
    return db.scalar(select(SapConnection).where(SapConnection.entity_id == entity)) or SapConnection(entity_id=entity)


@router.get('/entities/{entity}/sap')
def read(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    c = _get(db, entity)
    return sap_out(c) if c.id else {'entityId': entity, 'status': 'none', 'objects': [], 'edition': 'private-cloud', 'host': '', 'client': '', 'companyCode': '', 'username': '', 'passwordSet': False, 'scheduleMinutes': 60}


@router.put('/entities/{entity}/sap')
def save(entity: str, body: SapIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(u, entity, ADMIN_ROLES, 'configure SAP')
    c = _get(db, entity)
    if not c.id:
        db.add(c)
    bad = [o for o in body.objects if o not in OBJECTS]
    if bad:
        raise HTTPException(422, f'Unknown objects: {", ".join(bad)}')
    for k in ('edition', 'host', 'client', 'company_code', 'plant_mapping', 'username', 'objects', 'schedule_minutes'):
        setattr(c, k, getattr(body, k))
    c.host = c.host.strip().rstrip('/')
    if body.password is not None:
        c.enc_password = crypto.encrypt(body.password) if body.password else None
    if body.status:
        if body.status == 'active' and not (c.host and c.username and c.enc_password):
            raise HTTPException(422, 'Host, user and password are needed before activating')
        c.status = body.status
    c.updated_at = datetime.now(UTC)
    db.flush()
    audit(db, u.id, entity, 'Saved SAP connection', c.host or '(no host)', f'{c.edition} · {", ".join(c.objects or [])} · {c.status}', request=request)
    db.commit()
    return sap_out(c)


@router.post('/entities/{entity}/sap/test')
def test(entity: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(u, entity, ADMIN_ROLES, 'configure SAP')
    c = _get(db, entity)
    if not c.id or not c.host:
        raise HTTPException(422, 'Save the host first')
    if not c.enc_password:
        raise HTTPException(422, 'Enter the communication user password')
    ok, msg = SapClient(c.host, c.client, c.username, crypto.decrypt(c.enc_password), c.edition, timeout=20).test()
    c.last_test_at, c.last_test_result = datetime.now(UTC), ('OK: ' if ok else 'Failed: ') + msg
    audit(db, u.id, entity, 'Tested SAP connection', c.host, c.last_test_result, request=request)
    db.commit()
    return {'ok': ok, 'message': msg}


@router.post('/entities/{entity}/sap/sync')
def sync_now(entity: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(u, entity, ADMIN_ROLES, 'run SAP sync')
    c = _get(db, entity)
    if not c.id or c.status != 'active':
        raise HTTPException(409, 'Activate the connection first')
    db.add(Job(kind='sap_sync', payload={'connection_id': c.id}))
    audit(db, u.id, entity, 'Queued SAP sync', c.host, request=request)
    db.commit()
    return {'queued': True}
