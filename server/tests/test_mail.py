import base64
import io
import json
import zipfile
from datetime import UTC, datetime

import httpx
import respx

from app.mail import gmail, outlook
from app.mail.base import Attachment, Message
from app.mail.ingest import expand, ingest, sender_allowed
from app.models import Job, Mailbox, SourceDocument

PDF = b'%PDF-1.4 fake invoice'


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


@respx.mock
def test_gmail_first_sync_then_history():
    respx.post(gmail.TOKEN_URL).mock(return_value=httpx.Response(200, json={'access_token': 'at'}))
    respx.get(f'{gmail.API}/profile').mock(return_value=httpx.Response(200, json={'emailAddress': 'ap@x.in', 'historyId': '100'}))
    respx.get(f'{gmail.API}/messages').mock(return_value=httpx.Response(200, json={'messages': [{'id': 'm1'}]}))
    msg = {'id': 'm1', 'internalDate': '1791000000000', 'payload': {'headers': [{'name': 'From', 'value': 'Sahyadri <bills@sahyadri.in>'}, {'name': 'Subject', 'value': 'Invoice 0418'}],
           'parts': [{'mimeType': 'text/plain', 'body': {'data': b64u(b'hi')}},
                     {'partId': '1', 'filename': 'SPK-0418.pdf', 'mimeType': 'application/pdf', 'body': {'attachmentId': 'a1'}, 'headers': []}]}}
    respx.get(f'{gmail.API}/messages/m1').mock(return_value=httpx.Response(200, json=msg))
    respx.get(f'{gmail.API}/messages/m1/attachments/a1').mock(return_value=httpx.Response(200, json={'data': b64u(PDF)}))
    r = gmail.fetch('rt', None, 7)
    assert r.cursor == '100' and len(r.messages) == 1
    m = r.messages[0]
    assert m.sender == 'bills@sahyadri.in' and m.subject == 'Invoice 0418' and m.attachments[0].data == PDF

    respx.get(f'{gmail.API}/history').mock(return_value=httpx.Response(200, json={'historyId': '120', 'history': [{'messagesAdded': [{'message': {'id': 'm1'}}]}]}))
    r2 = gmail.fetch('rt', '100', 7)
    assert r2.cursor == '120' and [m.id for m in r2.messages] == ['m1']


@respx.mock
def test_gmail_expired_history_falls_back_to_query():
    respx.post(gmail.TOKEN_URL).mock(return_value=httpx.Response(200, json={'access_token': 'at'}))
    respx.get(f'{gmail.API}/history').mock(return_value=httpx.Response(404, json={}))
    respx.get(f'{gmail.API}/profile').mock(return_value=httpx.Response(200, json={'historyId': '999'}))
    q = respx.get(f'{gmail.API}/messages').mock(return_value=httpx.Response(200, json={}))
    r = gmail.fetch('rt', '5', 7)
    assert r.cursor == '999' and 'newer_than%3A2d' in str(q.calls[0].request.url)


