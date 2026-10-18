"""Which model reads documents: provider, key and model, set by a firm admin."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import crypto
from ..auth import audit, current_user, require_admin
from ..db import get_db
from ..extract import ai
from ..models import AiSetting, User
from ..serialize import ai_out

router = APIRouter(prefix='/api', tags=['ai'])


class AiIn(BaseModel):
    provider: Literal['anthropic', 'openai'] = 'anthropic'
    model: str = ''
    api_key: str | None = None  # None keeps the stored one; '' clears it


class AiTestIn(AiIn):
    pass


def _get(db: Session) -> AiSetting:
    return ai.row(db) or AiSetting()


@router.get('/ai')
def read(u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_admin(u, 'see the document reading settings')
    return ai_out(_get(db), ai.config(db))


@router.put('/ai')
def save(body: AiIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_admin(u, 'change the document reading settings')
    r = _get(db)
    if not r.id:
        db.add(r)
    r.provider = body.provider
    r.model = (body.model or ai.DEFAULT_MODEL[body.provider]).strip()
    if body.api_key is not None:
        r.enc_api_key = crypto.encrypt(body.api_key) if body.api_key else None
        r.last_test_at, r.last_test_result = None, None  # a new key has not been checked yet
    r.updated_at = datetime.now(UTC)
    db.flush()
    audit(db, u.id, None, 'Saved document reading settings', f'{r.provider} · {r.model}', 'key set' if r.enc_api_key else 'no key', request=request)
    db.commit()
    return ai_out(r, ai.config(db))


def _key_for(db: Session, r: AiSetting, typed: str | None) -> str:
    """The key to try: what is in the form, else the saved one, else the server's env key."""
    if typed:
        return typed
    if r.enc_api_key:
        return crypto.decrypt(r.enc_api_key)
    return ai.config(db).api_key


@router.post('/ai/models')
def models(body: AiIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """The models the key can use, so the dropdown is the provider's real list."""
    require_admin(u, 'see the document reading settings')
    key = _key_for(db, _get(db), body.api_key)
    if not key:
        raise HTTPException(422, 'Enter an API key first')
    ok, found, message = ai.list_models(body.provider, key)
    return {'ok': ok, 'models': found, 'message': message}


@router.post('/ai/test')
def test(body: AiTestIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Checks the key typed in the form, or the saved one when the field is left empty."""
    require_admin(u, 'test the document reading settings')
    r = _get(db)
    key = _key_for(db, r, body.api_key)
    if not key:
        raise HTTPException(422, 'Enter an API key first')
    model = (body.model or r.model or ai.DEFAULT_MODEL[body.provider]).strip()
    ok, message = ai.check(body.provider, key, model)
    if r.id:
        r.last_test_at, r.last_test_result = datetime.now(UTC), ('OK: ' if ok else 'Failed: ') + message
        audit(db, u.id, None, 'Tested document reading', f'{body.provider} · {model}', r.last_test_result, request=request)
        db.commit()
    return {'ok': ok, 'message': message}
