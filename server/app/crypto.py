import base64
import hashlib
import hmac
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings


def _key() -> bytes:
    if not settings.app_secret_key:
        raise RuntimeError('APP_SECRET_KEY is not set. Generate one with: python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"')
    k = base64.b64decode(settings.app_secret_key)
    if len(k) != 32:
        raise RuntimeError('APP_SECRET_KEY must be base64 of exactly 32 bytes')
    return k


def encrypt(plain: str) -> str:
    nonce = os.urandom(12)
    return base64.b64encode(nonce + AESGCM(_key()).encrypt(nonce, plain.encode(), None)).decode()


def decrypt(token: str) -> str:
    raw = base64.b64decode(token)
    return AESGCM(_key()).decrypt(raw[:12], raw[12:], None).decode()


def sign(data: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(data, separators=(',', ':')).encode()).decode().rstrip('=')
    mac = hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()
    return f'{body}.{mac}'


def unsign(token: str) -> dict:
    body, _, mac = token.rpartition('.')
    if not body or not hmac.compare_digest(mac, hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()):
        raise ValueError('bad signature')
    return json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
