# Pharmafind demo PWA

Pharmafind is a responsive Next.js and TypeScript progressive web app demo. It includes consumer search, a pharmacy workspace, an admin verification queue, mock route handlers, and in-memory demo data.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The service worker and web app manifest enable installation in supported browsers. The PWA requires HTTPS in deployed environments; localhost is supported for local development.

## Tests

Run `npm test`. The test suite is `pharmafind.test.ts` and covers standard-format feed validation, whole-feed schema rejection, and verified/in-stock search results with accessibility filtering and distance ranking.

## Mock API

- `GET /api/search?q=...&accessible=true`
- `POST /api/feed` with `{ "rows": [{ "catalogId": "MED-001", "stock": 8, "price": 4.25 }] }`
- `GET /api/dashboard`

Feed import validates exact field names, catalog IDs, stock, and price. It does not map alternate field names or normalize catalog IDs. A structurally noncompliant row rejects the feed; individually invalid values are reported as rejected rows.

All persistence, pharmacy systems, drug reference data, licensing, geolocation, email, and map integrations are simulated. Demo changes live in process memory and reset when the server restarts. No credentials, production database, or external API integration is required.
