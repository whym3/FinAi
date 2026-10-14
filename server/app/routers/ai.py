from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import crypto
from ..auth import ADMIN_ROLES, audit, current_user, require_role
from ..config import settings
from ..db import get_db
from ..extract.providers import DEFAULT_MODELS, PROVIDERS, list_models
from ..extract.run import ENV_KEYS
from ..models import AiSettings, User

router = APIRouter(prefix='/api/ai-settings', tags=['ai'])
Provider = Literal['anthropic', 'openai', 'gemini']


def _row(db: Session) -> AiSettings:
    ai = db.get(AiSettings, 1)
    if not ai:
        ai = AiSettings(id=1, active_provider='anthropic', models={}, enc_keys={}, keys_set_at={}, auto_extract=True)
        db.add(ai)
        db.flush()
    return ai


def _out(ai: AiSettings) -> dict:
    """Keys are write-only: only whether one is set, and when, ever leaves the server."""
    return {'activeProvider': ai.active_provider, 'autoExtract': ai.auto_extract, 'models': {**DEFAULT_MODELS, **(ai.models or {})},
            'keys': {p: {'set': bool((ai.enc_keys or {}).get(p)), 'setOn': (ai.keys_set_at or {}).get(p), 'fromEnv': bool(getattr(settings, ENV_KEYS[p]))} for p in PROVIDERS}}


@router.get('')
def read(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(_row(db))


class AiIn(BaseModel):
    active_provider: Provider | None = None
    auto_extract: bool | None = None
    models: dict[Provider, str] | None = None
    keys: dict[Provider, str] | None = None  # '' clears a stored key


@router.put('')
def update(body: AiIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(u, ADMIN_ROLES, 'change AI settings')
    ai = _row(db)
    changes = []
    if body.active_provider:
        ai.active_provider = body.active_provider
        changes.append(f'provider {body.active_provider}')
    if body.auto_extract is not None:
        ai.auto_extract = body.auto_extract
        changes.append(f'auto-extract {"on" if body.auto_extract else "off"}')
    if body.models:
        ai.models = {**(ai.models or {}), **{p: m.strip() for p, m in body.models.items()}}
        changes += [f'{p} model {m}' for p, m in body.models.items()]
    if body.keys:
        enc, set_at = dict(ai.enc_keys or {}), dict(ai.keys_set_at or {})
        for p, k in body.keys.items():
            if k.strip():
                enc[p], set_at[p] = crypto.encrypt(k.strip()), date.today().isoformat()
                changes.append(f'{p} key set')
            else:
                enc.pop(p, None), set_at.pop(p, None)
                changes.append(f'{p} key removed')
        ai.enc_keys, ai.keys_set_at = enc, set_at
    audit(db, u.id, None, 'Changed AI extraction settings', '', ', '.join(changes))
    db.commit()
    return _out(ai)


class TestIn(BaseModel):
    provider: Provider
    key: str | None = None  # test a key before saving it; else the stored or env key


@router.post('/test')
def test(body: TestIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_role(u, ADMIN_ROLES, 'change AI settings')
    ai = _row(db)
    key = (body.key or '').strip() or (crypto.decrypt(ai.enc_keys[body.provider]) if (ai.enc_keys or {}).get(body.provider) else getattr(settings, ENV_KEYS[body.provider]))
    if not key:
        raise HTTPException(422, 'Enter an API key first')
    try:
        return {'models': list_models(body.provider, key)}
    except Exception as e:
        raise HTTPException(422, f'The key did not work: {type(e).__name__}: {e}'[:300])
