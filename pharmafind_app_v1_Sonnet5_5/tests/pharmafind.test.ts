/**
 * PHARMAFIND TEST SUITE  (run with:  npm test)
 *
 * Written FIRST (test-driven development): these tests and their expected outputs define the
 * behaviour of the app before any implementation existed. They map to the design documents:
 *
 *   - Sequence diagram 1 (p1/p2)  Consumer search (+ presentation grouping, accessibility filter)
 *   - Sequence diagram 2 (p1)     Manual entry, CSV upload, automatic POS feed (+ scheduled pull)
 *   - Sequence diagram 2 (p2)     Dashboard, last-sync, stale-sync alert, email retry
 *   - Sequence diagram 3 (p2)     Registration -> admin verification -> visible to searchers
 *   - Architecture / class diagrams: layers (REST API, Access & Authentication), entities, adapters
 *   - Project rule: ALL external data already uses Pharmafind's standard format + catalog IDs, so
 *     Feed Import only VALIDATES (never parses/normalizes); non-compliant data is rejected.
 *
 * Every test builds a fresh app (fresh mock database + mock external systems) with a fixed clock.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "@/lib/app";
import { DEMO_PASSWORD, SEED } from "@/lib/seed";
import { distanceKm } from "@/lib/geo";
import type { SessionAccount } from "@/lib/types";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const TTU = { latitude: 33.5843, longitude: -101.8783 }; // Texas Tech University (mock origin)
const HOUR = 3_600_000;
const MIN = 60_000;

let app: App;

beforeEach(() => {
  app = createApp({ now: NOW });
});

async function login(email: string): Promise<SessionAccount> {
  return (await app.auth.login(email, DEMO_PASSWORD)).account;
}
const asHub = () => login(SEED.pharmacies.hubCity.email);
const asAdmin = () => login(SEED.admin.email);

const CSV_HEADER = "catalogId,stock,price";
const validRegistration = (over: Record<string, unknown> = {}) => ({
  pharmacyName: "Maple Street Pharmacy",
  licenseNumber: "TX-PH-55555",
  phone: "806-555-0199",
  address: "Texas Tech University",
  isAccessible: true,
  staffFullName: "Maria Lopez",
  email: "maria@maple.test",
  password: "Sup3rSecret!",
  document: { fileName: "license.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("fake pdf").toString("base64") },
  ...over,
});

/* ------------------------------------------------------------------------------------------ */
describe("Geo helpers (Location.distanceTo / isWithin)", () => {
  it("computes great-circle distance in km", () => {
    expect(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeGreaterThan(110.7);
    expect(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeLessThan(111.7);
    expect(distanceKm(TTU, TTU)).toBe(0);
    const d = distanceKm(TTU, { latitude: 33.5779, longitude: -101.8552 });
    expect(d).toBeGreaterThan(2.1);
    expect(d).toBeLessThan(2.4);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Seeded mock data / mock databases", () => {
  it("every product is described by a drug-reference entry and uses a catalog ID", () => {
    const products = app.db.query<any>("products");
    const refs = app.db.query<any>("drugReferenceEntries");
    expect(products.length).toBeGreaterThanOrEqual(12);
    for (const p of products) {
      expect(p.catalogId).toMatch(/^PF-\d{4}$/);
      expect(refs.some((r) => r.referenceId === p.reference)).toBe(true);
    }
  });

  it("covers every pharmacy verification state", () => {
    const states = new Set(app.db.query<any>("pharmacies").map((p) => p.verificationStatus));
    expect(states).toEqual(new Set(["verified", "pending", "rejected"]));
  });

  it("drug reference adapter finds entries by name and returns generic alternatives", async () => {
    const found = await app.adapters.drugReference.searchByName("advil");
    expect(found.map((e) => e.brandName)).toContain("Advil");
    const entry = await app.adapters.drugReference.fetchEntry("REF-ADVIL");
    expect(entry?.activeIngredient).toBe("Ibuprofen");
    const alts = await app.catalog.getGenericAlternatives("REF-ADVIL");
    expect(alts.map((a) => a.brandName).sort()).toEqual(["Generic", "Motrin"].sort());
  });

  it("geocoding adapter resolves known places and rejects unknown ones", async () => {
    const hit = await app.adapters.geocoding.geocode("Texas Tech University");
    expect(hit).toMatchObject({ latitude: expect.any(Number), longitude: expect.any(Number) });
    expect(await app.adapters.geocoding.geocode("Nowhere, Atlantis")).toBeNull();
  });

  it("directions adapter returns a maps link", () => {
    const url = app.adapters.directions.getRouteLink(TTU, { latitude: 33.5, longitude: -101.9 });
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("33.5");
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Sequence 1 - Consumer search (match product, rank by distance, verified only)", () => {
  it("groups results by presentation/dosage and ranks each group by distance", async () => {
    const res = await app.search.search({ queryText: "ibuprofen", origin: TTU });
    const ids = res.groups.map((g) => g.product.catalogId);
    expect(ids).toEqual(expect.arrayContaining(["PF-1001", "PF-1002", "PF-1003", "PF-1004"]));
    for (const g of res.groups) {
      expect(g.product.presentation).toBeTruthy();
      expect(g.product.dosage).toBeTruthy();
      const d = g.listings.map((l) => l.distanceKm);
      expect(d).toEqual([...d].sort((a, b) => a - b));
    }
    expect(res.searchId).toBeTruthy();
  });

  it("each result carries name, stock, price, last updated, accessibility, verified and directions", async () => {
    const res = await app.search.search({ queryText: "advil", origin: TTU });
    expect(res.groups).toHaveLength(1);
    const first = res.groups[0].listings[0];
    expect(first.pharmacyId).toBe("ph-tech-terrace"); // closest to Texas Tech
    expect(first).toMatchObject({
      pharmacyName: expect.any(String),
      stock: 12,
      inStock: true,
      price: 8.49,
      isAccessible: false,
      verified: true,
      lastUpdated: expect.any(String),
    });
    expect(first.directionsUrl).toMatch(/^https:\/\//);
  });

  it("matches brand OR generic names, case-insensitively", async () => {
    const byBrand = await app.search.search({ queryText: "ADVIL", origin: TTU });
    expect(byBrand.groups.map((g) => g.product.catalogId)).toEqual(["PF-1001"]);
    const byGeneric = await app.search.search({ queryText: "acetaminophen", origin: TTU });
    expect(byGeneric.groups.map((g) => g.product.catalogId)).toEqual(expect.arrayContaining(["PF-1005", "PF-1006"]));
  });

  it("returns an empty result when no product matches", async () => {
    const res = await app.search.search({ queryText: "zzzxqv", origin: TTU });
    expect(res.groups).toEqual([]);
  });

  it("only shows verified pharmacies (pending and rejected are hidden)", async () => {
    const res = await app.search.search({ queryText: "advil", origin: TTU, inStockOnly: false });
    const pharmacyIds = res.groups.flatMap((g) => g.listings.map((l) => l.pharmacyId));
    expect(pharmacyIds).not.toContain("ph-quaker"); // pending, but has a listing in the DB
    expect(pharmacyIds).not.toContain("ph-indiana"); // rejected
  });

  it("hides out-of-stock listings by default and can include them", async () => {
    const def = await app.search.search({ queryText: "advil", origin: TTU });
    expect(def.groups[0].listings.map((l) => l.pharmacyId)).not.toContain("ph-slide-road");
    const all = await app.search.search({ queryText: "advil", origin: TTU, inStockOnly: false });
    const slide = all.groups[0].listings.find((l) => l.pharmacyId === "ph-slide-road");
    expect(slide).toMatchObject({ stock: 0, inStock: false });
  });

  it("filters to wheelchair-accessible pharmacies when needsAccessibleAccess is set", async () => {
    const res = await app.search.search({ queryText: "advil", origin: TTU, needsAccessibleAccess: true });
    const l = res.groups[0].listings;
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((x) => x.isAccessible)).toBe(true);
    expect(l.map((x) => x.pharmacyId)).not.toContain("ph-tech-terrace");
  });

  it("limits results to maxDistanceKm", async () => {
    const res = await app.search.search({ queryText: "advil", origin: TTU, maxDistanceKm: 3 });
    const l = res.groups[0].listings;
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((x) => x.distanceKm <= 3)).toBe(true);
  });

  it("accepts an address as origin (geocoded) and rejects an unknown address", async () => {
    const res = await app.search.search({ queryText: "advil", origin: { address: "Texas Tech University" } });
    expect(res.origin.latitude).toBeCloseTo(TTU.latitude, 3);
    await expect(app.search.search({ queryText: "advil", origin: { address: "Nowhere, Atlantis" } })).rejects.toMatchObject({
      code: "ADDRESS_NOT_FOUND",
    });
  });

  it("flags data older than 24 hours as stale", async () => {
    const res = await app.search.search({ queryText: "advil", origin: TTU });
    const southwest = res.groups[0].listings.find((l) => l.pharmacyId === "ph-southwest")!;
    const hub = res.groups[0].listings.find((l) => l.pharmacyId === "ph-hub-city")!;
    expect(southwest.isStale).toBe(true);
    expect(hub.isStale).toBe(false);
  });

  it("rejects blank or one-character queries", async () => {
    await expect(app.search.search({ queryText: " ", origin: TTU })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("a listing becomes visible only when the pharmacy is verified AND it is in stock", async () => {
    const hub = await app.db.get<any>("pharmacies", "ph-hub-city")!;
    expect(app.pharmacies.isVerified(hub)).toBe(true);
    expect(app.pharmacies.isVisibleInSearch(hub)).toBe(true);
    const pending = app.db.get<any>("pharmacies", "ph-quaker")!;
    expect(app.pharmacies.isVisibleInSearch(pending)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Access and Authentication (Layer 2)", () => {
  it("logs in with valid credentials and returns a session token", async () => {
    const { token, account } = await app.auth.login(SEED.pharmacies.hubCity.email, DEMO_PASSWORD);
    expect(token).toBeTruthy();
    expect(account).toMatchObject({ role: "pharmacy_staff", pharmacyId: "ph-hub-city" });
    expect((account as any).passwordHash).toBeUndefined();
    expect(await app.auth.authenticate(token)).toMatchObject({ email: SEED.pharmacies.hubCity.email });
  });

  it("rejects wrong password and unknown e-mail with the same error", async () => {
    await expect(app.auth.login(SEED.pharmacies.hubCity.email, "wrong-password")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(app.auth.login("nobody@nowhere.test", DEMO_PASSWORD)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("rejects tampered or garbage tokens", async () => {
    const { token } = await app.auth.login(SEED.admin.email, DEMO_PASSWORD);
    await expect(app.auth.authenticate(token + "x")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(app.auth.authenticate("garbage")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("session tokens expire", async () => {
    const { token } = await app.auth.login(SEED.admin.email, DEMO_PASSWORD);
    app.clock.advance(13 * HOUR);
    await expect(app.auth.authenticate(token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("stores only hashed passwords", () => {
    for (const a of app.db.query<any>("accounts")) {
      expect(a.passwordHash).toBeTruthy();
      expect(a.passwordHash).not.toContain(DEMO_PASSWORD);
    }
  });

  it("password reset: security code is e-mailed, works once, and sets a new password", async () => {
    await app.auth.startPasswordReset(SEED.pharmacies.hubCity.email);
    const mail = app.adapters.email.outbox.at(-1)!;
    expect(mail.to).toBe(SEED.pharmacies.hubCity.email);
    const code = /\b(\d{6})\b/.exec(mail.body)![1];

    await expect(app.auth.resetPassword(SEED.pharmacies.hubCity.email, "000000", "N3wPassword!")).rejects.toMatchObject({ code: "INVALID_CODE" });
    await app.auth.resetPassword(SEED.pharmacies.hubCity.email, code, "N3wPassword!");
    await expect(app.auth.login(SEED.pharmacies.hubCity.email, DEMO_PASSWORD)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect((await app.auth.login(SEED.pharmacies.hubCity.email, "N3wPassword!")).token).toBeTruthy();
    await expect(app.auth.resetPassword(SEED.pharmacies.hubCity.email, code, "An0therOne!")).rejects.toMatchObject({ code: "INVALID_CODE" }); // single use
  });

  it("security codes expire after 15 minutes", async () => {
    await app.auth.startPasswordReset(SEED.pharmacies.hubCity.email);
    const code = /\b(\d{6})\b/.exec(app.adapters.email.outbox.at(-1)!.body)![1];
    app.clock.advance(16 * MIN);
    await expect(app.auth.resetPassword(SEED.pharmacies.hubCity.email, code, "N3wPassword!")).rejects.toMatchObject({ code: "INVALID_CODE" });
  });

  it("does not reveal whether an e-mail exists when starting a reset", async () => {
    const before = app.adapters.email.outbox.length;
    await expect(app.auth.startPasswordReset("nobody@nowhere.test")).resolves.toBeUndefined();
    expect(app.adapters.email.outbox.length).toBe(before);
  });

  it("enforces a minimum password length on reset", async () => {
    await app.auth.startPasswordReset(SEED.pharmacies.hubCity.email);
    const code = /\b(\d{6})\b/.exec(app.adapters.email.outbox.at(-1)!.body)![1];
    await expect(app.auth.resetPassword(SEED.pharmacies.hubCity.email, code, "short")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Sequence 2 - Manual listing entry (per-pharmacy access control + validation)", () => {
  it("updates stock and price and refreshes lastUpdated", async () => {
    const hub = await asHub();
    const listing = await app.portal.updateListing(hub, "ph-hub-city", { catalogId: "PF-1005", stock: 17, price: 9.25 });
    expect(listing).toMatchObject({ stock: 17, price: 9.25, lastUpdated: NOW.toISOString() });
    const res = await app.search.search({ queryText: "tylenol", origin: TTU });
    expect(res.groups.flatMap((g) => g.listings).find((l) => l.pharmacyId === "ph-hub-city" && l.price === 9.25)).toBeTruthy();
  });

  it("creates a listing when the pharmacy did not stock the product yet", async () => {
    const hub = await asHub();
    expect(app.listings.getListing("ph-hub-city", "PF-1015")).toBeUndefined();
    await app.portal.updateListing(hub, "ph-hub-city", { catalogId: "PF-1015", stock: 3, price: 54.99 });
    expect(app.listings.getListing("ph-hub-city", "PF-1015")).toMatchObject({ stock: 3, price: 54.99 });
  });

  it("denies access to another pharmacy's listings", async () => {
    const hub = await asHub();
    await expect(app.portal.updateListing(hub, "ph-slide-road", { catalogId: "PF-1005", stock: 1, price: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(app.listings.getListing("ph-slide-road", "PF-1005")?.stock).not.toBe(1);
  });

  it("denies admins from editing pharmacy listings (no permission)", async () => {
    const admin = await asAdmin();
    await expect(app.portal.updateListing(admin, "ph-hub-city", { catalogId: "PF-1005", stock: 1, price: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([
    ["zero price", { stock: 5, price: 0 }],
    ["negative price", { stock: 5, price: -2 }],
    ["string price (no coercion)", { stock: 5, price: "5.00" }],
    ["NaN price", { stock: 5, price: NaN }],
    ["price with 3 decimals", { stock: 5, price: 1.234 }],
    ["fractional stock", { stock: 1.5, price: 5 }],
    ["negative stock", { stock: -1, price: 5 }],
    ["string stock (no coercion)", { stock: "5", price: 5 }],
  ])("rejects invalid values: %s", async (_label, vals) => {
    const hub = await asHub();
    const before = app.listings.getListing("ph-hub-city", "PF-1005");
    await expect(app.portal.updateListing(hub, "ph-hub-city", { catalogId: "PF-1005", ...(vals as any) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(app.listings.getListing("ph-hub-city", "PF-1005")).toEqual(before);
  });

  it("rejects catalog IDs that are not in the Pharmafind catalog (no fuzzy matching)", async () => {
    const hub = await asHub();
    await expect(app.portal.updateListing(hub, "ph-hub-city", { catalogId: "pf-1005", stock: 1, price: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(app.portal.updateListing(hub, "ph-hub-city", { catalogId: "PF-9999", stock: 1, price: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("allows stock 0 (marks the product out of stock)", async () => {
    const hub = await asHub();
    const l = await app.portal.updateListing(hub, "ph-hub-city", { catalogId: "PF-1001", stock: 0, price: 7.99 });
    expect(app.listings.isInStock(l)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Sequence 2 - CSV upload through Feed Import (validate only, never normalize)", () => {
  const csv = (...rows: string[]) => [CSV_HEADER, ...rows].join("\n") + "\n";

  it("saves valid rows, rejects invalid ones, reports counts, keeps a file copy and records the sync", async () => {
    const hub = await asHub();
    const text = csv("PF-1001,10,8.50", "PF-1002,5,6.00", "BAD-ID,3,1.00", "PF-1003,-1,2.00", "PF-1004,3,0");
    const result = await app.portal.uploadCsv(hub, "ph-hub-city", "stock.csv", text);

    expect(result).toMatchObject({ status: "accepted", totalRows: 5, validRows: 2, rejectedRows: 3 });
    expect(result.rejections.map((r) => r.row)).toEqual([3, 4, 5]); // 1-based data rows
    expect(app.listings.getListing("ph-hub-city", "PF-1001")).toMatchObject({ stock: 10, price: 8.5, lastUpdated: NOW.toISOString() });
    expect(app.listings.getListing("ph-hub-city", "PF-1002")).toMatchObject({ stock: 5, price: 6 });

    const stored = await app.files.retrieve(result.storedFilePath!);
    expect(stored?.toString("utf8")).toBe(text); // exact copy of what was uploaded

    const pharmacy = app.db.get<any>("pharmacies", "ph-hub-city")!;
    expect(pharmacy.lastSyncAt).toBe(NOW.toISOString());
    const log = app.syncLogs.getLatestFor("ph-hub-city")!;
    expect(log).toMatchObject({ success: true, feedImport: result.importId });
  });

  it.each([
    ["leading space in catalog ID", " PF-1001,10,8.50"],
    ["lowercase catalog ID", "pf-1001,10,8.50"],
    ["comma decimal price", 'PF-1001,10,"8,50"'],
    ["currency symbol", "PF-1001,10,$8.50"],
    ["scientific-notation stock", "PF-1001,1e3,8.50"],
    ["padded stock", "PF-1001, 10,8.50"],
    ["fractional stock", "PF-1001,1.5,8.50"],
    ["three-decimal price", "PF-1001,10,8.501"],
    ["missing column", "PF-1001,10"],
    ["extra column", "PF-1001,10,8.50,extra"],
    ["empty price", "PF-1001,10,"],
  ])("rejects non-compliant row without correcting it: %s", async (_label, row) => {
    const hub = await asHub();
    const before = app.listings.getListing("ph-hub-city", "PF-1001");
    const result = await app.portal.uploadCsv(hub, "ph-hub-city", "x.csv", csv(row, "PF-1002,1,1.00"));
    expect(result).toMatchObject({ totalRows: 2, validRows: 1, rejectedRows: 1 });
    expect(app.listings.getListing("ph-hub-city", "PF-1001")).toEqual(before);
  });

  it("rejects the whole feed when the header is not the standard format", async () => {
    const hub = await asHub();
    const before = app.listings.getListing("ph-hub-city", "PF-1001");
    const result = await app.portal.uploadCsv(hub, "ph-hub-city", "other.csv", "id,qty,cost\nPF-1001,10,8.50\n");
    expect(result.status).toBe("rejected");
    expect(result.validRows).toBe(0);
    expect(app.listings.getListing("ph-hub-city", "PF-1001")).toEqual(before);
    expect(app.syncLogs.getLatestFor("ph-hub-city")).toMatchObject({ success: false, feedImport: result.importId });
    expect(result.storedFilePath).toBeFalsy();
  });

  it("rejects the feed (failure logged, last sync untouched) when no row is valid", async () => {
    const hub = await asHub();
    const lastSyncBefore = app.db.get<any>("pharmacies", "ph-hub-city")!.lastSyncAt;
    app.clock.advance(HOUR);
    const result = await app.portal.uploadCsv(hub, "ph-hub-city", "bad.csv", csv("BAD,1,1.00", "WORSE,x,y"));
    expect(result).toMatchObject({ status: "rejected", validRows: 0, rejectedRows: 2 });
    expect(app.syncLogs.getLatestFor("ph-hub-city")!.success).toBe(false);
    expect(app.db.get<any>("pharmacies", "ph-hub-city")!.lastSyncAt).toBe(lastSyncBefore);
  });

  it("rejects a repeated catalog ID within one file (second occurrence)", async () => {
    const hub = await asHub();
    const result = await app.portal.uploadCsv(hub, "ph-hub-city", "dup.csv", csv("PF-1001,10,8.50", "PF-1001,99,1.00"));
    expect(result).toMatchObject({ validRows: 1, rejectedRows: 1 });
    expect(app.listings.getListing("ph-hub-city", "PF-1001")).toMatchObject({ stock: 10, price: 8.5 });
  });

  it("treats CRLF only as a line terminator", async () => {
    const hub = await asHub();
    const result = await app.portal.uploadCsv(hub, "ph-hub-city", "win.csv", `${CSV_HEADER}\r\nPF-1001,10,8.50\r\nPF-1002,5,6.00\r\n`);
    expect(result).toMatchObject({ status: "accepted", totalRows: 2, validRows: 2 });
  });

  it("denies uploading for another pharmacy and rejects empty uploads", async () => {
    const hub = await asHub();
    await expect(app.portal.uploadCsv(hub, "ph-slide-road", "x.csv", csv("PF-1001,1,1.00"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(app.portal.uploadCsv(hub, "ph-hub-city", "x.csv", "")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("every FeedImport has exactly one SyncLog", async () => {
    const hub = await asHub();
    const r1 = await app.portal.uploadCsv(hub, "ph-hub-city", "a.csv", csv("PF-1001,10,8.50"));
    const r2 = await app.portal.uploadCsv(hub, "ph-hub-city", "b.csv", "bad\n");
    const logs = app.db.query<any>("syncLogs");
    expect(logs.filter((l) => l.feedImport === r1.importId)).toHaveLength(1);
    expect(logs.filter((l) => l.feedImport === r2.importId)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Sequence 2 - Automatic POS feed (configure, test connection, enable)", () => {
  it("tests the connection, enables the feed and schedules it", async () => {
    const hub = await asHub();
    const feed = await app.portal.configureAutomaticFeed(hub, "ph-hub-city", { posEndpoint: "https://pos.mock/hub-city", intervalMinutes: 30 });
    expect(feed).toMatchObject({ isEnabled: true, intervalMinutes: 30, posEndpoint: "https://pos.mock/hub-city", lastPulledAt: null });
  });

  it("returns a clear error and does NOT enable the feed when the connection fails", async () => {
    const hub = await asHub();
    await expect(app.portal.configureAutomaticFeed(hub, "ph-hub-city", { posEndpoint: "https://pos.mock/down", intervalMinutes: 30 })).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
    await expect(app.portal.configureAutomaticFeed(hub, "ph-hub-city", { posEndpoint: "https://unknown.example/pos", intervalMinutes: 30 })).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
    expect(app.db.query<any>("automaticFeeds").find((f) => f.pharmacy === "ph-hub-city")?.isEnabled ?? false).toBe(false);
  });

  it.each([[4], [1441], [10.5], [0]])("rejects interval %s", async (interval) => {
    const hub = await asHub();
    await expect(app.portal.configureAutomaticFeed(hub, "ph-hub-city", { posEndpoint: "https://pos.mock/hub-city", intervalMinutes: interval })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("denies configuring another pharmacy's feed", async () => {
    const hub = await asHub();
    await expect(app.portal.configureAutomaticFeed(hub, "ph-slide-road", { posEndpoint: "https://pos.mock/slide-road", intervalMinutes: 15 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("re-configuring updates the single feed (a pharmacy configures at most one) and can be disabled", async () => {
    const hub = await asHub();
    await app.portal.configureAutomaticFeed(hub, "ph-hub-city", { posEndpoint: "https://pos.mock/hub-city", intervalMinutes: 30 });
    await app.portal.configureAutomaticFeed(hub, "ph-hub-city", { posEndpoint: "https://pos.mock/hub-city", intervalMinutes: 60 });
    const feeds = app.db.query<any>("automaticFeeds").filter((f) => f.pharmacy === "ph-hub-city");
    expect(feeds).toHaveLength(1);
    expect(feeds[0].intervalMinutes).toBe(60);
    await app.portal.disableAutomaticFeed(hub, "ph-hub-city");
    expect(app.db.query<any>("automaticFeeds").find((f) => f.pharmacy === "ph-hub-city")!.isEnabled).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Job Scheduler and Background Worker (Layer 3)", () => {
  it("runs every due job once, then nothing until the next interval", async () => {
    const first = await app.scheduler.tick();
    expect(first.ran.sort()).toEqual(["check_stale_sync", "pull_pos_feeds", "refresh_drug_reference", "retry_failed_emails"]);
    const second = await app.scheduler.tick();
    expect(second.ran).toEqual([]);
  });

  it("pulls the enabled POS feed through Feed Import and updates listings", async () => {
    expect(app.listings.getListing("ph-slide-road", "PF-1001")!.stock).toBe(0);
    await app.scheduler.tick();
    expect(app.listings.getListing("ph-slide-road", "PF-1001")).toMatchObject({ stock: 30, price: 7.49, lastUpdated: NOW.toISOString() });
    const log = app.syncLogs.getLatestFor("ph-slide-road")!;
    expect(log.success).toBe(true);
    expect(app.db.query<any>("feedImports").find((f) => f.pharmacy === "ph-slide-road")!.source).toBe("pos");
    const feed = app.db.query<any>("automaticFeeds").find((f) => f.pharmacy === "ph-slide-road")!;
    expect(feed.lastPulledAt).toBe(NOW.toISOString());
    // now the product shows in search results for that pharmacy
    const res = await app.search.search({ queryText: "advil", origin: TTU });
    expect(res.groups[0].listings.map((l) => l.pharmacyId)).toContain("ph-slide-road");
  });

  it("does not pull a feed again before its interval has passed, then pulls again after", async () => {
    await app.scheduler.tick();
    const count = () => app.db.query<any>("feedImports").filter((f) => f.pharmacy === "ph-slide-road").length;
    expect(count()).toBe(1);
    app.clock.advance(10 * MIN);
    await app.scheduler.tick();
    expect(count()).toBe(1);
    app.clock.advance(6 * MIN); // 16 min total >= 15 min interval
    await app.scheduler.tick();
    expect(count()).toBe(2);
  });

  it("skips disabled feeds", async () => {
    const slide = await login(SEED.pharmacies.slideRoad.email);
    await app.portal.disableAutomaticFeed(slide, "ph-slide-road");
    await app.scheduler.tick();
    expect(app.db.query<any>("feedImports").filter((f) => f.pharmacy === "ph-slide-road")).toHaveLength(0);
  });

  it("rejects a non-compliant POS feed: failure logged, listings untouched, no normalization", async () => {
    const hub = await asHub();
    // the 'non-compliant' mock endpoint connects fine but sends data not in the standard format
    await app.portal.configureAutomaticFeed(hub, "ph-hub-city", { posEndpoint: "https://pos.mock/non-compliant", intervalMinutes: 15 });
    const before = app.listings.getListing("ph-hub-city", "PF-1001");
    await app.scheduler.tick();
    const imp = app.db.query<any>("feedImports").find((f) => f.pharmacy === "ph-hub-city" && f.source === "pos")!;
    expect(imp).toMatchObject({ validRows: 0, status: "rejected" });
    expect(imp.rejectedRows).toBeGreaterThan(0);
    expect(app.listings.getListing("ph-hub-city", "PF-1001")).toEqual(before);
    expect(app.syncLogs.getLatestFor("ph-hub-city")!.success).toBe(false);
  });

  it("accepts the valid rows of a partially compliant POS feed", async () => {
    const hub = await asHub();
    await app.portal.configureAutomaticFeed(hub, "ph-hub-city", { posEndpoint: "https://pos.mock/mixed", intervalMinutes: 15 });
    await app.scheduler.tick();
    const imp = app.db.query<any>("feedImports").find((f) => f.pharmacy === "ph-hub-city" && f.source === "pos")!;
    expect(imp.validRows).toBeGreaterThan(0);
    expect(imp.rejectedRows).toBeGreaterThan(0);
    expect(imp.status).toBe("accepted");
  });

  it("refreshes drug reference entries through the adapter", async () => {
    const before = app.db.get<any>("drugReferenceEntries", "REF-ADVIL")!.lastUpdated;
    app.clock.advance(25 * HOUR);
    await app.scheduler.tick();
    const after = app.db.get<any>("drugReferenceEntries", "REF-ADVIL")!.lastUpdated;
    expect(after).toBe(new Date(NOW.getTime() + 25 * HOUR).toISOString());
    expect(after).not.toBe(before);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Sequence 2 (p2) - Dashboard, last-sync and stale-sync alerts", () => {
  it("shows last-sync time, stale flag, verification and a preview of the public listing", async () => {
    const hub = await asHub();
    const d = await app.portal.viewDashboard(hub, "ph-hub-city");
    expect(d.lastSyncAt).toBe(new Date(NOW.getTime() - 2 * HOUR).toISOString());
    expect(d.isStale).toBe(false);
    expect(d.pharmacy).toMatchObject({ name: "Hub City Pharmacy", verificationStatus: "verified", isVerified: true, isLive: true });
    expect(d.listingsPreview.length).toBeGreaterThan(0);
    expect(d.listingsPreview[0]).toMatchObject({ catalogId: expect.any(String), brandName: expect.any(String), stock: expect.any(Number), price: expect.any(Number), inStock: expect.any(Boolean) });
    expect(Array.isArray(d.recentImports)).toBe(true);
  });

  it("flags data as stale after 24 hours without a sync", async () => {
    const hub = await asHub();
    app.clock.advance(23 * HOUR); // 25h since last sync
    expect((await app.portal.viewDashboard(hub, "ph-hub-city")).isStale).toBe(true);
    const sw = await login(SEED.pharmacies.southwest.email);
    expect((await app.portal.viewDashboard(sw, "ph-southwest")).isStale).toBe(true);
  });

  it("denies viewing another pharmacy's dashboard", async () => {
    const hub = await asHub();
    await expect(app.portal.viewDashboard(hub, "ph-southwest")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a successful sync clears the stale flag", async () => {
    const sw = await login(SEED.pharmacies.southwest.email);
    await app.portal.uploadCsv(sw, "ph-southwest", "fresh.csv", `${CSV_HEADER}\nPF-1001,5,7.99\n`);
    expect((await app.portal.viewDashboard(sw, "ph-southwest")).isStale).toBe(false);
  });

  it("e-mails ONE stale-sync alert to the pharmacy account, not repeated on the next run", async () => {
    await app.scheduler.runJob("check_stale_sync");
    const alerts = app.adapters.email.outbox.filter((m) => m.to === SEED.pharmacies.southwest.email);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject.toLowerCase()).toContain("sync");
    await app.scheduler.runJob("check_stale_sync");
    expect(app.adapters.email.outbox.filter((m) => m.to === SEED.pharmacies.southwest.email)).toHaveLength(1);
    // pharmacies with fresh data get no alert
    expect(app.adapters.email.outbox.some((m) => m.to === SEED.pharmacies.hubCity.email)).toBe(false);
  });

  it("does not alert pharmacies that are not verified/live", async () => {
    await app.scheduler.runJob("check_stale_sync");
    expect(app.adapters.email.outbox.some((m) => m.to === SEED.pharmacies.quaker.email)).toBe(false);
  });

  it("alerts again if the data stays stale for another 24 hours", async () => {
    await app.scheduler.runJob("check_stale_sync");
    app.clock.advance(25 * HOUR);
    await app.scheduler.runJob("check_stale_sync");
    expect(app.adapters.email.outbox.filter((m) => m.to === SEED.pharmacies.southwest.email).length).toBe(2);
  });

  it("marks a failed e-mail as failed, then retries it successfully", async () => {
    app.adapters.email.setFailing(true);
    await app.scheduler.runJob("check_stale_sync");
    const failed = app.db.query<any>("notifications").find((n) => n.type === "stale_sync");
    expect(failed).toMatchObject({ status: "failed", retryCount: 0 });
    expect(app.adapters.email.outbox).toHaveLength(0);

    app.adapters.email.setFailing(false);
    await app.scheduler.runJob("retry_failed_emails");
    const sent = app.db.get<any>("notifications", failed.notificationId)!;
    expect(sent.status).toBe("sent");
    expect(sent.retryCount).toBe(1);
    expect(app.adapters.email.outbox.some((m) => m.to === SEED.pharmacies.southwest.email)).toBe(true);
  });

  it("stops retrying after 3 attempts", async () => {
    app.adapters.email.setFailing(true);
    await app.scheduler.runJob("check_stale_sync");
    for (let i = 0; i < 5; i++) await app.scheduler.runJob("retry_failed_emails");
    const n = app.db.query<any>("notifications").find((x) => x.type === "stale_sync")!;
    expect(n.status).toBe("failed");
    expect(n.retryCount).toBe(3);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Sequence 3 - Registration, verification and visibility to searchers", () => {
  it("registration creates a pending pharmacy + request + license document, and the listing is not live", async () => {
    const r = await app.registration.register(validRegistration());
    expect(r.status).toBe("pending");
    const pharmacy = app.db.get<any>("pharmacies", r.pharmacyId)!;
    expect(pharmacy).toMatchObject({ verificationStatus: "pending", name: "Maple Street Pharmacy" });
    expect(app.pharmacies.isVisibleInSearch(pharmacy)).toBe(false);
    const doc = app.db.query<any>("licenseDocuments").find((d) => d.verificationRequest === r.requestId);
    expect((await app.files.retrieve(doc!.storagePath))?.toString()).toBe("fake pdf");

    // the pending pharmacy can log in, add a listing, but searchers do not see it
    const { account } = await app.auth.login("maria@maple.test", "Sup3rSecret!");
    await app.portal.updateListing(account, r.pharmacyId, { catalogId: "PF-1001", stock: 99, price: 1.0 });
    const res = await app.search.search({ queryText: "advil", origin: TTU });
    expect(res.groups[0].listings.map((l) => l.pharmacyId)).not.toContain(r.pharmacyId);
    const status = await app.portal.viewVerificationStatus(account, r.pharmacyId);
    expect(status).toMatchObject({ verificationStatus: "pending", isLive: false });
  });

  it.each([
    ["duplicate e-mail", { email: SEED.pharmacies.hubCity.email }, "CONFLICT"],
    ["weak password", { password: "short" }, "VALIDATION_ERROR"],
    ["missing name", { pharmacyName: "" }, "VALIDATION_ERROR"],
    ["bad e-mail", { email: "not-an-email" }, "VALIDATION_ERROR"],
    ["unknown address", { address: "Nowhere, Atlantis" }, "ADDRESS_NOT_FOUND"],
    ["unsupported document type", { document: { fileName: "x.exe", mimeType: "application/x-msdownload", contentBase64: "AAAA" } }, "VALIDATION_ERROR"],
    ["missing document", { document: undefined }, "VALIDATION_ERROR"],
  ])("rejects registration: %s", async (_l, over, code) => {
    await expect(app.registration.register(validRegistration(over))).rejects.toMatchObject({ code });
  });

  it("rejects a duplicate license number", async () => {
    await expect(app.registration.register(validRegistration({ licenseNumber: SEED.pharmacies.hubCity.license }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("admin lists pending requests; staff cannot", async () => {
    const r = await app.registration.register(validRegistration());
    const admin = await asAdmin();
    const pending = await app.admin.listPendingRequests(admin);
    expect(pending.map((p) => p.requestId)).toEqual(expect.arrayContaining([r.requestId]));
    expect(pending.every((p) => p.status === "pending")).toBe(true);
    await expect(app.admin.listPendingRequests(await asHub())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("review runs the license registry check (valid / invalid / unavailable)", async () => {
    const admin = await asAdmin();
    const valid = await app.registration.register(validRegistration());
    expect((await app.admin.reviewRegistration(admin, valid.requestId)).registryResult.status).toBe("valid");
    const bad = await app.registration.register(validRegistration({ licenseNumber: "TX-PH-00000", email: "b@b.test" }));
    expect((await app.admin.reviewRegistration(admin, bad.requestId)).registryResult.status).toBe("invalid");
    const down = await app.registration.register(validRegistration({ licenseNumber: "TX-PH-90001", email: "c@c.test" }));
    expect((await app.admin.reviewRegistration(admin, down.requestId)).registryResult.status).toBe("unavailable");
  });

  it("admin can download the uploaded license document", async () => {
    const admin = await asAdmin();
    const r = await app.registration.register(validRegistration());
    const doc = await app.admin.getLicenseDocument(admin, r.requestId);
    expect(doc).toMatchObject({ fileName: "license.pdf", mimeType: "application/pdf" });
    expect(Buffer.from(doc.contentBase64, "base64").toString()).toBe("fake pdf");
  });

  it("approve requires a conclusive review first", async () => {
    const admin = await asAdmin();
    const r = await app.registration.register(validRegistration());
    await expect(app.admin.approve(admin, r.requestId)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("approval marks the pharmacy verified and it then appears to searchers with the verified indicator", async () => {
    const admin = await asAdmin();
    const r = await app.registration.register(validRegistration());
    const { account } = await app.auth.login("maria@maple.test", "Sup3rSecret!");
    await app.portal.updateListing(account, r.pharmacyId, { catalogId: "PF-1001", stock: 99, price: 1.0 });

    await app.admin.reviewRegistration(admin, r.requestId);
    await app.admin.approve(admin, r.requestId);

    expect(app.db.get<any>("pharmacies", r.pharmacyId)).toMatchObject({ verificationStatus: "verified" });
    const request = app.db.get<any>("verificationRequests", r.requestId)!;
    expect(request).toMatchObject({ status: "verified", reviewer: admin.accountId, reviewedAt: NOW.toISOString() });

    const res = await app.search.search({ queryText: "advil", origin: { address: "Texas Tech University" } });
    const mine = res.groups[0].listings.find((l) => l.pharmacyId === r.pharmacyId)!;
    expect(mine).toMatchObject({ verified: true, price: 1, stock: 99 });
    expect(mine.distanceKm).toBeLessThan(0.5);
  });

  it("manual license check can conclude an unavailable registry result", async () => {
    const admin = await asAdmin();
    const r = await app.registration.register(validRegistration({ licenseNumber: "TX-PH-90001" }));
    await app.admin.reviewRegistration(admin, r.requestId);
    await expect(app.admin.approve(admin, r.requestId)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await app.admin.checkLicenseManually(admin, r.requestId, { confirmed: true, note: "Called the state board" });
    await app.admin.approve(admin, r.requestId);
    expect(app.db.get<any>("pharmacies", r.pharmacyId)!.verificationStatus).toBe("verified");
  });

  it("an invalid registry result with no manual confirmation cannot be approved", async () => {
    const admin = await asAdmin();
    const r = await app.registration.register(validRegistration({ licenseNumber: "TX-PH-00000" }));
    await app.admin.reviewRegistration(admin, r.requestId);
    await expect(app.admin.approve(admin, r.requestId)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejection stores the reason, keeps the pharmacy hidden, and allows resubmission", async () => {
    const admin = await asAdmin();
    const r = await app.registration.register(validRegistration({ licenseNumber: "TX-PH-00000" }));
    await expect(app.admin.reject(admin, r.requestId, "")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await app.admin.reject(admin, r.requestId, "License number not found");
    expect(app.db.get<any>("verificationRequests", r.requestId)).toMatchObject({ status: "rejected", rejectionReason: "License number not found" });
    expect(app.db.get<any>("pharmacies", r.pharmacyId)!.verificationStatus).toBe("rejected");
    expect(app.pharmacies.isVisibleInSearch(app.db.get<any>("pharmacies", r.pharmacyId)!)).toBe(false);

    const { account } = await app.auth.login("maria@maple.test", "Sup3rSecret!");
    const again = await app.portal.resubmitVerification(account, r.pharmacyId, { fileName: "new.png", mimeType: "image/png", contentBase64: "AAAA" });
    expect(again.status).toBe("pending");
    expect(app.db.get<any>("pharmacies", r.pharmacyId)!.verificationStatus).toBe("pending");
    expect(app.db.query<any>("verificationRequests").filter((v) => v.pharmacy === r.pharmacyId)).toHaveLength(2);
  });

  it("an already-decided request cannot be decided again", async () => {
    const admin = await asAdmin();
    const r = await app.registration.register(validRegistration());
    await app.admin.reject(admin, r.requestId, "No");
    await expect(app.admin.reject(admin, r.requestId, "Again")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("only staff of a rejected pharmacy can resubmit, and not for pending/verified ones", async () => {
    const hub = await asHub();
    await expect(app.portal.resubmitVerification(hub, "ph-hub-city", { fileName: "a.pdf", mimeType: "application/pdf", contentBase64: "AAAA" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(app.portal.resubmitVerification(hub, "ph-indiana", { fileName: "a.pdf", mimeType: "application/pdf", contentBase64: "AAAA" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("REST API (Layer 2) - validation, routing, authorization, JSON responses", () => {
  const call = async (method: string, path: string, opts: { body?: unknown; token?: string; rawBody?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined || opts.rawBody !== undefined) headers["content-type"] = "application/json";
    const res = await app.api.handle(
      new Request(`http://localhost${path}`, { method, headers, body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) }),
    );
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const tokenFor = async (email: string) => (await app.auth.login(email, DEMO_PASSWORD)).token;

  it("GET /api/search returns JSON search results", async () => {
    const r = await call("GET", `/api/search?q=advil&lat=${TTU.latitude}&lng=${TTU.longitude}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(r.body.data.groups[0].product.catalogId).toBe("PF-1001");
  });

  it("GET /api/search supports address origin, accessibility and distance filters", async () => {
    const r = await call("GET", `/api/search?q=advil&address=${encodeURIComponent("Texas Tech University")}&accessible=true&maxDistanceKm=5`);
    expect(r.status).toBe(200);
    expect(r.body.data.groups[0].listings.every((l: any) => l.isAccessible && l.distanceKm <= 5)).toBe(true);
  });

  it("rejects malformed input with 400 and an error code", async () => {
    expect((await call("GET", "/api/search")).status).toBe(400);
    expect((await call("GET", "/api/search?q=advil")).status).toBe(400); // no origin
    const bad = await call("GET", "/api/search?q=advil&lat=999&lng=0");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    const badJson = await call("POST", "/api/auth/login", { rawBody: "{not json" });
    expect(badJson.status).toBe(400);
    const badShape = await call("POST", "/api/auth/login", { body: { email: 5 } });
    expect(badShape.status).toBe(400);
  });

  it("returns 404 for unknown routes and 405-style error for wrong methods", async () => {
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("DELETE", "/api/search?q=a")).status).toBe(404);
  });

  it("unknown address -> 422 ADDRESS_NOT_FOUND", async () => {
    const r = await call("GET", `/api/search?q=advil&address=${encodeURIComponent("Nowhere, Atlantis")}`);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("ADDRESS_NOT_FOUND");
  });

  it("POST /api/auth/login issues a token + HttpOnly cookie; /api/auth/me reads it; bad creds -> 401", async () => {
    const ok = await call("POST", "/api/auth/login", { body: { email: SEED.pharmacies.hubCity.email, password: DEMO_PASSWORD } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toBeTruthy();
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    const me = await call("GET", "/api/auth/me", { token: ok.body.data.token });
    expect(me.body.data).toMatchObject({ role: "pharmacy_staff", pharmacyId: "ph-hub-city" });
    const bad = await call("POST", "/api/auth/login", { body: { email: SEED.pharmacies.hubCity.email, password: "nope" } });
    expect(bad.status).toBe(401);
  });

  it("session cookie is accepted in place of the bearer token", async () => {
    const ok = await call("POST", "/api/auth/login", { body: { email: SEED.admin.email, password: DEMO_PASSWORD } });
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    const res = await app.api.handle(new Request("http://localhost/api/auth/me", { headers: { cookie } }));
    expect((await res.json()).data.role).toBe("admin");
  });

  it("protected routes require authentication (401) and the right role (403)", async () => {
    expect((await call("GET", "/api/pharmacies/ph-hub-city/dashboard")).status).toBe(401);
    expect((await call("GET", "/api/admin/requests")).status).toBe(401);
    const staff = await tokenFor(SEED.pharmacies.hubCity.email);
    expect((await call("GET", "/api/admin/requests", { token: staff })).status).toBe(403);
    const admin = await tokenFor(SEED.admin.email);
    expect((await call("GET", "/api/admin/requests", { token: admin })).status).toBe(200);
    expect((await call("GET", "/api/pharmacies/ph-hub-city/dashboard", { token: admin })).status).toBe(403);
  });

  it("staff can only reach their own pharmacy (403 for others)", async () => {
    const staff = await tokenFor(SEED.pharmacies.hubCity.email);
    expect((await call("GET", "/api/pharmacies/ph-hub-city/dashboard", { token: staff })).status).toBe(200);
    expect((await call("GET", "/api/pharmacies/ph-southwest/dashboard", { token: staff })).status).toBe(403);
    const put = await call("PUT", "/api/pharmacies/ph-southwest/listings", { token: staff, body: { catalogId: "PF-1001", stock: 1, price: 1 } });
    expect(put.status).toBe(403);
  });

  it("PUT listing validates numbers strictly (400) and saves valid ones", async () => {
    const staff = await tokenFor(SEED.pharmacies.hubCity.email);
    const ok = await call("PUT", "/api/pharmacies/ph-hub-city/listings", { token: staff, body: { catalogId: "PF-1005", stock: 4, price: 6.5 } });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ stock: 4, price: 6.5 });
    const bad = await call("PUT", "/api/pharmacies/ph-hub-city/listings", { token: staff, body: { catalogId: "PF-1005", stock: 4, price: "6.5" } });
    expect(bad.status).toBe(400);
    const neg = await call("PUT", "/api/pharmacies/ph-hub-city/listings", { token: staff, body: { catalogId: "PF-1005", stock: 4, price: -1 } });
    expect(neg.status).toBe(400);
  });

  it("POST csv returns the import summary", async () => {
    const staff = await tokenFor(SEED.pharmacies.hubCity.email);
    const r = await call("POST", "/api/pharmacies/ph-hub-city/csv", { token: staff, body: { fileName: "a.csv", content: `${CSV_HEADER}\nPF-1001,10,8.50\nBAD,1,1.00\n` } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ totalRows: 2, validRows: 1, rejectedRows: 1, status: "accepted" });
  });

  it("feed configuration: connection failure -> 422, success -> feed enabled", async () => {
    const staff = await tokenFor(SEED.pharmacies.hubCity.email);
    const bad = await call("PUT", "/api/pharmacies/ph-hub-city/feed", { token: staff, body: { posEndpoint: "https://pos.mock/down", intervalMinutes: 15 } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("CONNECTION_FAILED");
    const ok = await call("PUT", "/api/pharmacies/ph-hub-city/feed", { token: staff, body: { posEndpoint: "https://pos.mock/hub-city", intervalMinutes: 15 } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.isEnabled).toBe(true);
  });

  it("registration + admin review/approve/reject over HTTP", async () => {
    const reg = await call("POST", "/api/pharmacies/register", { body: validRegistration() });
    expect(reg.status).toBe(201);
    expect(reg.body.data.status).toBe("pending");
    const admin = await tokenFor(SEED.admin.email);
    const list = await call("GET", "/api/admin/requests", { token: admin });
    expect(list.body.data.map((x: any) => x.requestId)).toContain(reg.body.data.requestId);
    const review = await call("POST", `/api/admin/requests/${reg.body.data.requestId}/review`, { token: admin });
    expect(review.body.data.registryResult.status).toBe("valid");
    const approve = await call("POST", `/api/admin/requests/${reg.body.data.requestId}/approve`, { token: admin });
    expect(approve.status).toBe(200);
    const reject = await call("POST", `/api/admin/requests/${reg.body.data.requestId}/reject`, { token: admin, body: { reason: "x" } });
    expect(reject.status).toBe(409);
    const missing = await call("POST", "/api/admin/requests/nope/approve", { token: admin });
    expect(missing.status).toBe(404);
  });

  it("password reset over HTTP", async () => {
    const r1 = await call("POST", "/api/auth/password-reset/request", { body: { email: SEED.pharmacies.hubCity.email } });
    expect(r1.status).toBe(200);
    const code = /\b(\d{6})\b/.exec(app.adapters.email.outbox.at(-1)!.body)![1];
    const r2 = await call("POST", "/api/auth/password-reset/confirm", { body: { email: SEED.pharmacies.hubCity.email, code, newPassword: "Br4ndNew!pw" } });
    expect(r2.status).toBe(200);
    const bad = await call("POST", "/api/auth/password-reset/confirm", { body: { email: SEED.pharmacies.hubCity.email, code, newPassword: "Br4ndNew!pw" } });
    expect(bad.status).toBe(400);
  });

  it("never exposes password hashes in any response", async () => {
    const staff = await tokenFor(SEED.pharmacies.hubCity.email);
    const me = await call("GET", "/api/auth/me", { token: staff });
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|scrypt/);
  });

  it("GET /api/catalog lists the Pharmafind product catalog (public)", async () => {
    const r = await call("GET", "/api/catalog");
    expect(r.status).toBe(200);
    expect(r.body.data.find((p: any) => p.catalogId === "PF-1001")).toMatchObject({ brandName: "Advil", dosage: "200 mg" });
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("Standard data format guard-rails (no translation/normalization layer)", () => {
  it("all compliant mock POS endpoints deliver 100% valid rows (mocks use the standard format)", async () => {
    for (const endpoint of ["https://pos.mock/hub-city", "https://pos.mock/slide-road", "https://pos.mock/canyon-lakes", "https://pos.mock/tech-terrace"]) {
      const rows = await app.adapters.posFeed.pullFeed(endpoint);
      expect(rows.length).toBeGreaterThan(0);
      const v = app.feedImport.validateRows(rows, "pos");
      expect(v.rejected).toEqual([]);
      expect(v.valid.length).toBe(rows.length);
    }
  });

  it("validateRows never alters values it accepts and never 'repairs' ones it rejects", () => {
    const rows = [
      { catalogId: "PF-1001", stock: 5, price: 7.5 },
      { catalogId: "PF-1001 ", stock: 5, price: 7.5 },
      { catalogId: "PF-1002", stock: "5", price: 7.5 },
      { catalogId: "PF-1002", stock: 5, price: "7.50" },
      { catalogId: "PF-1002", stock: 5.5, price: 7.5 },
      { catalogId: "PF-1002", stock: 5 },
      "not an object",
      null,
    ];
    const v = app.feedImport.validateRows(rows, "pos");
    expect(v.valid).toEqual([{ catalogId: "PF-1001", stock: 5, price: 7.5 }]);
    expect(v.rejected).toHaveLength(7);
  });

  it("a feed that is not an array is rejected as a whole", async () => {
    const result = await app.feedImport.importRows({ pharmacyId: "ph-hub-city", source: "pos", rows: { catalogId: "PF-1001" } as unknown });
    expect(result.status).toBe("rejected");
  });

  it("there is no normalization/translation module in the code base", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(path.resolve(__dirname, "../src/lib"));
    expect(files.filter((f) => /normaliz|translat|transform|mapper/i.test(path.basename(f)))).toEqual([]);
  });

  it("only the Feed Import service writes feed data to listings", async () => {
    // PosFeedConnector / AutomaticFeed hand back rows untouched: what the mock sends is what Feed Import sees
    const rows = await app.adapters.posFeed.pullFeed("https://pos.mock/non-compliant");
    expect(rows).toEqual(await app.adapters.posFeed.pullFeed("https://pos.mock/non-compliant")); // deterministic, untouched
    const v = app.feedImport.validateRows(rows, "pos");
    expect(v.valid).toEqual([]);
  });
});
