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

React 18 SPA built with Vite, Tailwind CSS, and React Router v6. No backend — Firebase provides sign-in and per-user storage, and every other external call goes directly to Google APIs from the browser.

Access is gated: Firebase Auth (Google sign-in) plus an `allowedUsers` allow-list an admin manages in-app. Report data is stored per user under `users/{uid}` in Firestore and is invisible to other accounts.

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
| `src/hooks/useStorage.js` | Pre-Firebase localStorage hook. No longer imported anywhere — kept only so a rollback still builds |
| `src/hooks/useCloudStorage.js` | `useCloudStorage` (one key), `useChunkedCloudStorage` (keyed chunks), `useCloudArrayStorage` (sharded row lists) |
| `src/context/AuthContext.jsx` | Sign-in, sign-out, and the allow-list role lookup |
| `src/context/CloudDataContext.jsx` | Loads the account's data once, then serves and persists every key from that copy |
| `src/utils/rowShards.js` | Packs row lists into shard documents and reads them back |
| `src/utils/accessRequests.js` | Request access, and the admin approve/deny writes |
| `src/utils/migrateLocalStorage.js` | One-time localStorage import, and collection deletion |
| `firestore.rules` | Security rules. **Not deployed by any build — paste into the Firebase Console and publish** |
| `src/hooks/usePagination.js` | Pagination state hook |
| `src/components/SheetLinkImport.jsx` | Shared UI for pasting a Google Sheets URL as an alternative to file upload |

### Data Flow Pattern

1. User uploads a file or pastes a Google Sheets URL
2. Parser (`parseFlow*.js`) converts it to a normalized `{ rows }` array keyed by slug
3. Compute function (`computeFlow*.js`) joins against the URL list and produces metrics arrays
4. Result is either downloaded as CSV (`exportUtils.js`) or pushed to Google Sheets (`sheetsApi.js`)

### State Persistence

Everything lives under `users/{uid}` in Firestore. `CloudDataProvider` fetches it once on sign-in and gates the app until it arrives, so navigating between tabs costs no further reads.

| Where | Holds |
|---|---|
| `users/{uid}/data/{key}` | One document per simple key — `google_oauth`, `flow1_window`, `sheets_report_url`, logs, UI state |
| `users/{uid}/flow1_data/{key}` | Parsed Flow 1 imports, one document per export type and month slot |
| `users/{uid}/flow2_data/{key}` | The same for Flow 2 |
| `users/{uid}/bc_urls/shard-NNNNNN` | The BC URL list, packed many rows per document |
| `users/{uid}/blog_urls/shard-NNNNNN` | The Blog URL list, likewise |

**Why rows are sharded, and what not to undo.** Firestore caps a document at
1 MiB, so a URL list of thousands of rows cannot be one document. Storing one
document *per row* fixes that but spends quota per row: importing 7,714 rows
was 7,714 writes, clearing them 7,714 deletes, loading them 7,714 reads,
against a Spark-plan allowance of 20,000 writes, 20,000 deletes and 50,000
reads per day. That combination exhausted the quota in a couple of ordinary
actions. Shards hold many rows per document, so each operation costs per
shard — the same list is about six documents.

Consequences worth preserving:

- Writes must be **awaited**. `setArray` resolves only once every shard has
  landed, and the UI shows progress against it. Treating a save as instant is
  how a part-finished import silently loses rows on the next reload.
- Reads tolerate the old per-row layout, so an account still holding it loads
  normally and is re-sharded by its next save. Do not migrate on page load —
  that would spend thousands of writes just to open the app.
- Deletes must be **awaited and authoritative**. Clearing a collection sweeps
  Firestore rather than deleting only the ids this session knows about, and a
  delete that fails puts the rows back on screen with the error — a UI that
  shows data as gone while it is still stored is how "deleted, then it came
  back after a reload" happens. The pre-shard flat `data/{bc,blog}_urls`
  document counts as a copy: it is dropped on load once shards exist, and by
  any clear, or the next load re-shards it and resurrects the list.
- Row lists compare by **contents**, not reference, so re-importing unchanged
  data writes nothing. Flow data chunks deliberately do not: they are large
  enough that serialising to compare costs more than the write it might save.

### Sheets Column Layout (Flow 1)

BC writes metric columns starting at column I (1-based 9); Blog starts at column H (1-based 8). Each spans 48 columns (8 metrics × 6 slots). Metric order: Rank, Impressions, Clicks, CTR, Views, Active Users, Sessions, AET.
