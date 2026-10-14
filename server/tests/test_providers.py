"""Each provider SDK is driven against a mocked HTTP endpoint: checks the request we build and the parsing of the reply."""
import json

import anthropic
import httpx
import httpx2
import openai
import respx

from app.extract.providers import extract_anthropic, extract_gemini, extract_openai

OUT = {'doc_type': 'invoice', 'fields': {}, 'lines': []}
PDF = b'%PDF-1.4'


def mock_sdk(monkeypatch, module, cls: str, url: str, reply: dict) -> list:
    """anthropic and openai ship their own httpx fork (httpx2), which respx cannot see, so inject a mock transport."""
    calls = []

    def handler(req):
        assert str(req.url) == url
        calls.append(json.loads(req.content))
        return httpx2.Response(200, json=reply)
    real = getattr(module, cls)
    monkeypatch.setattr(module, cls, lambda **kw: real(http_client=httpx2.Client(transport=httpx2.MockTransport(handler)), **kw))
    return calls


def test_anthropic(monkeypatch):
    calls = mock_sdk(monkeypatch, anthropic, 'Anthropic', 'https://api.anthropic.com/v1/messages', {
        'id': 'msg_1', 'type': 'message', 'role': 'assistant', 'model': 'claude-sonnet-5-5', 'stop_reason': 'end_turn',
        'content': [{'type': 'text', 'text': json.dumps(OUT)}], 'usage': {'input_tokens': 1200, 'output_tokens': 300}})
    r = extract_anthropic('k', 'claude-sonnet-5-5', PDF, 'application/pdf', 'a.pdf')
    body = calls[0]
    assert body['output_config']['format']['type'] == 'json_schema'
    assert body['messages'][0]['content'][0]['type'] == 'document'
    assert r.raw == OUT and (r.input_tokens, r.output_tokens) == (1200, 300)


def test_openai(monkeypatch):
    calls = mock_sdk(monkeypatch, openai, 'OpenAI', 'https://api.openai.com/v1/responses', {
        'id': 'resp_1', 'object': 'response', 'created_at': 0, 'model': 'm', 'status': 'completed', 'parallel_tool_calls': False, 'tool_choice': 'auto', 'tools': [],
        'output': [{'type': 'message', 'id': 'o1', 'role': 'assistant', 'status': 'completed', 'content': [{'type': 'output_text', 'text': json.dumps(OUT), 'annotations': []}]}],
        'usage': {'input_tokens': 900, 'output_tokens': 200, 'total_tokens': 1100, 'input_tokens_details': {'cached_tokens': 0}, 'output_tokens_details': {'reasoning_tokens': 0}}})
    r = extract_openai('k', 'some-model', PDF, 'application/pdf', 'a.pdf')
    body = calls[0]
    assert body['text']['format']['strict'] is True and body['input'][0]['content'][0]['type'] == 'input_file'
    assert r.raw == OUT and r.input_tokens == 900


@respx.mock
def test_gemini():
    route = respx.post(url__regex=r'https://generativelanguage\.googleapis\.com/.*/models/gem-model:generateContent').mock(return_value=httpx.Response(200, json={
        'candidates': [{'content': {'role': 'model', 'parts': [{'text': json.dumps(OUT)}]}, 'finishReason': 'STOP'}],
        'usageMetadata': {'promptTokenCount': 700, 'candidatesTokenCount': 150}}))
    r = extract_gemini('k', 'gem-model', PDF, 'application/pdf', 'a.pdf')
    body = json.loads(route.calls[0].request.content)
    assert body['generationConfig']['responseMimeType'] == 'application/json' and 'responseJsonSchema' in body['generationConfig']
    assert r.raw == OUT and (r.input_tokens, r.output_tokens) == (700, 150)