@respx.mock
def test_outlook_delta_with_pages_and_large_attachment():
    respx.post(outlook.TOKEN_URL).mock(return_value=httpx.Response(200, json={'access_token': 'at', 'refresh_token': 'rt2'}))
    respx.get(f'{outlook.GRAPH}/me/mailFolders/inbox/messages/delta').mock(return_value=httpx.Response(200, json={
        'value': [{'id': 'o1', 'subject': 'Bill', 'from': {'emailAddress': {'address': 'a@deccan.in'}}, 'receivedDateTime': '2026-10-14T05:00:00Z', 'hasAttachments': True}],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next'}))
    respx.get('https://graph.microsoft.com/v1.0/next').mock(return_value=httpx.Response(200, json={
        'value': [{'id': 'o2', 'hasAttachments': False, 'receivedDateTime': '2026-10-14T05:00:00Z'}, {'id': 'gone', '@removed': {}}],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=abc'}))
    respx.get(f'{outlook.GRAPH}/me/messages/o1/attachments').mock(return_value=httpx.Response(200, json={'value': [
        {'@odata.type': '#microsoft.graph.fileAttachment', 'id': 'x1', 'name': 'inv.pdf', 'contentType': 'application/pdf', 'contentBytes': base64.b64encode(PDF).decode()},
        {'@odata.type': '#microsoft.graph.fileAttachment', 'id': 'x2', 'name': 'big.pdf', 'contentType': 'application/pdf'},
        {'@odata.type': '#microsoft.graph.itemAttachment', 'id': 'x3', 'name': 'fwd'}]}))
    respx.get(f'{outlook.GRAPH}/me/messages/o1/attachments/x2/$value').mock(return_value=httpx.Response(200, content=b'%PDF big'))
    r = outlook.fetch('rt', None, 7)
    assert r.cursor.endswith('token=abc') and r.refresh_token == 'rt2'
    assert [m.id for m in r.messages] == ['o1'] and [a.data for a in r.messages[0].attachments] == [PDF, b'%PDF big']


def test_expand_filters_and_unzips():
    z = io.BytesIO()
    with zipfile.ZipFile(z, 'w') as f:
        f.writestr('a/inv.pdf', PDF)
        f.writestr('notes.docx', b'x')
        f.writestr('__MACOSX/._inv.pdf', b'x')
    got = expand(Attachment('z', 'bundle.zip', 'application/zip', z.getvalue()))
    assert [(g[1], g[2]) for g in got] == [('inv.pdf', 'application/pdf')]
    assert expand(Attachment('s', 'logo.png', 'image/png', b'x' * 100, inline=True)) == []
    assert expand(Attachment('d', 'terms.docx', 'application/msword', b'x')) == []
    assert expand(Attachment('e', 'einv.json', 'application/octet-stream', b'{}'))[0][2] == 'application/json'


def test_sender_rules():
    assert sender_allowed('a@deccan.in', [], [])
    assert not sender_allowed('a@spam.com', [], ['spam.com'])
    assert sender_allowed('a@deccan.in', ['deccan.in'], []) and not sender_allowed('a@other.in', ['deccan.in'], [])


def test_ingest_dedupes_and_queues(db, firm, tmp_path, monkeypatch):
    monkeypatch.setattr('app.mail.ingest.settings.storage_dir', str(tmp_path))
    mb = Mailbox(entity_id='apollo', provider='gmail', address='test-ingest@x.in', sender_allow=[], sender_block=[])
    db.add(mb)
    db.flush()
    att = Attachment('a1', 'SPK-0418.pdf', 'application/pdf', PDF)
    msg = Message('m1', 'bills@sahyadri.in', 'Invoice', datetime.now(UTC), [att])
    assert ingest(db, mb, [msg]) == 1
    assert ingest(db, mb, [msg]) == 0  # same message on a later sync
    copy = Message('m2', 'bills@sahyadri.in', 'Fwd: Invoice', datetime.now(UTC), [att])  # same file, another email
    assert ingest(db, mb, [copy]) == 1
    docs = db.query(SourceDocument).filter_by(mailbox_id=mb.id).order_by(SourceDocument.id).all()
    assert [d.status for d in docs] == ['new', 'duplicate'] and docs[1].duplicate_of == docs[0].id
    assert (tmp_path / 'apollo' / docs[0].sha256).read_bytes() == PDF
    jobs = db.query(Job).filter(Job.kind == 'process', Job.payload['document_id'].as_integer().in_([d.id for d in docs])).all()
    assert len(jobs) == 1  # duplicates are not extracted again


def test_audit_log_is_append_only(db):
    import pytest
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    db.execute(text("INSERT INTO audit_log (action, target, detail) VALUES ('t', '', '')"))
    with pytest.raises(DBAPIError, match='append-only'):
        with db.begin_nested():
            db.execute(text("UPDATE audit_log SET action = 'changed'"))
