from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_user, visible_entities
from ..config import settings
from ..db import get_db
from ..mailer import configured as smtp_configured
from ..models import Import, Mailbox, SapConnection, SourceDocument, User
from ..serialize import import_out, ist, mailbox_out, sap_out

router = APIRouter(prefix='/api', tags=['integrations'])


@router.get('/integrations')
def integrations(u: User = Depends(current_user), db: Session = Depends(get_db)):
    ents = visible_entities(db, u)
    ids = [e.id for e in ents]
    mbs = db.scalars(select(Mailbox).where(Mailbox.entity_id.in_(ids), Mailbox.status != 'disconnected').order_by(Mailbox.entity_id, Mailbox.id)).all() if ids else []
    counts = dict(db.execute(select(SourceDocument.mailbox_id, func.count()).where(SourceDocument.mailbox_id.in_([m.id for m in mbs])).group_by(SourceDocument.mailbox_id)).all()) if mbs else {}
    saps = db.scalars(select(SapConnection).where(SapConnection.entity_id.in_(ids))).all() if ids else []
    last_imports = {}
    for i in db.scalars(select(Import).where(Import.entity_id.in_(ids), Import.status == 'done').order_by(Import.id.desc())) if ids else []:
        last_imports.setdefault((i.entity_id, i.kind), import_out(i))
    return {
        'entities': [{'id': e.id, 'name': e.short_name} for e in ents],
        'mailboxes': [mailbox_out(m, counts.get(m.id, 0)) for m in mbs],
        'oauth': {'gmail': bool(settings.google_client_id), 'outlook': bool(settings.ms_client_id)},
        'sap': [sap_out(c) for c in saps],
        'claude': {'configured': bool(settings.anthropic_api_key), 'model': settings.anthropic_model},
        'smtp': {'configured': smtp_configured(), 'from': settings.smtp_from if smtp_configured() else None},
        'imports': [{'entityId': e, 'kind': k, **v} for (e, k), v in last_imports.items()],
        'publicUrl': settings.public_url,
    }
