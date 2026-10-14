"""Extraction job: read the stored original, call the configured provider, apply checks, update the intake document."""
from pathlib import Path

from sqlalchemy.orm import Session

from .. import crypto
from ..auth import audit
from ..config import settings
from ..models import AiSettings, Extraction, SourceDocument
from .providers import DEFAULT_MODELS, EXTRACT
from .validate import build_fields, build_lines

ENV_KEYS = {'anthropic': 'anthropic_api_key', 'openai': 'openai_api_key', 'gemini': 'gemini_api_key'}


class NotConfigured(Exception):
    pass


def provider_config(db: Session) -> tuple[str, str, str]:
    ai = db.get(AiSettings, 1) or AiSettings(active_provider='anthropic', models={}, enc_keys={})
    p = ai.active_provider
    key = crypto.decrypt(ai.enc_keys[p]) if (ai.enc_keys or {}).get(p) else getattr(settings, ENV_KEYS[p])
    model = (ai.models or {}).get(p) or DEFAULT_MODELS.get(p)
    if not key or not model:
        raise NotConfigured(f'Set an API key and model for {p} in Settings → AI extraction')
    return p, model, key


def extract_document(db: Session, doc_id: int) -> None:
    doc = db.get(SourceDocument, doc_id)
    if not doc or doc.confirmed_by:
        return  # never overwrite fields a person has confirmed
    try:
        provider, model, key = provider_config(db)
    except NotConfigured as e:
        doc.status_note = str(e)
        db.commit()
        return
    try:
        res = EXTRACT[provider](key, model, Path(doc.storage_path).read_bytes(), doc.mime, doc.filename)
    except Exception as e:
        db.add(Extraction(document_id=doc.id, provider=provider, model=model, status='failed', error=f'{type(e).__name__}: {e}'[:2000]))
        doc.status, doc.status_note = 'review', f'Extraction failed ({provider}): {e}'[:300]
        db.commit()
        raise
    fields, lines = build_fields(res.raw), build_lines(res.raw)
    db.add(Extraction(document_id=doc.id, provider=provider, model=model, status='done', raw=res.raw, input_tokens=res.input_tokens, output_tokens=res.output_tokens))
    doc.fields, doc.lines, doc.doc_type = fields, lines, res.raw.get('doc_type')
    low = sum(1 for f in fields if f['confidence'] < 90)
    if doc.doc_type == 'not_finance':
        doc.status, doc.status_note = 'notfinance', 'Model classified this as not a finance document'
    else:
        doc.status = 'review' if low or not fields else 'new'
        doc.status_note = f'{low} field(s) to confirm' if low else 'All fields read with high confidence'
    audit(db, 'PV', doc.entity_id, 'Extracted document', doc.filename, f'{provider} · {model} · {len(fields)} fields, {low} low confidence')
    db.commit()
