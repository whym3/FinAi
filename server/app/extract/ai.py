"""All model calls for document reading. Provider, key and model come from the ai_settings row, set in Settings -> Integrations."""
import base64
import json
from dataclasses import dataclass

import anthropic
import openai
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import crypto
from ..models import AiSetting
from .schemas import CLASSIFY_PROMPT, CLASSIFY_SCHEMA, prompt_for, schema_for

ASK = 'Extract this document.'
TEXT_MIMES = ('application/xml', 'application/json')
IMAGE_MIMES = ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
PROVIDERS = ('anthropic', 'openai')
DEFAULT_MODEL = {'anthropic': 'claude-sonnet-5-5', 'openai': 'gpt-5.2'}
# Offered in the UI; any other model name can be typed in.
KNOWN_MODELS = {
    'anthropic': ['claude-opus-4-6', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
    'openai': ['gpt-5.2', 'gpt-5.2-mini', 'gpt-4.1'],
}


class NotConfigured(Exception):
    pass


class Unsupported(Exception):
    pass


@dataclass
class Result:
    raw: dict
    input_tokens: int
    output_tokens: int
    model: str


@dataclass
class Config:
    provider: str
    model: str
    api_key: str

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


def row(db: Session) -> AiSetting | None:
    return db.scalar(select(AiSetting).order_by(AiSetting.id).limit(1))


def config(db: Session) -> Config:
    """Provider, key and model all come from Settings -> Integrations. Nothing is read from the environment."""
    r = row(db)
    if r and r.enc_api_key:
        return Config(r.provider, r.model or DEFAULT_MODEL[r.provider], crypto.decrypt(r.enc_api_key))
    return Config(r.provider if r else 'anthropic', (r.model if r else '') or DEFAULT_MODEL['anthropic'], '')


def configured(db: Session) -> bool:
    return config(db).configured


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _anthropic_part(data: bytes, mime: str, filename: str) -> dict:
    if mime == 'application/pdf':
        return {'type': 'document', 'source': {'type': 'base64', 'media_type': mime, 'data': _b64(data)}}
    if mime in IMAGE_MIMES:
        return {'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': _b64(data)}}
    if mime in TEXT_MIMES:
        return {'type': 'text', 'text': f'File {filename}:\n' + data.decode('utf-8', errors='replace')[:200_000]}
    raise Unsupported(f'{mime} cannot be read; convert it to PDF or an image')


def _openai_part(data: bytes, mime: str, filename: str) -> dict:
    if mime == 'application/pdf':
        return {'type': 'input_file', 'filename': filename, 'file_data': f'data:{mime};base64,{_b64(data)}'}
    if mime in IMAGE_MIMES:
        return {'type': 'input_image', 'image_url': f'data:{mime};base64,{_b64(data)}'}
    if mime in TEXT_MIMES:
        return {'type': 'input_text', 'text': f'File {filename}:\n' + data.decode('utf-8', errors='replace')[:200_000]}
    raise Unsupported(f'{mime} cannot be read; convert it to PDF or an image')


def _call(cfg: Config, system: str, data: bytes, mime: str, filename: str, schema: dict, max_tokens: int = 8000) -> Result:
    if not cfg.configured:
        raise NotConfigured('No API key for document reading. Set one in Settings → Integrations.')
    if cfg.provider == 'openai':
        r = openai.OpenAI(api_key=cfg.api_key).responses.create(
            model=cfg.model, instructions=system, max_output_tokens=max_tokens,
            input=[{'role': 'user', 'content': [_openai_part(data, mime, filename), {'type': 'input_text', 'text': ASK}]}],
            text={'format': {'type': 'json_schema', 'name': 'extraction', 'schema': schema, 'strict': False}})
        return Result(json.loads(r.output_text), r.usage.input_tokens, r.usage.output_tokens, cfg.model)
    r = anthropic.Anthropic(api_key=cfg.api_key).messages.create(
        model=cfg.model, max_tokens=max_tokens, system=system,
        messages=[{'role': 'user', 'content': [_anthropic_part(data, mime, filename), {'type': 'text', 'text': ASK}]}],
        output_config={'format': {'type': 'json_schema', 'schema': schema}})
    text = next(b.text for b in r.content if b.type == 'text')
    return Result(json.loads(text), r.usage.input_tokens, r.usage.output_tokens, cfg.model)


def classify(cfg: Config, data: bytes, mime: str, filename: str) -> Result:
    """Which documents are in the file and on which pages."""
    return _call(cfg, CLASSIFY_PROMPT, data, mime, filename, CLASSIFY_SCHEMA, max_tokens=4000)


def extract(cfg: Config, kind: str, data: bytes, mime: str, filename: str) -> Result:
    return _call(cfg, prompt_for(kind), data, mime, filename, schema_for(kind))


# OpenAI lists everything it sells: embeddings, speech, images. Only text models can read a document.
OPENAI_PREFIXES = ('gpt-', 'o1', 'o3', 'o4', 'chatgpt-')
OPENAI_SKIP = ('embedding', 'tts', 'whisper', 'audio', 'realtime', 'image', 'dall-e', 'moderation', 'transcribe', 'search', 'sora')


def list_models(provider: str, api_key: str) -> tuple[bool, list[str], str]:
    """The models this key can actually use, straight from the provider, newest first."""
    try:
        if provider == 'openai':
            ms = [m for m in openai.OpenAI(api_key=api_key, timeout=30).models.list()
                  if m.id.startswith(OPENAI_PREFIXES) and not any(s in m.id for s in OPENAI_SKIP)]
            return True, [m.id for m in sorted(ms, key=lambda m: (m.created or 0, m.id), reverse=True)], ''
        page = anthropic.Anthropic(api_key=api_key, timeout=30).models.list(limit=100)
        return True, [m.id for m in page.data], ''  # Anthropic already returns newest first
    except Exception as e:
        return False, [], f'{type(e).__name__}: {e}'[:300]


def check(provider: str, api_key: str, model: str) -> tuple[bool, str]:
    """One cheap call, so an admin can see the key and model work before documents depend on them."""
    try:
        if provider == 'openai':
            r = openai.OpenAI(api_key=api_key, timeout=30).responses.create(model=model, input='Reply with: ok', max_output_tokens=16)
            return True, f'{model} replied: {(r.output_text or "").strip()[:80] or "(empty)"}'
        r = anthropic.Anthropic(api_key=api_key, timeout=30).messages.create(
            model=model, max_tokens=16, messages=[{'role': 'user', 'content': 'Reply with: ok'}])
        said = ''.join(b.text for b in r.content if b.type == 'text').strip()
        return True, f'{model} replied: {said[:80] or "(empty)"}'
    except Exception as e:
        return False, f'{type(e).__name__}: {e}'[:300]
