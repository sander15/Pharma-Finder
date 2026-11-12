# Pharmafind PWA demo

Pharmafind is a Spanish-language, responsive Next.js progressive web app demo for searching local medicine availability and comparing pharmacy listings. It is structured for deployment from this folder to Vercel.

## Run locally

```bash
npm install
npm run dev
```

## App areas

- **Buscar medicamentos:** resolves supported demo zones or GPS, ranks listings by distance, includes out-of-stock rows, filters for wheelchair-accessible locations, and compares exact presentations with pharmacy details.
- **Portal de farmacia:** requires a demo login; edits stock and price with pharmacy-scope checks; imports standard CSV rows, keeps a session copy and sync log, configures/tests a mock POS endpoint and interval, and previews the public listing.
- **Administración:** requires a separate demo login; reviews uploaded license documents against a mock registry and can approve or reject requests with a reason.
- **Sync alerts:** a mock scheduled job checks stale listings, sends mock email alerts, and retries failed deliveries.

The app includes a PWA manifest, install affordance, app icons, and service worker with an offline shell fallback. Data and session tokens are held in memory and reset on reload. The POS feed, drug catalog, licensing registry, geocoder, email, directions, and file storage are demo mocks; no external service or production database is connected. Demo sign-ins are shown on the login dialog: pharmacy `patricia@farmacia.demo` / `farmacia123`; administrator `admin@pharmafind.demo` / `admin123`.

## Feed format

CSV must use this exact header and standard Pharmafind catalog IDs:

```csv
catalogId,stock,price
PF-1001,5,20
PF-1002,0,18.5
```

Catalog IDs are matched exactly. Stock must be a non-negative whole number, and price must be greater than zero. Invalid rows are rejected and reported; the importer does not map product names or rewrite IDs.

## Tests

Run the test suite with `npm test`. The suite is [src/lib/domain.test.ts](src/lib/domain.test.ts) and covers search visibility, stock status, location lookup, accessibility filtering, strict feed validation, POS setup validation, demo authentication and scope, verification decisions, sync logs, email retry, and the 24-hour freshness rule.
