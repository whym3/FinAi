# Pravah Finance Control

`web/` is the React UI (Vite, Tailwind, shadcn). `server/` is the FastAPI + Postgres API. `design/` holds the original design canvas.

## Use the graph first (saves tokens)

A graphify knowledge graph of this repo lives in `graphify-out/`. Before reading files to understand code, ask the graph:

- `graphify query "<question>"`: broad context, e.g. "how does intake confirm work"
- `graphify path "<A>" "<B>"`: how two things connect
- `graphify explain "<symbol>"`: one node and its neighbours
- `graphify-out/GRAPH_REPORT.md`: communities and core nodes at a glance

Open the source files only after the graph has told you which ones matter.

## After finishing a piece of work

Refresh the graph so the next session sees your changes: run `/graphify . --update`, which re-extracts only the changed files. If `graphify-out/` is missing, run a full `/graphify .`.

## Run

- Everything: `docker compose up --build` → http://localhost:5173 (first run: /setup creates the firm and admin; MFA is mandatory)
- Server only: `docker compose up -d db`, then `cd server && uv run alembic upgrade head && uv run uvicorn app.main:app --reload`
- UI only: `cd web && npm run dev` (needs the server; there is no mock data any more)
- Tests: `cd web && npm test`; `cd server && uv run pytest`

## Conventions

- The UI calls only `web/src/api/index.ts` (fetch wrapper in `web/src/api/http.ts`, React Query hooks in `web/src/api/hooks.ts`). Server routes live in `server/app/routers/`; shapes are `web/src/lib/types.ts` ↔ `server/app/serialize.py`.
- The model is called only from `server/app/extract/ai.py`; the provider, key and model come from the `ai_settings` row (Settings → Integrations), falling back to `ANTHROPIC_API_KEY`.
- Every write records an audit entry, and nothing is deleted. Extracted values never count until a person confirms them.
- Sample client data for manual testing is in `~/Downloads/Datafor` (Apollo Pipes: a scanned invoice bundle, purchase and sales registers, stock movements).
- Push to https://github.com/whym3/FinAi on branch `claude/pravah-finance-control-design-ti9zjy`.
