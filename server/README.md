# Pravah server

FastAPI + Postgres. It holds clients and their GST registrations, reads invoice mailboxes (Gmail and Outlook, read-only), stores every original document, and extracts fields with Claude, OpenAI or Gemini. The web app (`../web`) reaches it at `/api` through the Vite proxy in dev and through nginx in production.

## Run

Everything in Docker, from the repo root:

```sh
docker compose up --build        # db + server + web, live reload → http://localhost:5173
docker compose -f docker-compose.prod.yml up --build   # built app on nginx → http://localhost:8080
```

Server outside Docker (Python 3.13 via uv):

```sh
docker compose up -d db
cp .env.example .env             # then set APP_SECRET_KEY (command in the file)
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
uv run pytest                    # 19 tests; the DB ones skip when Postgres is down
```

`docker compose down -v` wipes the database and stored documents.

## Connecting Gmail (Google Workspace or personal)

1. In [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Gmail API**.
2. **OAuth consent screen**: External (or Internal for a Workspace org). Add the scope `https://www.googleapis.com/auth/gmail.readonly`. While the app is in *Testing*, add every mailbox you will connect as a test user.
3. **Credentials → Create OAuth client ID → Web application**. Authorised redirect URI: `http://localhost:5173/api/oauth/google/callback` (use your `PUBLIC_URL` in production).
4. Put the client ID and secret in `server/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart the server.

`gmail.readonly` is a *restricted* scope. Using it for mailboxes outside your own organisation needs Google's app verification and a yearly CASA security assessment. Testing mode works for up to 100 test users, but its refresh tokens expire after 7 days.

## Connecting Outlook (Microsoft 365 or Outlook.com)

1. In [Azure portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps), choose **New registration**. For supported account types, pick *Accounts in any organizational directory and personal Microsoft accounts*.
2. Set the redirect URI to **Web** `http://localhost:5173/api/oauth/microsoft/callback`.
3. Under **API permissions**, add the Microsoft Graph delegated permissions `Mail.Read`, `User.Read` and `offline_access`. In some tenants an admin has to consent.
4. Under **Certificates & secrets**, create a new client secret. Put the application (client) ID and the secret value in `server/.env` as `MS_CLIENT_ID` and `MS_CLIENT_SECRET`.

## How email intake works

- **Connecting:** Settings → Clients → a client → *Connect Gmail / Outlook*. The flow uses OAuth with PKCE and a signed `state`. The refresh token is stored encrypted with AES-GCM under `APP_SECRET_KEY`.
- **Polling:** a background loop checks each active mailbox every `POLL_SECONDS` (60 by default).
  - Gmail follows its `historyId`. Outlook follows its delta link.
  - The first check reads the chosen backfill window.
  - Push notifications (Gmail Pub/Sub, Graph subscriptions) need a public HTTPS URL, so they come with deployment.
- **What is kept:** PDF, image, XML and JSON attachments, plus the same file types inside ZIPs.
  - Small inline images, such as signatures, are skipped.
  - Sender allow and block lists apply per mailbox.
- **Storage and duplicates:** each file is stored once per client under `STORAGE_DIR/<client>/<sha256>`. The same file arriving again is marked a duplicate of the first.
- **Extraction:** new documents are queued, and the worker sends each one to the provider chosen in Settings → AI extraction.
  - Deterministic checks then lower the confidence of doubtful fields: GSTIN check digit, PAN–GSTIN match, taxable + tax = total, and CGST/SGST vs IGST. A person has to confirm those fields.
  - Each provider needs its own API key. A Claude.ai, ChatGPT or Gemini app subscription cannot be used by other apps.
- **Errors:** if a mailbox loses access (revoked, password change), it shows *Needs attention* and stops polling until someone reconnects it.

## Auth and audit

- **Dev auth only:** the server trusts the `X-User-Id` header, sent by the web app's "Act as" switcher. Replace it with SSO and MFA before anyone outside the team uses the app.
- **Audit log:** every write goes to `audit_log`, and a Postgres trigger rejects UPDATE and DELETE on that table.

## Layout

| Path | What |
|---|---|
| `app/models.py` | Tables. Alembic migrations live in `alembic/versions`. |
| `app/routers/` | `entities` (onboarding), `mailboxes`, `oauth`, `intake`, `ai`, `audit` |
| `app/mail/` | `gmail.py`, `outlook.py` (fetch since cursor), `ingest.py` (filter, unzip, store, dedupe, queue) |
| `app/extract/` | `schema.py` (one JSON schema and prompt), `providers.py` (Claude, OpenAI, Gemini), `validate.py` (checks), `run.py` (job) |
| `app/worker.py` | Mailbox polling and the job queue (`FOR UPDATE SKIP LOCKED`) |
| `app/validate.py` | PAN, TAN, CIN and GSTIN (with check digit) validation, mirrored in `web/src/lib/gstin.ts` |
