# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

- Analyze before implementing. Enter plan mode for anything beyond a trivial fix.
- Minimal scope: touch only affected code, preserve backward compatibility.
- Do not touch `/legacy` or `migrations/` (migrations are write-only — never edit existing files).
- Run `pnpm lint:fix` before finishing any change.

## Commands

```bash
pnpm dev          # start dev server on port 3000
pnpm build        # production build
pnpm preview      # preview production build
pnpm test         # run tests
pnpm lint:fix     # format with prettier + fix lint errors
```

## Environment Variables

Copy `.env.example` to `.env` and fill in real values:

```
VITE_GOOGLE_CLIENT_ID=...
VITE_GOOGLE_CLIENT_SECRET=...

VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

The two Google values power the OAuth2 flow (Settings → connect Google
account). The six Firebase values power the sign-in gate and per-user
report storage — all six are required, and a missing or wrong one throws
at page load, before React mounts, so the page renders blank.

`VITE_REDIRECT_URI` is optional and should be left unset locally: the code
falls back to `http://localhost:3000/auth/callback`. Deployed environments
must set it to their own `/auth/callback` URL, and that exact URL has to be
registered as an authorized redirect URI on the OAuth client.

Vite inlines these at build time, so a deployed site picks up a changed
variable only after a rebuild — editing it in the host's dashboard alone
does nothing.

## Architecture

React 18 SPA built with Vite, Tailwind CSS, and React Router v6. No backend — all state is in `localStorage` and all external calls go directly to Google APIs from the browser.

### The Three Flows

The app processes monthly SEO/traffic reports for two projects: **BC** (property listing site with `/dijual/` and `/disewa/` URL segments) and **Blog**.

- **Flow 1 — Traffic Import** (`/flow1`): User uploads GSC and GA4 export files (xlsx or CSV, or links to Google Sheets). Data is parsed, merged by URL slug, and written to the report spreadsheet via the Sheets API. BC requires two GSC files (dijual + disewa); these are merged before slug-matching.

- **Flow 2 — Traffic Overview** (`/flow2`): Aggregates GA4 data across segments (organic, paid, etc.) into a pivot-style overview table, then pushes to the `Traffic Overview (BC & Blog)` sheet.

- **Flow 3 — Leads Summary** (`/flow3`): Computes lead metrics and prepends a new month block to the `BC/Blog Leads Summary` sheet (read existing → prepend → write back).

### Key Files

| Path | Purpose |
|---|---|
| `src/App.jsx` | Route definitions |
| `src/components/Layout.jsx` | Sidebar nav + page shell |
| `src/utils/googleAuth.js` | OAuth token management (auto-refresh via `getValidToken()`) |
| `src/utils/sheetsApi.js` | All Google Sheets API calls + `buildWorkbookFromSheet` to fetch a Sheet as a SheetJS workbook |
| `src/utils/computeFlow1.js` | Slug-level metric computation and CSV/Sheets value builders for Flow 1 |
| `src/utils/parseFlow1.js` | Parse GSC/GA4 xlsx exports into `{ rows }` objects |
| `src/utils/computeFlow2.js` | Flow 2 aggregation logic |
| `src/utils/parseFlow2.js` | Flow 2 file parsing |
| `src/utils/computeFlow3.js` | Flow 3 lead metric computation |
| `src/utils/exportUtils.js` | CSV download helpers |
| `src/utils/dateUtils.js` | Formatting helpers (`secondsToHmmss`, `formatCTR`) |
| `src/hooks/useStorage.js` | `useState` backed by localStorage with 400ms debounced writes |
| `src/hooks/usePagination.js` | Pagination state hook |
| `src/components/SheetLinkImport.jsx` | Shared UI for pasting a Google Sheets URL as an alternative to file upload |

### Data Flow Pattern

1. User uploads a file or pastes a Google Sheets URL
2. Parser (`parseFlow*.js`) converts it to a normalized `{ rows }` array keyed by slug
3. Compute function (`computeFlow*.js`) joins against the URL list and produces metrics arrays
4. Result is either downloaded as CSV (`exportUtils.js`) or pushed to Google Sheets (`sheetsApi.js`)

### State Persistence

All imported data, URL lists, and settings live in `localStorage` via `useStorage`. The OAuth token is stored under `google_oauth`. The report spreadsheet URL is stored under `spreadsheetUrl`.

### Sheets Column Layout (Flow 1)

BC writes metric columns starting at column I (1-based 9); Blog starts at column H (1-based 8). Each spans 48 columns (8 metrics × 6 slots). Metric order: Rank, Impressions, Clicks, CTR, Views, Active Users, Sessions, AET.
