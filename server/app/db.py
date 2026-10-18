from collections.abc import Iterator

from sqlalchemy import String, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


@event.listens_for(Session, 'before_flush')
def _clamp_strings(session: Session, _ctx, _instances) -> None:
    """Documents are read by a model, and a misread field is just a long string: an address where a
    GSTIN belongs, a sentence where a code belongs. Postgres answers that with StringDataRightTruncation,
    which kills the whole reading job and leaves the document unreadable. Trim to what the column holds
    instead; the value is unconfirmed until a person checks it anyway."""
    for obj in list(session.new) + list(session.dirty):
        mapper = getattr(type(obj), '__mapper__', None)
        if mapper is None:
            continue
        for col in mapper.columns:
            limit = getattr(col.type, 'length', None) if isinstance(col.type, String) else None
            if not limit:
                continue
            attr = mapper.get_property_by_column(col).key
            val = getattr(obj, attr, None)
            if isinstance(val, str) and len(val) > limit:
                setattr(obj, attr, val[:limit])


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db
