import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import settings
from .routers import ai, audit, entities, intake, mailboxes, oauth

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = []
    if settings.run_background:
        from .worker import job_loop, mail_loop
        tasks = [asyncio.create_task(mail_loop()), asyncio.create_task(job_loop())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title='Pravah Finance Control API', lifespan=lifespan)
for r in (entities, mailboxes, oauth, intake, ai, audit):
    app.include_router(r.router)


@app.get('/api/health')
def health():
    return {'ok': True, 'gmail': bool(settings.google_client_id), 'outlook': bool(settings.ms_client_id)}
