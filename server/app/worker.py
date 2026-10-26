"""Background loops inside the API process: mailbox polling and the extraction job queue.
shortcut: polling every POLL_SECONDS; switch to Gmail watch + Pub/Sub and Graph change notifications once deployed on a public URL,
and move these loops to their own process when there is more than one API replica."""
import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from .config import settings
from .db import SessionLocal
from .extract.run import process_document
from .mail.ingest import sync_mailbox
from .models import Job, Mailbox

log = logging.getLogger('pravah.worker')
MAX_ATTEMPTS = 3


def poll_mailboxes() -> None:
    with SessionLocal() as db:
        ids = db.scalars(select(Mailbox.id).where(Mailbox.status.in_(('active', 'error')), Mailbox.enc_refresh_token.is_not(None))).all()
    for mid in ids:
        with SessionLocal() as db:
            mb = db.get(Mailbox, mid)
            if mb.status == 'error' and mb.last_error and 'Reconnect' in mb.last_error:
                continue  # needs a person to reconnect
            n = sync_mailbox(db, mb)
            if n:
                log.info('mailbox %s: %d new document(s)', mb.address, n)


def run_one_job() -> bool:
    """Claim and run one due job. Returns False when the queue is empty."""
    with SessionLocal() as db:
        job = db.scalars(select(Job).where(Job.done_at.is_(None), Job.attempts < MAX_ATTEMPTS, Job.run_after <= text('now()'))
                         .order_by(Job.id).limit(1).with_for_update(skip_locked=True)).first()
        if not job:
            return False
        job.attempts += 1
        try:
            if job.kind == 'process':
                process_document(db, job.payload['document_id'])
            elif job.kind == 'import':
                from .imports.run import run_import
                run_import(db, job.payload['import_id'])
            elif job.kind == 'sap_sync':
                from .sap.sync import sync_connection
                sync_connection(db, job.payload['connection_id'])
            elif job.kind == 'verify':
                from .domain.verify import run_for_invoice
                run_for_invoice(db, job.payload['invoice_id'])
            elif job.kind == 'verify_poll':
                from .domain.verify import poll
                poll(db, job.payload['verification_id'])
            job.done_at = datetime.now(UTC)
        except Exception as e:
            db.rollback()
            job.last_error = f'{type(e).__name__}: {e}'[:2000]
            job.run_after = datetime.now(UTC) + timedelta(minutes=2 ** job.attempts)
            log.warning('job %s failed: %s', job.id, job.last_error)
        db.commit()
        return True


def schedule_sap() -> None:
    """Queue a sync for every active SAP connection whose schedule is due."""
    from .models import SapConnection
    with SessionLocal() as db:
        for c in db.scalars(select(SapConnection).where(SapConnection.status == 'active')):
            due = not c.last_sync_at or c.last_sync_at < datetime.now(UTC) - timedelta(minutes=c.schedule_minutes)
            pending = db.scalar(select(Job.id).where(Job.kind == 'sap_sync', Job.done_at.is_(None), Job.payload['connection_id'].as_integer() == c.id))
            if due and not pending:
                db.add(Job(kind='sap_sync', payload={'connection_id': c.id}))
        db.commit()


async def mail_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(poll_mailboxes)
            await asyncio.to_thread(schedule_sap)
        except Exception:
            log.exception('mailbox poll failed')
        await asyncio.sleep(settings.poll_seconds)


async def job_loop() -> None:
    while True:
        try:
            busy = await asyncio.to_thread(run_one_job)
        except Exception:
            log.exception('job loop failed')
            busy = False
        if not busy:
            await asyncio.sleep(3)
