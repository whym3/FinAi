"""Background loops inside the API process: mailbox polling and the extraction job queue.
shortcut: polling every POLL_SECONDS; switch to Gmail watch + Pub/Sub and Graph change notifications once deployed on a public URL,
and move these loops to their own process when there is more than one API replica."""
import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from .config import settings
from .db import SessionLocal
from .extract.run import extract_document
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
            if job.kind == 'extract':
                extract_document(db, job.payload['document_id'])
            job.done_at = datetime.now(UTC)
        except Exception as e:
            db.rollback()
            job.last_error = f'{type(e).__name__}: {e}'[:2000]
            job.run_after = datetime.now(UTC) + timedelta(minutes=2 ** job.attempts)
            log.warning('job %s failed: %s', job.id, job.last_error)
        db.commit()
        return True


async def mail_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(poll_mailboxes)
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
