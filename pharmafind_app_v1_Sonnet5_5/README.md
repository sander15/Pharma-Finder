# Pharmafind (demo PWA)

Find which nearby **verified** pharmacies have a medicine in stock, compare presentations and prices, and get directions.
Pharmacies keep their stock and prices current through a portal (manual edits, CSV upload, automatic POS feed); administrators verify pharmacy licenses.

Next.js 15 (App Router) + TypeScript, installable as a PWA. **This is a demo:** every database and external system is a mock.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # the test suite
npm run build && npm start
```

## Test suite

**`tests/pharmafind.test.ts`** (Vitest, 136 tests). Run it with `npm test`.

It was written first (TDD) from the requirements and diagrams, before the implementation. It covers the mock DB / adapters, search and ranking,
the 24 h data-recency rule, authentication and per-pharmacy access control, password reset with security codes, manual edits, CSV import validation,
POS feed pulls, the dashboard and preview, stale-sync alerts and e-mail retries, the job scheduler, registration and admin verification, the REST API envelope and the demo controls.

## Deploy (Vercel)

Import the folder as a Next.js project; no configuration is needed. Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Signs session tokens (a demo default is used if unset). |
| `CRON_SECRET` | If set, `/api/cron` requires `Authorization: Bearer <secret>` (Vercel Cron sends it automatically). |

`vercel.json` schedules `/api/cron` daily (the Hobby plan allows daily crons). It runs whichever background jobs are due.

## Demo accounts (password `Demo!Pass123`)

| E-mail | Role |
| --- | --- |
| `admin@pharmafind.demo` | Administrator |
| `hubcity@`, `plains@`, `raider@`, `depot@`, `southside@`, `westgate@pharmafind.demo` | Pharmacy managers (verified) |
| `newleaf@pharmafind.demo` | Pharmacy manager, **pending** verification (waiting in the admin queue) |

Demo city is Lubbock, TX. For location, either allow GPS or type a place the mock geocoder knows, e.g. **Texas Tech University**, Downtown Lubbock, Depot District, South Plains Mall.
Search examples: `ibuprofen`, `Tylenol`, `amoxicillin`.

## Demo tab (`/demo`)

* **Fast-forward the server clock** (+1 h … +72 h) to show the 24 h rule. Everything time-based follows the *server* clock: the stale flag **and** the "last updated N h ago" text are both computed on the server and sent to the browser, so they can never disagree (the browser's own clock is never used for ages).
* **Run the background worker** (all due jobs, or one job): POS feed pulls, stale-sync alert e-mails, drug-reference refresh, e-mail retries.
* **Break external systems:** e-mail service down, licensing registry down, drug database down, a POS system sending non-compliant rows / a malformed feed / being down.
* **Simulated mailbox:** security codes and stale-sync alerts show up here instead of being e-mailed.

## Rules the app follows

* **Standard format, validate only.** POS feeds, CSV files and the drug reference already use Pharmafind's format and `PF-nnnnn` catalog IDs. **Feed Import** is the only place incoming data is checked; it rejects non-compliant rows and never trims, converts or repairs anything (`src/lib/services/feedImport.ts`). There is no translation or normalisation layer.
  CSV: header exactly `catalogId,stock,price`; stock a whole number ≥ 0; price > 0 with a dot and ≤ 2 decimals; duplicate IDs in a file rejected. Valid rows are saved, rejected rows are reported; a file with no valid rows is rejected and logged as a failed sync.
* **Data recency.** Stock/price data up to 24 h old is shown normally; older data is shown but labelled **"Stale data: likely out of date"**; every result carries a "last updated" indicator. A manual save in the portal also counts as a sync: it writes a successful Sync Log entry ("Manual entry: …") with no Feed Import attached, so a manager who updates by hand is not flagged as stale. Invalid or denied edits write nothing. Pharmacies get a dashboard warning and an alert e-mail (once per 24 h) when their last *successful* sync is over 24 h old.
* **Registration ≠ verification.** A registered pharmacy stays hidden from search until an admin verifies it (registry check + manual document check). Only verified pharmacies appear, with a "verified" badge.
* **Own-pharmacy data only.** Every portal route checks that the logged-in manager belongs to the pharmacy in the URL. Admins use the admin console, not the portal.

## Architecture (from the diagrams)

| Layer | Where |
| --- | --- |
| 1 Presentation (Client App, Pharmacy Portal, Admin Console) | `src/components/`, `src/app/` |
| 2 Interface and security (REST API, Access and Authentication) | `src/lib/api.ts`, `src/lib/services/auth.ts`, `src/app/api/[...path]/route.ts` |
| 3 App logic (Search, Catalog/Listings, Registration/Verification, Notifications, Feed Import, Job Scheduler) | `src/lib/services/` |
| 4 Data and system services (relational DB with geo, file storage, 6 integration adapters) | `src/lib/db.ts`, `fileStorage.ts`, `adapters.ts`, `mockData.ts`, `seed.ts` |
| 5 External systems | simulated by the mock adapters |

`src/lib/app.ts` is the composition root. Time comes from an injectable `Clock` (`src/lib/clock.ts`).

## Demo limitations (by design)

* The mock database lives in server memory: it **resets on a cold start**, and each serverless instance has its own copy (so registrations or demo fast-forwards may not be visible across instances on Vercel).
* There is no always-on worker on serverless hosting, so due jobs also run opportunistically when API requests arrive, from the daily cron, and from the Demo tab.
* Security codes are shown in the Demo tab's mailbox instead of being e-mailed.
