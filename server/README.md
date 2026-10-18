# Pravah server

FastAPI + Postgres. It holds the firm, its users and clients, reads invoice mailboxes (Gmail and Outlook, read-only), stores every original document, reads documents with Claude or an OpenAI model, imports SAP exports, runs the three-way match and keeps an append-only audit log. The web app (`../web`) reaches it at `/api` through the Vite proxy in dev and through nginx in production.

## Run

Everything in Docker, from the repo root:

```sh
docker compose up --build        # db + server + web, live reload → http://localhost:5173
docker compose -f docker-compose.prod.yml up --build   # built app on nginx → http://localhost:8080
```

Server outside Docker (Python 3.13 via uv):

```sh
docker compose up -d db
cp .env.example .env             # then set APP_SECRET_KEY
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
uv run pytest                    # 27 tests; DB-backed ones skip when Postgres is down
```

`docker compose down -v` wipes the database and stored documents.

## First run

Open the app. With no users in the database it shows **Set up Pravah**: firm name and the first admin. The admin then enrols an authenticator app (mandatory for everyone), onboards the first client in **Settings → Clients**, and invites colleagues in **Settings → Users & roles** with a role and approval limit per client. Without SMTP the invite link is shown to the admin to send by hand.

## Configuration (`server/.env`)

| Variable | What |
|---|---|
| `APP_SECRET_KEY` | base64 of 32 random bytes. Encrypts OAuth tokens, SAP passwords and TOTP secrets. Generate: `python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"` |
| `DATABASE_URL` | Postgres URL (`postgresql+psycopg://…`) |
| `PUBLIC_URL` | The address users open. OAuth redirect URIs and emailed links use it. `https://` also turns on secure cookies. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Gone. Document reading is configured in the app: **Settings → Integrations → Document reading**, where an admin picks Anthropic or OpenAI, pastes the key (stored encrypted) and chooses the model. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Invites, password resets, vendor queries. Optional. |
| `GOOGLE_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET` | Mailbox sign-in (below). Optional. |
| `STORAGE_DIR` | Where original documents and import files are kept (`/data/storage` in Docker) |
| `POLL_SECONDS` | Mailbox polling interval (60) |

## Sign-in and roles

- Email + password (argon2) and a mandatory authenticator (TOTP). Five failed attempts lock the account for 15 minutes. Sessions are server-side, 12-hour idle expiry, httpOnly cookie; every mutating request must carry the `X-Pravah: 1` header (CSRF guard).
- Roles per client: `partner`, `manager` (firm-wide), `cfo`, `controller`, `ap`, `ar`, `gst`, `procurement`, `stores`, `auditor` (read-only). A firm **admin** manages users, integrations and settings. Approval limits are per user per client; an invoice above the decider's limit needs a second approver.
- Every write goes to `audit_log` with user, IP and user agent; a Postgres trigger rejects UPDATE and DELETE on that table.

## How documents are read

1. A file arrives by email or upload (PDF, image, XML/JSON, or those inside a ZIP). Exact duplicates (same bytes) are marked.
2. The model classifies the pages: a scanned bundle is split into its documents (invoice, lorry receipt, weighbridge ticket, gate entry, purchase order, goods receipt note …), each stored as its own PDF.
3. Each document is read with a schema for its kind. Deterministic checks follow (GSTIN check digit, PAN–GSTIN, taxable + tax = total, CGST/SGST vs IGST, gross − tare = net); a failed check lowers the field's confidence so a person must confirm it.
4. The reader links documents by PO number, invoice number, LR number, e-way bill and vehicle into one purchase order with its GRN, dispatch documents and invoice. The PO comes from the SAP register if imported, otherwise from the PO document itself.
5. The three-way match compares Negotiated · PO · GRN · Invoice (qty, rate, HSN, tax rate and type, freight, total, payment terms, vehicle, e-way bill, IRN). Every difference becomes a flag and an exception under the matching rule (Settings → Exception rules), never a verdict.

## Getting SAP data in

- **Imports** (page): drop a purchase register, sales register, stock movement list, open-item list or master export (.xlsx/.xlsb/.csv). The server detects the kind from the headers, suggests a mapping, previews the parse and runs it in the background. Rows upsert on their natural key, so the same month can be imported again. Layouts are remembered per client.
- **SAP S/4HANA live** (Settings → Integrations): host, client, company code, communication user; `Test connection` reads `$metadata` of `API_BUSINESS_PARTNER`; an active connection pulls purchase orders, goods receipts, business partners and open items on a schedule into the same tables. `shortcut:` untested against a live system until a client grants access.

## Connecting Gmail

1. In [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Gmail API**.
2. **OAuth consent screen**: add the scope `https://www.googleapis.com/auth/gmail.readonly`. While in *Testing*, add every mailbox you will connect as a test user.
3. **Credentials → OAuth client ID → Web application**, redirect URI `<PUBLIC_URL>/api/oauth/google/callback`.
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

`gmail.readonly` is a restricted scope: use outside your own organisation needs Google's app verification and a CASA assessment. Testing-mode refresh tokens expire after 7 days.

## Connecting Outlook

1. [Azure portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps) → New registration, *Accounts in any organizational directory and personal Microsoft accounts*.
2. Redirect URI (Web): `<PUBLIC_URL>/api/oauth/microsoft/callback`.
3. API permissions: Microsoft Graph delegated `Mail.Read`, `User.Read`, `offline_access`.
4. Certificates & secrets → new client secret → `.env` `MS_CLIENT_ID` / `MS_CLIENT_SECRET`.

## Connecting any mailbox with an app password (IMAP)

No cloud app needed. Settings → Integrations → **Connect with app password**: pick the provider (Gmail, Zoho, Yahoo, iCloud, or any IMAP server), enter the address and an app password. Gmail needs 2-Step Verification on, then Google Account → Security → App passwords. The login is checked before saving; the password is stored encrypted. INBOX is opened read-only and messages are fetched with `BODY.PEEK[]`, so nothing is marked as read. The cursor is `<UIDVALIDITY>:<last UID>`; a long backfill continues 100 messages per poll. Microsoft 365 and Outlook.com no longer accept passwords over IMAP, so Outlook uses sign-in above.

Mailboxes are polled every `POLL_SECONDS` (Gmail history, Graph delta). Push notifications need a public HTTPS URL and come with deployment.

## Layout

| Path | What |
|---|---|
| `app/models.py` | Tables. `alembic/versions/0001_initial_schema.py` creates them, the audit trigger and the default exception rules. |
| `app/auth.py` | Sessions, passwords, TOTP, roles, audit helper |
| `app/routers/` | `auth`, `users`, `entities`, `mailboxes`, `oauth`, `intake`, `p2p`, `invoices`, `exceptions`, `approvals`, `parties`, `notifications`, `overview` (KPIs, counts, search, sources), `modules` (GST, payables, MSME, close, reports), `imports`, `sap`, `integrations` |
| `app/extract/` | `schemas.py` (per-kind JSON schemas and prompts), `ai.py`, `split.py`, `validate.py`, `run.py` (the job) |
| `app/domain/` | `link.py` (documents → records), `match.py` (three-way match), `p2p.py` (timeline and ledger), `calendar.py` (statutory dates) |
| `app/imports/` | `readers.py`, `kinds.py` (templates and synonyms), `run.py` (writers) |
| `app/sap/` | `odata.py` (client), `sync.py` |
| `app/mail/` | `gmail.py`, `outlook.py`, `ingest.py` |
| `app/worker.py` | Mailbox polling, SAP scheduling and the job queue (`FOR UPDATE SKIP LOCKED`) |
