"""OpenAI, Anthropic and Gemini behind one call. Models are chosen in Settings from each provider's live model list."""
import base64
import json
from dataclasses import dataclass

from .schema import PROMPT, SCHEMA

PROVIDERS = ('anthropic', 'openai', 'gemini')
DEFAULT_MODELS = {'anthropic': 'claude-sonnet-5-5'}  # OpenAI and Gemini: picked from the live list in Settings
ASK = 'Extract this document.'
TEXT_MIMES = ('application/xml', 'application/json')


@dataclass
class Result:
    raw: dict
    input_tokens: int
    output_tokens: int


class Unsupported(Exception):
    pass


def _text(data: bytes) -> str:
    return data.decode('utf-8', errors='replace')[:200_000]


def extract_anthropic(key: str, model: str, data: bytes, mime: str, filename: str) -> Result:
    import anthropic
    b64 = base64.b64encode(data).decode()
    if mime == 'application/pdf':
        part = {'type': 'document', 'source': {'type': 'base64', 'media_type': mime, 'data': b64}}
    elif mime in ('image/png', 'image/jpeg', 'image/webp'):
        part = {'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': b64}}
    elif mime in TEXT_MIMES:
        part = {'type': 'text', 'text': f'File {filename}:\n{_text(data)}'}
    else:
        raise Unsupported(f'{mime} is not supported by Claude; convert it to PDF')
    r = anthropic.Anthropic(api_key=key).messages.create(
        model=model, max_tokens=8000, system=PROMPT, messages=[{'role': 'user', 'content': [part, {'type': 'text', 'text': ASK}]}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}})
    text = next(b.text for b in r.content if b.type == 'text')
    return Result(json.loads(text), r.usage.input_tokens, r.usage.output_tokens)


def extract_openai(key: str, model: str, data: bytes, mime: str, filename: str) -> Result:
    import openai
    b64 = base64.b64encode(data).decode()
    if mime == 'application/pdf':
        part = {'type': 'input_file', 'filename': filename, 'file_data': f'data:{mime};base64,{b64}'}
    elif mime in ('image/png', 'image/jpeg', 'image/webp'):
        part = {'type': 'input_image', 'image_url': f'data:{mime};base64,{b64}'}
    elif mime in TEXT_MIMES:
        part = {'type': 'input_text', 'text': f'File {filename}:\n{_text(data)}'}
    else:
        raise Unsupported(f'{mime} is not supported by OpenAI; convert it to PDF')
    r = openai.OpenAI(api_key=key).responses.create(
        model=model, instructions=PROMPT, input=[{'role': 'user', 'content': [part, {'type': 'input_text', 'text': ASK}]}],
        text={'format': {'type': 'json_schema', 'name': 'document', 'schema': SCHEMA, 'strict': True}})
    return Result(json.loads(r.output_text), r.usage.input_tokens, r.usage.output_tokens)


def extract_gemini(key: str, model: str, data: bytes, mime: str, filename: str) -> Result:
    from google import genai
    from google.genai import types
    if mime in TEXT_MIMES:
        part = f'File {filename}:\n{_text(data)}'
    elif mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'):
        part = types.Part.from_bytes(data=data, mime_type=mime)
    else:
        raise Unsupported(f'{mime} is not supported by Gemini; convert it to PDF')
    client = genai.Client(api_key=key)  # keep a reference: the client closes its HTTP pool when garbage-collected
    r = client.models.generate_content(
        model=model, contents=[part, ASK],
        config=types.GenerateContentConfig(system_instruction=PROMPT, response_mime_type='application/json', response_json_schema=SCHEMA))
    u = r.usage_metadata
    return Result(json.loads(r.text), (u.prompt_token_count or 0) if u else 0, (u.candidates_token_count or 0) if u else 0)


EXTRACT = {'anthropic': extract_anthropic, 'openai': extract_openai, 'gemini': extract_gemini}


def list_models(provider: str, key: str) -> list[str]:
    """Live model ids for the key; doubles as the key test."""
    if provider == 'anthropic':
        import anthropic
        return [m.id for m in anthropic.Anthropic(api_key=key).models.list(limit=100)]
    if provider == 'openai':
        import openai
        return sorted(m.id for m in openai.OpenAI(api_key=key).models.list())
    from google import genai
    client = genai.Client(api_key=key)
    return sorted(m.name.removeprefix('models/') for m in client.models.list() if 'generateContent' in (m.supported_actions or []))
