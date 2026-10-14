"""All calls to Claude. One key per deployment (ANTHROPIC_API_KEY); nothing is configured in the UI."""
import base64
import json
from dataclasses import dataclass

import anthropic

from ..config import settings
from .schemas import CLASSIFY_PROMPT, CLASSIFY_SCHEMA, prompt_for, schema_for

ASK = 'Extract this document.'
TEXT_MIMES = ('application/xml', 'application/json')
IMAGE_MIMES = ('image/png', 'image/jpeg', 'image/webp', 'image/gif')


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


def configured() -> bool:
    return bool(settings.anthropic_api_key)


def _client() -> anthropic.Anthropic:
    if not configured():
        raise NotConfigured('Claude is not configured on the server (ANTHROPIC_API_KEY)')
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _part(data: bytes, mime: str, filename: str) -> dict:
    if mime == 'application/pdf':
        return {'type': 'document', 'source': {'type': 'base64', 'media_type': mime, 'data': base64.b64encode(data).decode()}}
    if mime in IMAGE_MIMES:
        return {'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': base64.b64encode(data).decode()}}
    if mime in TEXT_MIMES:
        return {'type': 'text', 'text': f'File {filename}:\n' + data.decode('utf-8', errors='replace')[:200_000]}
    raise Unsupported(f'{mime} cannot be read; convert it to PDF or an image')


def _call(system: str, part: dict, schema: dict, max_tokens: int = 8000) -> Result:
    r = _client().messages.create(
        model=settings.anthropic_model, max_tokens=max_tokens, system=system,
        messages=[{'role': 'user', 'content': [part, {'type': 'text', 'text': ASK}]}],
        output_config={'format': {'type': 'json_schema', 'schema': schema}})
    text = next(b.text for b in r.content if b.type == 'text')
    return Result(json.loads(text), r.usage.input_tokens, r.usage.output_tokens, settings.anthropic_model)


def classify(data: bytes, mime: str, filename: str) -> Result:
    """Which documents are in the file and on which pages."""
    return _call(CLASSIFY_PROMPT, _part(data, mime, filename), CLASSIFY_SCHEMA, max_tokens=4000)


def extract(kind: str, data: bytes, mime: str, filename: str) -> Result:
    return _call(prompt_for(kind), _part(data, mime, filename), schema_for(kind))
