from sqlalchemy.orm import Session

from .models import Notification


def notify(db: Session, entity_id: str | None, title: str, body: str, route: str = '/', tone: str = 'none', user_id: int | None = None) -> None:
    db.add(Notification(entity_id=entity_id, user_id=user_id, title=title[:200], body=body[:500], route=route[:200], tone=tone, read_by=[]))
