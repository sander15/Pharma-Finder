# Pharmafind PWA demo

Pharmafind is a Spanish-language, responsive Next.js progressive web app demo for searching local medicine availability and comparing pharmacy listings. It is structured for deployment from this folder to Vercel.

## Run locally

```bash
npm install
npm run dev
```

## App areas

- **Buscar medicamentos:** searches mock product and listing data, ranks in-stock results by distance, filters for wheelchair-accessible locations, and shows pharmacy verification, exact presentation, price, stock, and update time.
- **Portal de farmacia:** edits stock and price with validation and pharmacy ownership checks; imports standard CSV rows; simulates a POS connection and sync; and shows sync freshness and a public listing preview.
- **Administración:** reviews a mock pharmacy registration and can verify it, making that pharmacy visible to search.

The app includes a PWA manifest, install affordance, app icon, and service worker with an offline shell fallback. Data is held in the browser session and resets on reload. The POS feed, drug catalog, licensing registry, directions, and storage are demo mocks; no external service or production database is connected.

## Feed format

CSV must use this exact header and standard Pharmafind catalog IDs:

```csv
catalogId,stock,price
PF-1001,5,20
PF-1002,0,18.5
```

Catalog IDs are matched exactly. Stock must be a non-negative whole number, and price must be greater than zero. Invalid rows are rejected and reported; the importer does not map product names or rewrite IDs.

## Tests

Run the test suite with `npm test`. The suite is [src/lib/domain.test.ts](src/lib/domain.test.ts) and covers search visibility and ranking, accessibility filtering, strict feed validation, pharmacy edit scope, and the 24-hour freshness rule.
