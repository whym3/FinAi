from dataclasses import dataclass, field
from datetime import datetime

import httpx


@dataclass
class Attachment:
    id: str
    filename: str
    mime: str
    data: bytes
    inline: bool = False


@dataclass
class Message:
    id: str
    sender: str
    subject: str
    received_at: datetime
    attachments: list[Attachment] = field(default_factory=list)


@dataclass
class FetchResult:
    messages: list[Message]
    cursor: str
    refresh_token: str | None = None  # set when the provider rotated it


class AuthError(Exception):
    """The mailbox's refresh token no longer works; the user must reconnect."""


def token_request(url: str, data: dict) -> dict:
    r = httpx.post(url, data=data, timeout=30)
    if r.status_code in (400, 401):
        raise AuthError(r.json().get('error_description') or r.json().get('error') or r.text)
    r.raise_for_status()
    return r.json()
