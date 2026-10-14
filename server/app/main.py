import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import settings
from .routers import approvals, auth, entities, exceptions, imports, integrations, intake, invoices, mailboxes, modules, notifications, oauth, overview, p2p, parties, sap, users

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


app = FastAPI(title='Pravah Finance Control API', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
for r in (auth, users, entities, mailboxes, oauth, intake, p2p, invoices, exceptions, approvals, parties, notifications, overview, modules, imports, sap, integrations):
    app.include_router(r.router)


@app.get('/api/health')
def health():
    return {'ok': True}
