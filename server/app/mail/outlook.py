"""Microsoft Graph, read-only. Inbox delta query; the deltaLink is the cursor."""
import base64
from datetime import UTC, datetime, timedelta

import httpx

from ..config import settings
from .base import Attachment, FetchResult, Message, token_request

AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
GRAPH = 'https://graph.microsoft.com/v1.0'
SCOPES = 'offline_access User.Read Mail.Read'


def auth_params(redirect_uri: str, state: str, challenge: str) -> dict:
    return {'client_id': settings.ms_client_id, 'redirect_uri': redirect_uri, 'response_type': 'code', 'response_mode': 'query', 'scope': SCOPES,
            'state': state, 'prompt': 'select_account', 'code_challenge': challenge, 'code_challenge_method': 'S256'}


def exchange(code: str, redirect_uri: str, verifier: str) -> dict:
    return token_request(TOKEN_URL, {'code': code, 'client_id': settings.ms_client_id, 'client_secret': settings.ms_client_secret,
                                     'redirect_uri': redirect_uri, 'grant_type': 'authorization_code', 'scope': SCOPES, 'code_verifier': verifier})


def access_token(refresh_token: str) -> tuple[str, str | None]:
    t = token_request(TOKEN_URL, {'refresh_token': refresh_token, 'client_id': settings.ms_client_id,
                                  'client_secret': settings.ms_client_secret, 'grant_type': 'refresh_token', 'scope': SCOPES})
    return t['access_token'], t.get('refresh_token')


def me(c: httpx.Client) -> dict:
    r = c.get(f'{GRAPH}/me')
    r.raise_for_status()
    return r.json()


def _attachments(c: httpx.Client, mid: str) -> list[Attachment]:
    r = c.get(f'{GRAPH}/me/messages/{mid}/attachments')
    r.raise_for_status()
    out = []
    for a in r.json().get('value', []):
        if a.get('@odata.type') != '#microsoft.graph.fileAttachment':
            continue  # item / reference attachments carry no file
        if a.get('contentBytes'):
            data = base64.b64decode(a['contentBytes'])
        else:  # large files come without inline bytes
            rv = c.get(f"{GRAPH}/me/messages/{mid}/attachments/{a['id']}/$value")
            rv.raise_for_status()
            data = rv.content
        out.append(Attachment(id=a['id'], filename=a.get('name') or 'attachment', mime=a.get('contentType') or 'application/octet-stream',
                              data=data, inline=bool(a.get('isInline'))))
    return out


def fetch(refresh_token: str, cursor: str | None, backfill_days: int) -> FetchResult:
    access, rotated = access_token(refresh_token)
    with httpx.Client(headers={'Authorization': f'Bearer {access}', 'Prefer': 'odata.maxpagesize=50'}, timeout=60) as c:
        if cursor:
            url, params = cursor, None
        else:  # first sync: only mail from the backfill window, otherwise the whole inbox would be ingested
            since = (datetime.now(UTC) - timedelta(days=backfill_days)).strftime('%Y-%m-%dT%H:%M:%SZ')
            url = f'{GRAPH}/me/mailFolders/inbox/messages/delta'
            params = {'$select': 'id,subject,from,receivedDateTime,hasAttachments', '$filter': f'receivedDateTime ge {since}'}
        items = []
        while True:
            r = c.get(url, params=params)
            r.raise_for_status()
            j = r.json()
            items += [m for m in j.get('value', []) if '@removed' not in m]
            if '@odata.nextLink' in j:
                url, params = j['@odata.nextLink'], None
                continue
            new_cursor = j['@odata.deltaLink']
            break
        msgs = []
        for m in items:
            if not m.get('hasAttachments'):
                continue
            sender = ((m.get('from') or {}).get('emailAddress') or {}).get('address', '')
            received = datetime.fromisoformat(m['receivedDateTime'].replace('Z', '+00:00'))
            msgs.append(Message(id=m['id'], sender=sender, subject=m.get('subject') or '', received_at=received, attachments=_attachments(c, m['id'])))
        return FetchResult(msgs, new_cursor, rotated)
