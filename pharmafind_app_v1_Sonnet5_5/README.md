# Pharmafind (demo PWA)

Search for a medicine, see which **verified** pharmacies near you have it in stock, compare price / presentation / accessibility, and get directions. Pharmacies keep their listing current by manual entry, CSV upload, or an automatic POS feed; admins verify registrations.

Next.js 15 (App Router) + TypeScript, installable as a PWA. **Demo app**: every database and outside system is a mock.

## Commands

```bash
npm install
npm test          # runs the test suite  (tests/pharmafind.test.ts)
npm run dev       # http://localhost:3000
npm run build && npm start
```

Deploy to Vercel by importing the repo (framework auto-detected, no env vars required).
Optional env: `SESSION_SECRET` (token signing key), `CRON_SECRET` (protects `/api/cron`), `PHARMAFIND_DEMO_ROUTES=off` (disables `/api/demo/*`).

## Pages

| Route | Layer-1 boundary class | What it does |
|---|---|---|
| `/` | Client App | search, grouped results, compare, directions, accessibility filter |
| `/portal` | Pharmacy Portal | sign in / register / reset password, dashboard, listing editor, CSV upload, POS feed setup, verification status |
| `/admin` | Admin Console | pending registrations, registry check, manual check, approve / reject |
| `/demo` | (demo only) | fast-forward clock, run the scheduler, e-mail outage switch, mock mailbox, demo accounts, reset |

Demo accounts all use password `Demo!Pass123` (full list on `/demo`): `admin@pharmafind.demo`, `hubcity@pharmafind.demo`, `southwest@pharmafind.demo` (stale data), `quaker@pharmafind.demo` (pending), `indiana@pharmafind.demo` (rejected), ...

## Architecture (matches the diagrams)

```
src/app          Layer 1  pages + PWA (manifest.ts, layout) ; app/api/[...path] -> REST API
src/components   Layer 1  ClientApp, PharmacyPortal, AdminConsole, DemoPanel
src/lib/api.ts   Layer 2  REST API (routing, input validation, JSON responses, auth on every call)
src/lib/services Layer 2/3 auth, search, catalog, listings, feedImport, registration, admin, portal,
                          notifications, scheduler, syncLogs, pharmacies
src/lib/db.ts, fileStorage.ts   Layer 4  mock Relational DB with Geo extension, mock File Storage
src/lib/adapters Layer 4  Email, DrugReference, PosFeed, LicenseCheck, Directions, Geocoding (interfaces + mocks)
src/lib/app.ts            composition root (createApp); getApp() singleton for Next.js
```

### Standard data format rule
All external sources (POS feeds, CSV files, drug reference) already use Pharmafind's standard format and catalog IDs (`PF-nnnn`). **Feed Import only validates** (`src/lib/services/feedImport.ts`); it never trims, re-cases, maps or guesses. Non-compliant rows are rejected, and a feed with no valid row (or a wrong CSV header) is rejected as a whole. There is no translation/normalization layer (a test enforces that none exists).

CSV: first line exactly `catalogId,stock,price`; `catalogId` like `PF-1001`; `stock` a whole number; `price` positive with at most 2 decimals.

## Demo-specific behaviour

- **Data is in server memory** (seeded at start, reset on cold start / via the Demo panel). Vercel may run several instances, so state is per-instance. Sessions use signed stateless tokens, so a login survives instance changes, but the user rows behind them may not.
- **Background worker**: serverless has no always-on process, so `SchedulerService.tick()` runs (a) from the Demo panel, (b) opportunistically on API traffic (at most every 30 s), and (c) from the daily Vercel Cron (`vercel.json` -> `/api/cron`).
- **Security codes** are used for password reset (e-mailed through the mock Email adapter; read them on `/demo`). Passwords are scrypt-hashed (reduced cost for demo speed).
- Mock endpoints/rules: POS `https://pos.mock/{hub-city|slide-road|canyon-lakes|tech-terrace}` (compliant), `/mixed`, `/non-compliant`, `/down`; license numbers `TX-PH-nnnnn` valid, `TX-PH-9xxxx` registry unavailable (manual check), `TX-PH-00000` invalid. Geocoding knows a small gazetteer of Lubbock, TX (suggestions appear in the address fields).
- Pharmacy names/addresses are fictional; product info is sample data, not medical advice.
