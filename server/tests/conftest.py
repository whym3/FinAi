import base64
import os

import pytest

# Tests run against their own database (<dev db>_test), migrated once per run, so they never touch dev data.
_base = os.environ.get('DATABASE_URL', 'postgresql+psycopg://pravah:pravah@localhost:5432/pravah')
TEST_DB_URL = _base.rsplit('/', 1)[0] + '/' + _base.rsplit('/', 1)[1] + '_test'
os.environ['DATABASE_URL'] = TEST_DB_URL
os.environ.setdefault('APP_SECRET_KEY', base64.b64encode(b'k' * 32).decode())
os.environ['RUN_BACKGROUND'] = 'false'
os.environ['ANTHROPIC_API_KEY'] = ''


@pytest.fixture(scope='session', autouse=True)
def _test_database():
    from sqlalchemy import create_engine, text
    from sqlalchemy.exc import OperationalError
    admin_url, name = TEST_DB_URL.rsplit('/', 1)
    try:
        eng = create_engine(admin_url + '/postgres', isolation_level='AUTOCOMMIT')
        with eng.connect() as c:
            c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
            c.execute(text(f'CREATE DATABASE "{name}"'))
        eng.dispose()
    except OperationalError:
        yield  # Postgres not running: DB-backed tests skip themselves
        return
    from alembic import command
    from alembic.config import Config
    cfg = Config(os.path.join(os.path.dirname(__file__), '..', 'alembic.ini'))
    cfg.set_main_option('script_location', os.path.join(os.path.dirname(__file__), '..', 'alembic'))
    command.upgrade(cfg, 'head')
    yield


@pytest.fixture
def db():
    """A session inside a transaction that is always rolled back. Skips when Postgres is not running."""
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import Session

    from app.db import engine
    try:
        conn = engine.connect()
    except OperationalError:
        pytest.skip('Postgres not running (docker compose up -d db)')
    tx = conn.begin()
    s = Session(bind=conn, join_transaction_mode='create_savepoint')
    yield s
    s.close()
    tx.rollback()
    conn.close()


@pytest.fixture
def firm(db):
    """A firm with one client (Apollo Pipes) and an admin user; returns (firm, entity, admin)."""
    from app.auth import hash_password
    from app.models import Entity, Firm, GstRegistration, User, UserEntity
    f = Firm(name='Mehta & Rao Chartered Accountants', short_name='Mehta & Rao')
    db.add(f)
    db.flush()
    e = Entity(id='apollo', firm_id=f.id, legal_name='Apollo Pipes Limited', short_name='Apollo Pipes', city='Noida', pan='AAACA1199D', status='active',
               gstins=[GstRegistration(gstin='09AAACA1199D1ZW', state_code='09', state='Uttar Pradesh', place_of_business='Dadri')])
    db.add(e)
    admin = User(firm_id=f.id, email='admin@mehtarao.in', name='Kiran Mehta', title='Partner', password_hash=hash_password('correct horse battery'), is_admin=True, status='active', mfa_enabled=False)
    db.add(admin)
    db.flush()
    ap = User(firm_id=f.id, email='ap@apollo.in', name='Rohan Kulkarni', title='AP executive', password_hash=hash_password('correct horse battery'), status='active')
    db.add(ap)
    db.flush()
    db.add(UserEntity(user_id=ap.id, entity_id=e.id, role='ap', approval_limit=500000))
    db.flush()
    return f, e, admin


@pytest.fixture
def client(db):
    from fastapi.testclient import TestClient

    from app.db import get_db
    from app.main import app
    app.dependency_overrides[get_db] = lambda: db
    c = TestClient(app, headers={'X-Pravah': '1'})
    yield c
    app.dependency_overrides.clear()
