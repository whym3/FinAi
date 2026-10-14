# Pravah Finance Control

Finance control for Indian companies and their CA firms: invoice intake, purchase-to-pay, GST, TDS, MSME and close.

| Folder | What |
|---|---|
| `web/` | React app ([web/README.md](web/README.md)) |
| `server/` | FastAPI + Postgres API ([server/README.md](server/README.md)) |
| `design/` | The original design canvas |

```sh
docker compose up --build    # everything, live reload → http://localhost:5173
```

The app runs without the server too (`cd web && npm run dev`), on demo data only.
