"""Invoice preflight creates no records and only suggests bill-to client details."""
import asyncio
from io import BytesIO

from fastapi import UploadFile

from app.extract import ai
from app.routers.intake import suggest_client


def test_suggest_client_uses_latest_ai_config_and_bill_to(db, firm, monkeypatch):
    _, _, admin = firm
    monkeypatch.setattr(ai, 'config', lambda _: ai.Config('openai', 'gpt-4.1', 'test-key'))
    monkeypatch.setattr(ai, 'classify', lambda *_: ai.Result({'documents': [{'kind': 'invoice', 'page_from': 1}]}, 0, 0, 'gpt-4.1'))
    monkeypatch.setattr(ai, 'extract', lambda *_: ai.Result({
        'billToName': {'value': 'Apollo Pipes Limited'},
        'billTo': {'value': '09AAACA1199D1ZW'},
        'supplier': {'value': 'Akshay Plastic Industries'},
    }, 0, 0, 'gpt-4.1'))
    upload = UploadFile(file=BytesIO(b'image'), filename='invoice.png', headers={'content-type': 'image/png'})
    result = asyncio.run(suggest_client([upload], admin, db))
    assert result['legal_name'] == 'Apollo Pipes Limited'
    assert result['gstin'] == '09AAACA1199D1ZW'
    assert result['pan'] == 'AAACA1199D'
