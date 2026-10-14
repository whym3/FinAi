import pyotp

from app import crypto
from app.models import User


def _totp(db, email):
    u = db.query(User).filter_by(email=email).one()
    return pyotp.TOTP(crypto.decrypt(u.totp_secret_enc)).now()


def test_setup_login_mfa_flow(client, db):
    assert client.get('/api/auth/status').json()['needsSetup'] is True
    r = client.post('/api/auth/setup', json={'firm_name': 'Mehta & Rao', 'firm_short': 'M&R', 'name': 'Kiran', 'email': 'k@m.in', 'password': 'correct horse battery'})
    assert r.status_code == 200 and r.json()['next'] == 'mfa_enrol'
    assert client.get('/api/auth/me').status_code == 401  # MFA not done
    enrol = client.post('/api/auth/mfa/enrol').json()
    assert enrol['otpauth'].startswith('otpauth://totp/')
    assert client.post('/api/auth/mfa/confirm', json={'code': '000000'}).status_code == 422
    r = client.post('/api/auth/mfa/confirm', json={'code': pyotp.TOTP(enrol['secret']).now()})
    assert r.status_code == 200 and r.json()['user']['email'] == 'k@m.in' and r.json()['user']['isAdmin']
    assert client.get('/api/auth/me').status_code == 200
    # second setup refused, then sign out and back in with MFA
    assert client.post('/api/auth/setup', json={'firm_name': 'XX', 'firm_short': 'XX', 'name': 'YY', 'email': 'y@m.in', 'password': 'correct horse battery'}).status_code == 409
    client.post('/api/auth/logout')
    assert client.get('/api/auth/me').status_code == 401
    assert client.post('/api/auth/login', json={'email': 'k@m.in', 'password': 'wrong password here'}).status_code == 401
    r = client.post('/api/auth/login', json={'email': 'k@m.in', 'password': 'correct horse battery'})
    assert r.json()['next'] == 'mfa_verify'
    u = db.query(User).filter_by(email='k@m.in').one()
    u.totp_last_counter -= 1  # pretend the enrolment code was a window ago, so the same-window code is fresh
    db.flush()
    code = _totp(db, 'k@m.in')
    assert client.post('/api/auth/mfa/verify', json={'code': code}).status_code == 200
    # replay of the same code is refused
    client.post('/api/auth/login', json={'email': 'k@m.in', 'password': 'correct horse battery'})
    assert client.post('/api/auth/mfa/verify', json={'code': code}).status_code == 422


def test_csrf_header_required(client, firm):
    r = client.post('/api/auth/login', json={'email': 'admin@mehtarao.in', 'password': 'correct horse battery'}, headers={'X-Pravah': ''})
    assert r.status_code == 403


def test_lockout_after_failed_logins(client, firm):
    for _ in range(5):
        assert client.post('/api/auth/login', json={'email': 'admin@mehtarao.in', 'password': 'nope nope nope nope'}).status_code == 401
    assert client.post('/api/auth/login', json={'email': 'admin@mehtarao.in', 'password': 'correct horse battery'}).status_code == 429


def test_weak_password_rejected(client):
    r = client.post('/api/auth/setup', json={'firm_name': 'A', 'firm_short': 'A', 'name': 'B', 'email': 'b@m.in', 'password': 'short'})
    assert r.status_code == 422


def test_invite_and_roles(client, db, firm):
    f, e, admin = firm
    # admin signs in (enrol MFA on the fly)
    client.post('/api/auth/login', json={'email': 'admin@mehtarao.in', 'password': 'correct horse battery'})
    secret = client.post('/api/auth/mfa/enrol').json()['secret']
    client.post('/api/auth/mfa/confirm', json={'code': pyotp.TOTP(secret).now()})
    r = client.post('/api/users/invite', json={'email': 'cfo@apollo.in', 'name': 'Arvind Nair', 'title': 'CFO', 'assignments': [{'entity_id': 'apollo', 'role': 'cfo', 'approval_limit': 1e9}]})
    assert r.status_code == 201 and r.json()['link'].startswith('http')  # SMTP not configured → link returned
    token = r.json()['link'].rsplit('/', 1)[1]
    client.post('/api/auth/logout')
    assert client.get(f'/api/auth/invite/{token}').json()['email'] == 'cfo@apollo.in'
    r = client.post('/api/auth/invite/accept', json={'token': token, 'name': 'Arvind Nair', 'password': 'another good password'})
    assert r.json()['next'] == 'mfa_enrol'
    secret = client.post('/api/auth/mfa/enrol').json()['secret']
    me = client.post('/api/auth/mfa/confirm', json={'code': pyotp.TOTP(secret).now()}).json()
    assert me['access']['apollo'] == {'role': 'cfo', 'approvalLimit': 1e9}
    assert [x['id'] for x in me['entities']] == ['apollo']
    # a CFO cannot invite users
    assert client.post('/api/users/invite', json={'email': 'x@y.in', 'name': 'X Y'}).status_code == 403


def test_enrol_is_idempotent_until_confirmed(client):
    client.post('/api/auth/setup', json={'firm_name': 'Mehta & Rao', 'firm_short': 'M&R', 'name': 'Kiran', 'email': 'k2@m.in', 'password': 'correct horse battery'})
    a = client.post('/api/auth/mfa/enrol').json()
    b = client.post('/api/auth/mfa/enrol').json()
    assert a['secret'] == b['secret']
    assert client.post('/api/auth/mfa/confirm', json={'code': pyotp.TOTP(a['secret']).now()}).status_code == 200
