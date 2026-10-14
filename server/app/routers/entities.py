import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import ADMIN_ROLES, audit, current_user, require_admin, require_entity, require_role, visible_entities
from ..db import get_db
from ..models import Entity, GstRegistration, User
from ..serialize import entity_out
from ..validate import CIN_RE, PAN_RE, TAN_RE, check_gstin

router = APIRouter(prefix='/api', tags=['entities'])


class GstIn(BaseModel):
    gstin: str
    place_of_business: str = ''
    filing_frequency: Literal['monthly', 'qrmp'] = 'monthly'
    einvoice_applicable: bool = True


class EntityIn(BaseModel):
    legal_name: str = Field(min_length=2, max_length=200)
    short_name: str = Field(min_length=2, max_length=80)
    city: str = ''
    pan: str
    tan: str | None = None
    cin: str | None = None
    fy_start_month: int = Field(4, ge=1, le=12)
    einvoice_band: Literal['above-5cr', 'below-5cr', 'exempt'] = 'above-5cr'
    msme_status: Literal['none', 'micro', 'small', 'medium'] = 'none'
    sap_company_code: str = ''
    whatsapp: str = ''
    gstins: list[GstIn] = []


class EntityPatch(BaseModel):
    legal_name: str | None = None
    short_name: str | None = None
    city: str | None = None
    tan: str | None = None
    cin: str | None = None
    fy_start_month: int | None = Field(None, ge=1, le=12)
    einvoice_band: Literal['above-5cr', 'below-5cr', 'exempt'] | None = None
    msme_status: Literal['none', 'micro', 'small', 'medium'] | None = None
    sap_company_code: str | None = None
    whatsapp: str | None = None
    gstins: list[GstIn] | None = None


def _ids(e: EntityIn | EntityPatch) -> None:
    if isinstance(e, EntityIn):
        e.pan = e.pan.strip().upper()
        if not PAN_RE.match(e.pan):
            raise HTTPException(422, 'PAN must look like AAACM1234M')
    if e.tan:
        e.tan = e.tan.strip().upper()
        if not TAN_RE.match(e.tan):
            raise HTTPException(422, 'TAN must look like PNEM12345A')
    if e.cin:
        e.cin = e.cin.strip().upper()
        if not CIN_RE.match(e.cin):
            raise HTTPException(422, 'CIN must be 21 characters (or an LLPIN like AAA-1234)')


def _gstins(db: Session, entity_id: str | None, pan: str, rows: list[GstIn]) -> list[GstRegistration]:
    out, seen = [], set()
    for r in rows:
        g = r.gstin.strip().upper()
        chk = check_gstin(g, pan)
        if chk['errors']:
            raise HTTPException(422, f'{g}: {chk["errors"][0]}')
        if g in seen:
            raise HTTPException(422, f'{g} is listed twice')
        seen.add(g)
        other = db.scalar(select(GstRegistration).where(GstRegistration.gstin == g))
        if other and other.entity_id != entity_id:
            raise HTTPException(409, f'{g} is already registered to client {other.entity_id}')
        out.append(GstRegistration(gstin=g, state_code=chk['state_code'], state=chk['state'], place_of_business=r.place_of_business,
                                   filing_frequency=r.filing_frequency, einvoice_applicable=r.einvoice_applicable))
    return out


def _slug(db: Session, name: str) -> str:
    base = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:32] or 'client'
    slug, n = base, 2
    while db.get(Entity, slug):
        slug, n = f'{base}-{n}', n + 1
    return slug


def get_entity(db: Session, u: User, entity_id: str) -> Entity:
    require_entity(u, entity_id)
    e = db.get(Entity, entity_id)
    if not e or e.firm_id != u.firm_id:
        raise HTTPException(404, 'Client not found')
    return e


@router.get('/entities')
def list_entities(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return [entity_out(e) for e in visible_entities(db, u)]


@router.get('/entities/{entity_id}')
def read_entity(entity_id: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    return entity_out(get_entity(db, u, entity_id))


@router.post('/entities', status_code=201)
def create_entity(body: EntityIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_admin(u, 'onboard clients')
    _ids(body)
    e = Entity(id=_slug(db, body.short_name), firm_id=u.firm_id, status='onboarding', created_by=u.id, **body.model_dump(exclude={'gstins'}))
    e.gstins = _gstins(db, None, body.pan, body.gstins)
    db.add(e)
    db.flush()
    audit(db, u.id, e.id, 'Started client onboarding', e.legal_name, f'PAN {e.pan} · {len(e.gstins)} GSTIN(s)', after=body.model_dump(), request=request)
    db.commit()
    db.refresh(e)
    return entity_out(e)


@router.patch('/entities/{entity_id}')
def update_entity(entity_id: str, body: EntityPatch, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    e = get_entity(db, u, entity_id)
    require_role(u, e.id, ADMIN_ROLES, 'edit client details')
    _ids(body)
    before = entity_out(e)
    for k, v in body.model_dump(exclude_unset=True, exclude={'gstins'}).items():
        setattr(e, k, v)
    if body.gstins is not None:
        new = _gstins(db, e.id, e.pan, body.gstins)
        dropped = {g.gstin for g in e.gstins} - {g.gstin for g in new}
        if dropped and e.status == 'active':
            raise HTTPException(409, f'GSTIN {", ".join(sorted(dropped))} cannot be removed from an active client; mark it cancelled instead')
        keep = {g.gstin: g for g in e.gstins}
        for g in new:
            if g.gstin in keep:
                k = keep[g.gstin]
                k.place_of_business, k.filing_frequency, k.einvoice_applicable = g.place_of_business, g.filing_frequency, g.einvoice_applicable
        e.gstins = [keep.get(g.gstin) or g for g in new]
    db.flush()
    audit(db, u.id, e.id, 'Edited client details', e.legal_name, ', '.join(body.model_dump(exclude_unset=True)), before=before, after=entity_out(e), request=request)
    db.commit()
    db.refresh(e)
    return entity_out(e)


@router.post('/entities/{entity_id}/activate')
def activate_entity(entity_id: str, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    e = get_entity(db, u, entity_id)
    require_admin(u, 'activate clients')
    if not e.gstins:
        raise HTTPException(422, 'Add at least one GST registration first')
    e.status = 'active'
    audit(db, u.id, e.id, 'Activated client', e.legal_name, request=request)
    db.commit()
    db.refresh(e)
    return entity_out(e)


class GstinCheck(BaseModel):
    gstin: str
    pan: str | None = None


@router.post('/validate/gstin')
def validate_gstin(body: GstinCheck, _: User = Depends(current_user)):
    return check_gstin(body.gstin, body.pan)
