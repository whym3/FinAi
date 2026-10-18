# Pravah Finance Control

Finance control for Indian companies and the CA firms that serve them: invoice intake and reading, purchase-to-pay with a three-way match, receivables, GST, TDS, MSME and month-end close. SAP S/4HANA stays the book of record; Pravah holds checked copies, evidence, exceptions and approvals.

| Folder | What |
|---|---|
| `web/` | React app ([web/README.md](web/README.md)) |
| `server/` | FastAPI + Postgres API ([server/README.md](server/README.md)): sign-in, clients, mailboxes, Claude or OpenAI document reading, SAP imports and connector, matching, audit |
| `design/` | The original design canvas |

```sh
cp server/.env.example server/.env   # set APP_SECRET_KEY
docker compose up --build            # → http://localhost:5173, first run shows "Set up Pravah"
```
