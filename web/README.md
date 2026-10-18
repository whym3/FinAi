# Pravah Finance Control — web app

React front end for the design in `../design`. Every screen runs against the FastAPI server in `../server`.

## Run

```sh
npm install
npm run dev      # http://localhost:5173  (add ?theme=dark or ?theme=light)
npx tsc --noEmit # type check
npm run build
```

The app needs the server: start the whole stack with `docker compose up` from the repo root, which also proxies `/api` to it.

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
| `src/api` | `index.ts` (every endpoint the screens call), `http.ts` (fetch wrapper, CSRF header, auth events), `hooks.ts` (React Query wrappers). |

## Talking to the server

Screens call the hooks in `src/api/hooks.ts`; the hooks call `src/api/index.ts`; that is the only place a URL appears. `http.ts` adds the `X-Pravah: 1` CSRF header to every request and raises an auth event on 401 so the shell can send the user back to sign-in.

Known shortcuts (search for `shortcut:`): the demo clock is pinned to 13-10-2026 15:20 IST, sync clocks are shared across entities, the period picker is display-only, and every mutation refetches all queries.
