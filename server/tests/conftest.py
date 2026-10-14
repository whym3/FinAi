import base64
import os

import pytest

os.environ.setdefault('APP_SECRET_KEY', base64.b64encode(b'k' * 32).decode())
os.environ['RUN_BACKGROUND'] = 'false'


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
