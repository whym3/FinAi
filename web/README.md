# Pravah Finance Control — web app

React front end for the design in `../design` (live canvas: https://claude.ai/artifact/TioE32uj9W317YGfGE2VcT).
Every screen and workflow runs against an in-memory mock API, so the UI is complete before the backend exists.

## Run

```sh
npm install
npm run dev      # http://localhost:5173  (add ?theme=dark or ?theme=light)
npm test         # format helpers + mock-API workflow tests
npm run build
```

Use the user menu (top right) to act as Rohan Kulkarni (AP, limit ₹5 L), Farah Siddiqui (Controller), Arvind Nair (CFO) or the read-only auditor. "Reset demo data" restores the seed; a page reload does the same.

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui (Radix) · TanStack Query and Table · react-router · lucide icons · IBM Plex fonts.

## Layout

| Path | What lives there |
|---|---|
| `src/index.css` | Design tokens from `design/assets/pravah.css`, light and dark. Change colours here only. |
| `src/components/ui` | shadcn primitives, restyled to the design (button variants: `default` = primary, `outline` = standard). |
| `src/components/pravah` | Design-system parts: status pill, source chip, KPI card, data table, document viewer and drawer, comparison cell, timeline stage, states. |
| `src/layout` | Shell: sidebar, top bar (entity switcher, period, Ctrl K search, feed status, notifications, user menu), mobile top bar and tabs. |
| `src/features/<area>` | One folder per route. |
| `src/lib` | Types, Indian number and date formatting, CSV export. |
| `src/mock` | `seed/*` data from the artboards, `api.ts` (the mock backend), `hooks.ts` (React Query wrappers). |

## Connecting the backend

Screens only call the hooks in `src/mock/hooks.ts`, and the hooks only call `src/mock/api.ts`.
Features move to the real server (`../server`) one at a time: `src/api/server.ts` holds the real endpoints and `src/api/http.ts` the fetch wrapper, and `api.ts` merges server data with the mock.
Already live: clients and onboarding, invoice mailboxes, intake documents from email (ids `em-…`), AI extraction settings and the server audit log. Without the server the app falls back to mock data.
`api.test.ts` describes the behaviour each endpoint must keep (permissions, second approver, exception follow-through, IMS save).

Known shortcuts (search for `shortcut:`): the demo clock is pinned to 13-10-2026 15:20 IST, sync clocks are shared across entities, the period picker is display-only, and every mutation refetches all queries.
