# Pharmafind Demo PWA

A responsive, installable Next.js and TypeScript demo based on the requirements and diagrams in reqs_and_diagrams.

## Run locally

    npm install
    npm run dev

Open http://localhost:3000. For a production build use pnpm build and pnpm start; Vercel detects Next.js automatically.

## Test suite

The TDD suite is tests/pharmafind.test.ts. Run it with pnpm test (or pnpm test:watch). Tests were authored before the app implementation.

## Demo areas

- Find medicine: brand/generic name matching, separate presentation rows, approximate distance ordering, optional wheelchair-accessible filter, stock, listed retail price, verification badge, and update age.
- Pharmacy portal: manual listing edits, standard CSV feed import, POS endpoint connection simulation, last-sync freshness, public preview, and registration submission.
- Admin review: simulated license review, approval, and rejection. Unverified pharmacies remain hidden from consumer search.

## Demo boundaries

Data persists in browser localStorage; the included data, POS connector, licensing registry, geocoding, directions, notifications, and email integrations are mocks. Coordinates are sample San José coordinates. No medical advice, purchase, or reservation is provided. Real credentials and production authentication are not included.

All imported rows must use the exact catalogId,stock,price header and known Pharmafind catalog IDs. Validation rejects non-compliant rows. Identifiers and fields are never translated, normalized, or mapped from another catalog.

