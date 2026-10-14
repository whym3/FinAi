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

- Everything: `docker compose up --build` → http://localhost:5173
- UI only (mock data): `cd web && npm run dev`
- Server only: `docker compose up -d db`, then `cd server && uv run alembic upgrade head && uv run uvicorn app.main:app --reload`
- Tests: `cd web && npm test`; `cd server && uv run pytest`

## Conventions

- The UI calls `web/src/mock/api.ts`. Functions move to the real server one feature at a time (via `web/src/api/http.ts`), and `web/src/mock/api.test.ts` is the behaviour contract.
- Every write records an audit entry, and nothing is deleted.
- Push to https://github.com/whym3/FinAi on branch `claude/pravah-finance-control-design-ti9zjy`.
