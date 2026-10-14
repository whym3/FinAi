from email.message import EmailMessage

from app.mail import imap

PDF = b'%PDF-1.4 fake invoice'


def raw(subject: str) -> bytes:
    m = EmailMessage()
    m['From'], m['Subject'], m['Date'] = 'Akshay Plastics <accounts@akshay.in>', subject, 'Tue, 13 Oct 2026 10:00:00 +0530'
    m.set_content('Please find attached.')
    m.add_attachment(PDF, maintype='application', subtype='pdf', filename='API-3166.pdf')
    return m.as_bytes()


class FakeImap:
    mails = {5: raw('Invoice 3165'), 7: raw('Invoice 3166')}

    def __init__(self, *a, **k): pass
    def login(self, user, pw): pass
    def select(self, box, readonly=False):
        assert readonly
        return 'OK', [b'2']
    def status(self, box, what): return 'OK', [b'INBOX (UIDVALIDITY 42 UIDNEXT 8)']
    def logout(self): pass

    def uid(self, cmd, *args):
        if cmd == 'search':
            q = args[-1]
            lo = int(q.split()[1].split(':')[0]) if q.startswith('UID') else 0
            # like real servers, "UID n:*" returns the last message even when n is past it
            return 'OK', [' '.join(str(u) for u in self.mails if u >= lo or u == max(self.mails)).encode()]
        assert args[1] == '(BODY.PEEK[])'  # never marks mail as read
        return 'OK', [(b'7 (UID 7 BODY[] {1}', self.mails[int(args[0])]), b')']


def test_imap_backfill_then_incremental(monkeypatch):
    monkeypatch.setattr(imap.imaplib, 'IMAP4_SSL', FakeImap)
    s = '{"host": "imap.example.in", "port": 993, "user": "ap@x.in", "password": "p"}'
    r = imap.fetch(s, None, 7)
    assert r.cursor == '42:7' and [m.subject for m in r.messages] == ['Invoice 3165', 'Invoice 3166']
    m = r.messages[1]
    assert m.sender == 'accounts@akshay.in' and m.attachments[0].filename == 'API-3166.pdf' and m.attachments[0].data == PDF
    assert imap.fetch(s, '42:7', 7).messages == []  # nothing new
    assert [m.id for m in imap.fetch(s, '42:5', 7).messages] == ['7']
    assert imap.fetch(s, None, 0).cursor == '42:7' and imap.fetch(s, None, 0).messages == []  # new mail only
    assert len(imap.fetch(s, '41:7', 7).messages) == 2  # UIDVALIDITY changed: re-scan by date, dedupe stops repeats
