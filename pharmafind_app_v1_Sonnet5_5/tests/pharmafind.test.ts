/**
 * PHARMAFIND TEST SUITE  (run with:  npm test   ->   vitest run tests/pharmafind.test.ts)
 *
 * Written FIRST (TDD): these tests define the expected behaviour taken from the requirements document,
 * the class diagram and the sequence diagrams. The implementation in src/ was built afterwards to satisfy them.
 *
 * Conventions
 *  - The whole backend (REST API -> services -> mock DB / file storage / mock adapters) runs in-process via createApp().
 *  - The clock is fixed at T0 so every time rule (24 h freshness, token expiry...) is deterministic.
 *  - Data from POS feeds / CSV is assumed to already use Pharmafind's standard format + catalog IDs:
 *    Feed Import only VALIDATES it (rejecting bad rows); nothing is parsed, trimmed, converted or normalised.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createApp, type App } from "../src/lib/app";
import { Clock } from "../src/lib/clock";
import { RelationalDbGeo } from "../src/lib/db";
import { FileStorage } from "../src/lib/fileStorage";
import { haversineKm } from "../src/lib/geo";
import { hashPassword, verifyPassword, signToken, verifyToken } from "../src/lib/security";
import { DEMO_PASSWORD } from "../src/lib/seed";

const T0 = new Date("2026-03-10T15:00:00.000Z");
const HOUR = 3_600_000;
const MIN = 60_000;
const TTU = { lat: "33.5843", lng: "-101.8783" }; // search origin used in most tests (Lubbock demo city)

type Opts = { query?: Record<string, string>; body?: unknown; token?: string };
let app: App;

beforeEach(() => {
  app = createApp({ now: T0, sessionSecret: "test-secret" });
});

async function call(method: string, path: string, o: Opts = {}) {
  const res = await app.api.handle({ method, path, query: o.query ?? {}, body: o.body, token: o.token });
  return res as { status: number; body: any; setSession?: { token?: string; maxAgeSec?: number; clear?: boolean } };
}
async function login(email: string, password = DEMO_PASSWORD): Promise<string> {
  const r = await call("POST", "/api/auth/login", { body: { email, password } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.setSession!.token!;
}
const staff = (slug: string) => login(`${slug}@pharmafind.demo`);
const admin = () => login("admin@pharmafind.demo");
const search = (query: Record<string, string>) => call("GET", "/api/search", { query: { lat: TTU.lat, lng: TTU.lng, ...query } });
const csv = (...rows: string[]) => ["catalogId,stock,price", ...rows].join("\n") + "\n";
const listingOf = (pharmacyId: string, catalogId: string) => app.db.get<any>("listings", `lst-${pharmacyId}-${catalogId}`);
const pharmacyIds = (res: any) => res.body.data.results.map((g: any) => g.pharmacy.pharmacyId as string);
const lastMail = () => app.adapters.email.outbox[app.adapters.email.outbox.length - 1];
const codeFromMail = () => /\b(\d{6})\b/.exec(lastMail().body)![1];

const license = { fileName: "license.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.4 demo license").toString("base64") };
const registration = (over: Record<string, unknown> = {}) => ({
  pharmacyName: "Maple Street Pharmacy",
  licenseNumber: "TX-5550101",
  phone: "(806) 555-0142",
  address: "Texas Tech University",
  city: "Lubbock",
  isAccessible: true,
  fullName: "Maria Lopez",
  email: "maria@maple.example",
  password: "Maple!Pass1",
  license,
  ...over,
});

/* ===================================================================================================
 * LAYER 4 - data and system services (mock DB with geo, file storage, clock, security helpers)
 * =================================================================================================*/
describe("Clock", () => {
  it("is fixed at the given start and advances only when told to", () => {
    const c = new Clock(T0);
    expect(c.now().getTime()).toBe(T0.getTime());
    c.advance(25 * HOUR);
    expect(c.now().getTime()).toBe(T0.getTime() + 25 * HOUR);
    expect(c.offsetMs).toBe(25 * HOUR);
    c.reset();
    expect(c.now().getTime()).toBe(T0.getTime());
  });
  it("without a fixed start it follows real time plus the offset", () => {
    const c = new Clock();
    expect(Math.abs(c.now().getTime() - Date.now())).toBeLessThan(1000);
    c.advance(HOUR);
    expect(c.now().getTime() - Date.now()).toBeGreaterThan(HOUR - 1000);
  });
});

describe("RelationalDbGeo (mock)", () => {
  it("saves, gets, queries and deletes records and hands out unique ids", () => {
    const db = new RelationalDbGeo();
    db.save("things", "a", { id: "a", n: 1 });
    db.save("things", "b", { id: "b", n: 2 });
    expect(db.get<any>("things", "a")?.n).toBe(1);
    expect(db.query<any>("things", (t) => t.n > 1).map((t) => t.id)).toEqual(["b"]);
    expect(db.query("things")).toHaveLength(2);
    db.delete("things", "a");
    expect(db.get("things", "a")).toBeUndefined();
    expect(db.nextId("x")).not.toBe(db.nextId("x"));
  });
  it("returns copies so callers cannot mutate stored rows by accident", () => {
    const db = new RelationalDbGeo();
    db.save("things", "a", { id: "a", n: 1 });
    db.get<any>("things", "a")!.n = 99;
    expect(db.get<any>("things", "a")!.n).toBe(1);
  });
  it("geoQuery returns the great-circle distance in km", () => {
    const db = new RelationalDbGeo();
    expect(db.geoQuery({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111.19, 1);
    expect(haversineKm({ latitude: 33.5, longitude: -101.8 }, { latitude: 33.5, longitude: -101.8 })).toBe(0);
  });
});

describe("FileStorage (mock)", () => {
  it("stores, retrieves and removes files, sanitising the file name", () => {
    const fs = new FileStorage();
    const p = fs.store("license-documents", "../../evil name.pdf", Buffer.from("hello"));
    expect(p.startsWith("license-documents/")).toBe(true);
    expect(p).not.toContain("..");
    expect(fs.retrieve(p).toString()).toBe("hello");
    fs.remove(p);
    expect(() => fs.retrieve(p)).toThrow();
  });
});

describe("security helpers", () => {
  it("hashes passwords with a random salt and verifies them", () => {
    const h1 = hashPassword("Secret123!");
    const h2 = hashPassword("Secret123!");
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain("Secret123!");
    expect(verifyPassword("Secret123!", h1)).toBe(true);
    expect(verifyPassword("secret123!", h1)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });
  it("signs tokens and rejects tampered or foreign-secret tokens", () => {
    const t = signToken({ sub: "acc-1", iat: 1, exp: 2 }, "s1");
    expect(verifyToken(t, "s1")).toMatchObject({ sub: "acc-1" });
    expect(verifyToken(t, "other")).toBeNull();
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "acc-admin", iat: 1, exp: 2 })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, "s1")).toBeNull();
    expect(verifyToken(`${payload}.`, "s1")).toBeNull();
    expect(verifyToken("nonsense", "s1")).toBeNull();
  });
});

/* ===================================================================================================
 * Mock integration adapters (Layer 4) - all use Pharmafind's standard format and catalog IDs
 * =================================================================================================*/
describe("integration adapters (mocks)", () => {
  it("geocoding adapter resolves known addresses and fails on unknown ones", async () => {
    const g = await app.adapters.geocoding.geocode("Texas Tech University");
    expect(g.latitude).toBeCloseTo(33.58, 1);
    await expect(app.adapters.geocoding.geocode("Nowhere Land 123")).rejects.toThrow();
  });
  it("directions adapter builds a route link", () => {
    const url = app.adapters.directions.getRouteLink({ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 });
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("1");
    expect(url).toContain("4");
  });
  it("drug reference adapter returns entries and can search by name", async () => {
    const e = await app.adapters.drugReference.fetchEntry("ref-ibuprofen");
    expect(e.genericName.toLowerCase()).toBe("ibuprofen");
    expect((await app.adapters.drugReference.searchByName("amox")).length).toBeGreaterThan(0);
  });
  it("license check adapter validates against the mock registry", async () => {
    expect((await app.adapters.licenseCheck.checkLicense("TX-1048231")).found).toBe(true);
    expect((await app.adapters.licenseCheck.checkLicense("TX-0000000")).found).toBe(false);
  });
  it("email adapter records sent mail and can be told to fail", async () => {
    await app.adapters.email.sendEmail({ to: "a@b.c", subject: "s", body: "b" });
    expect(app.adapters.email.outbox).toHaveLength(1);
    app.adapters.email.failing = true;
    await expect(app.adapters.email.sendEmail({ to: "a@b.c", subject: "s", body: "b" })).rejects.toThrow();
    expect(app.adapters.email.outbox).toHaveLength(1);
  });
  it("POS connector pulls standard-format rows and tests connections", async () => {
    const ep = "https://hubcity.demo-pos.example/feed";
    expect((await app.adapters.posFeed.testConnection(ep)).ok).toBe(true);
    expect((await app.adapters.posFeed.testConnection("https://nowhere.invalid/feed")).ok).toBe(false);
    const rows = (await app.adapters.posFeed.pullFeed(ep)) as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toEqual({ catalogId: expect.stringMatching(/^PF-\d{5}$/), stock: expect.any(Number), price: expect.any(Number) });
  });
});

/* ===================================================================================================
 * Product catalog + drug reference (Layer 3)
 * =================================================================================================*/
describe("Product catalog", () => {
  it("every product uses a standard catalog id and links to a drug reference entry", () => {
    const products = app.services.catalog.listProducts();
    expect(products.length).toBeGreaterThanOrEqual(10);
    for (const p of products) {
      expect(p.catalogId).toMatch(/^PF-\d{5}$/);
      expect(app.db.get("drugReferenceEntries", p.reference)).toBeTruthy();
    }
  });
  it("matchesName finds brand or generic names, case-insensitively, one product per presentation", () => {
    const ibu = app.services.catalog.matchByName("IBUPROFEN");
    expect(ibu.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ibu.map((p) => p.presentation)).size).toBeGreaterThanOrEqual(2);
    expect(app.services.catalog.matchByName("advil").every((p) => p.brandName === "Advil")).toBe(true);
    expect(app.services.catalog.matchByName("zzzz-not-a-drug")).toEqual([]);
  });
  it("refreshing from the drug reference updates entries and survives adapter failure", async () => {
    app.clock.advance(2 * HOUR);
    expect(await app.services.catalog.refreshAllFromReference()).toBeGreaterThan(0);
    expect(app.db.get<any>("drugReferenceEntries", "ref-ibuprofen").lastUpdated).toBe(app.clock.iso());
    app.adapters.drugReference.available = false;
    expect(await app.services.catalog.refreshAllFromReference()).toBe(0);
  });
});

/* ===================================================================================================
 * Search and Compare  (requirements: Consumer Search 1-pager; sequence diagrams 1 part 1 & 2)
 * =================================================================================================*/
describe("Consumer search", () => {
  it("returns pharmacies stocking the medicine ranked by distance, nearest first, without logging in", async () => {
    const r = await search({ q: "ibuprofen" });
    expect(r.status).toBe(200);
    const groups = r.body.data.results;
    expect(groups.length).toBeGreaterThanOrEqual(5);
    const d = groups.map((g: any) => g.pharmacy.distanceKm);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(groups[0].pharmacy.pharmacyId).toBe("ph-raider");
  });
  it("each result shows pharmacy name, stock status, price and presentation at a glance", async () => {
    const r = await search({ q: "ibuprofen" });
    const g = r.body.data.results[0];
    expect(g.pharmacy).toMatchObject({ name: expect.any(String), address: expect.any(String), phone: expect.any(String), isVerified: true });
    expect(g.pharmacy.directionsUrl).toMatch(/^https:\/\//);
    for (const it of g.items) {
      expect(it).toMatchObject({
        listingId: expect.any(String),
        brandName: expect.any(String),
        genericName: expect.any(String),
        presentation: expect.any(String),
        dosage: expect.any(String),
        stock: expect.any(Number),
        stockStatus: expect.stringMatching(/^(in_stock|low_stock)$/),
        price: expect.any(Number),
        lastUpdated: expect.any(String),
        ageMinutes: expect.any(Number),
        isStale: expect.any(Boolean),
      });
    }
  });
  it("shows one line per presentation instead of a single yes/no (tablet vs. suspension, strengths)", async () => {
    const r = await search({ q: "ibuprofen" });
    const hub = r.body.data.results.find((g: any) => g.pharmacy.pharmacyId === "ph-hubcity");
    expect(hub.items.length).toBe(3);
    expect(new Set(hub.items.map((i: any) => `${i.presentation}|${i.dosage}`)).size).toBe(3);
  });
  it("matches generic and brand names, case-insensitively", async () => {
    const a = await search({ q: "ADVIL" });
    const b = await search({ q: "ibuprofen" });
    expect(a.body.data.results.length).toBeGreaterThan(0);
    expect(a.body.data.results.flatMap((g: any) => g.items).every((i: any) => i.brandName === "Advil")).toBe(true);
    expect(b.body.data.results.flatMap((g: any) => g.items).length).toBeGreaterThan(a.body.data.results.flatMap((g: any) => g.items).length);
  });
  it("only verified pharmacies appear (pending listings stay hidden)", async () => {
    const r = await search({ q: "ibuprofen" });
    expect(pharmacyIds(r)).not.toContain("ph-newleaf");
    expect(listingOf("ph-newleaf", "PF-10001")).toBeTruthy(); // the data exists, it just is not public
  });
  it("hides out-of-stock listings by default and labels them when asked", async () => {
    const dflt = await search({ q: "ibuprofen" });
    expect(dflt.body.data.results.flatMap((g: any) => g.items).some((i: any) => i.stock === 0)).toBe(false);
    const all = await search({ q: "ibuprofen", includeOutOfStock: "true" });
    const out = all.body.data.results.flatMap((g: any) => g.items).filter((i: any) => i.stockStatus === "out_of_stock");
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.every((i: any) => i.stock === 0)).toBe(true);
  });
  it("flags low stock", async () => {
    const r = await search({ q: "tylenol" });
    const raider = r.body.data.results.find((g: any) => g.pharmacy.pharmacyId === "ph-raider");
    expect(raider.items.find((i: any) => i.catalogId === "PF-10005").stockStatus).toBe("low_stock");
  });
  it("returns the wheelchair-accessibility data when known and filters on it when requested", async () => {
    const r = await search({ q: "ibuprofen" });
    const flags = Object.fromEntries(r.body.data.results.map((g: any) => [g.pharmacy.pharmacyId, g.pharmacy.isAccessible]));
    expect(flags["ph-raider"]).toBe(true);
    expect(flags["ph-depot"]).toBe(false);
    expect(flags["ph-southside"]).toBeNull(); // no accessibility data -> no flag
    const acc = await search({ q: "ibuprofen", needsAccessibleAccess: "true" });
    expect(pharmacyIds(acc).sort()).toEqual(["ph-hubcity", "ph-raider", "ph-westgate"]);
  });
  it("honours maxDistanceKm", async () => {
    const r = await search({ q: "ibuprofen", maxDistanceKm: "1" });
    expect(pharmacyIds(r)).toEqual(["ph-raider"]);
  });
  it("accepts a typed address instead of GPS coordinates (geocoded)", async () => {
    const r = await call("GET", "/api/search", { query: { q: "ibuprofen", address: "Texas Tech University" } });
    expect(r.status).toBe(200);
    expect(r.body.data.origin.latitude).toBeCloseTo(33.58, 1);
    expect(r.body.data.results[0].pharmacy.pharmacyId).toBe("ph-raider");
  });
  it("answers with a clear error when the address cannot be found", async () => {
    const r = await call("GET", "/api/search", { query: { q: "ibuprofen", address: "Nowhere Land 123" } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });
  it("returns an empty list (not an error) when no pharmacy has the medicine", async () => {
    const r = await search({ q: "unobtainium" });
    expect(r.status).toBe(200);
    expect(r.body.data.results).toEqual([]);
  });
  it("rejects malformed input", async () => {
    expect((await search({ q: "" })).status).toBe(400);
    expect((await search({ q: "a" })).status).toBe(400);
    expect((await search({ q: "x".repeat(101) })).status).toBe(400);
    expect((await call("GET", "/api/search", { query: { q: "ibuprofen" } })).status).toBe(400); // no location at all
    expect((await search({ q: "ibuprofen", lat: "abc" })).status).toBe(400);
    expect((await search({ q: "ibuprofen", lat: "123" })).status).toBe(400);
    expect((await search({ q: "ibuprofen", maxDistanceKm: "-3" })).status).toBe(400);
  });
  it("records each search", async () => {
    await search({ q: "ibuprofen", needsAccessibleAccess: "true" });
    const rec = app.db.query<any>("searches");
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ queryText: "ibuprofen", needsAccessibleAccess: true });
  });
});

describe("Data recency (24 h rule) in search results", () => {
  it("shows no stale label for data up to 24 h old and a last-updated age for every result", async () => {
    const r = await search({ q: "ibuprofen" });
    const raider = r.body.data.results.find((g: any) => g.pharmacy.pharmacyId === "ph-raider");
    for (const it of raider.items) {
      expect(it.isStale).toBe(false);
      expect(it.ageMinutes).toBe(5 * 60);
      expect(it.lastUpdated).toBe(new Date(T0.getTime() - 5 * HOUR).toISOString());
    }
  });
  it("labels data older than 24 h as stale but still shows it", async () => {
    const r = await search({ q: "ibuprofen" });
    const west = r.body.data.results.find((g: any) => g.pharmacy.pharmacyId === "ph-westgate");
    expect(west).toBeTruthy();
    expect(west.items[0].isStale).toBe(true);
    expect(west.items[0].ageMinutes).toBe(30 * 60);
  });
  it("exactly 24 h is still fresh; one minute more is stale", async () => {
    app.db.save("listings", "lst-ph-raider-PF-10001", { ...listingOf("ph-raider", "PF-10001"), lastUpdated: new Date(T0.getTime() - 24 * HOUR).toISOString() });
    let r = await search({ q: "advil" });
    let it = r.body.data.results.find((g: any) => g.pharmacy.pharmacyId === "ph-raider").items.find((i: any) => i.catalogId === "PF-10001");
    expect(it.isStale).toBe(false);
    app.clock.advance(MIN);
    r = await search({ q: "advil" });
    it = r.body.data.results.find((g: any) => g.pharmacy.pharmacyId === "ph-raider").items.find((i: any) => i.catalogId === "PF-10001");
    expect(it.isStale).toBe(true);
  });
  it("REGRESSION - after the demo clock is advanced, the age shown by the server grows together with the stale flag", async () => {
    const before = await search({ q: "ibuprofen" });
    const rBefore = before.body.data.results.find((g: any) => g.pharmacy.pharmacyId === "ph-raider").items[0];
    expect(rBefore.ageMinutes).toBe(5 * 60);
    app.clock.advance(25 * HOUR);
    const after = await search({ q: "ibuprofen" });
    const rAfter = after.body.data.results.find((g: any) => g.pharmacy.pharmacyId === "ph-raider").items[0];
    expect(rAfter.isStale).toBe(true);
    expect(rAfter.ageMinutes).toBe(30 * 60); // 5 h + 25 h, so the "N h ago" text can never contradict the flag
    expect(rAfter.ageMinutes).toBeGreaterThan(24 * 60);
    expect(after.body.serverNow).toBe(new Date(T0.getTime() + 25 * HOUR).toISOString());
  });
  it("every result is stale iff its age exceeds 24 h (consistency invariant)", async () => {
    for (const h of [0, 10, 19, 20, 100]) {
      app.clock.reset();
      app.clock.advance(h * HOUR);
      const r = await search({ q: "a" + "d" });
      for (const it of r.body.data.results.flatMap((g: any) => g.items)) expect(it.isStale).toBe(it.ageMinutes > 24 * 60);
    }
  });
});

/* ===================================================================================================
 * Authentication, roles and own-pharmacy access control  (Access and Authentication, Layer 2)
 * =================================================================================================*/
describe("Authentication", () => {
  it("logs in with valid credentials and starts an HttpOnly-cookie session", async () => {
    const r = await call("POST", "/api/auth/login", { body: { email: "hubcity@pharmafind.demo", password: DEMO_PASSWORD } });
    expect(r.status).toBe(200);
    expect(r.body.data.account).toMatchObject({ email: "hubcity@pharmafind.demo", role: "pharmacy_staff", pharmacyId: "ph-hubcity" });
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|scrypt/);
    expect(r.setSession?.token).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toContain(r.setSession!.token!);
    expect(r.setSession?.maxAgeSec).toBe(12 * 3600);
  });
  it("gives the same generic error for a wrong password and an unknown account", async () => {
    const a = await call("POST", "/api/auth/login", { body: { email: "hubcity@pharmafind.demo", password: "wrong-pass-1" } });
    const b = await call("POST", "/api/auth/login", { body: { email: "nobody@pharmafind.demo", password: "wrong-pass-1" } });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });
  it("locks an account for a while after 5 failed attempts, even for the right password", async () => {
    for (let i = 0; i < 5; i++) await call("POST", "/api/auth/login", { body: { email: "plains@pharmafind.demo", password: "wrong-pass-1" } });
    const locked = await call("POST", "/api/auth/login", { body: { email: "plains@pharmafind.demo", password: DEMO_PASSWORD } });
    expect(locked.status).toBe(429);
    app.clock.advance(16 * MIN);
    const ok = await call("POST", "/api/auth/login", { body: { email: "plains@pharmafind.demo", password: DEMO_PASSWORD } });
    expect(ok.status).toBe(200);
  });
  it("rejects malformed login bodies", async () => {
    expect((await call("POST", "/api/auth/login", { body: { email: "not-an-email", password: "x" } })).status).toBe(400);
    expect((await call("POST", "/api/auth/login", { body: {} })).status).toBe(400);
  });
  it("/auth/me returns the session account; garbage, tampered and expired tokens are rejected", async () => {
    const token = await staff("hubcity");
    const me = await call("GET", "/api/auth/me", { token });
    expect(me.body.data.account.pharmacyId).toBe("ph-hubcity");
    expect((await call("GET", "/api/auth/me")).status).toBe(401);
    expect((await call("GET", "/api/auth/me", { token: token + "x" })).status).toBe(401);
    expect((await call("GET", "/api/auth/me", { token: "garbage" })).status).toBe(401);
    app.clock.advance(12 * HOUR + MIN);
    expect((await call("GET", "/api/auth/me", { token })).status).toBe(401);
  });
  it("logout clears the session cookie", async () => {
    const r = await call("POST", "/api/auth/logout", { token: await staff("hubcity") });
    expect(r.status).toBe(200);
    expect(r.setSession?.clear).toBe(true);
  });
  it("a deactivated account can no longer log in or use an old token", async () => {
    const token = await staff("depot");
    const acc = app.db.query<any>("accounts", (a) => a.email === "depot@pharmafind.demo")[0];
    app.db.save("accounts", acc.accountId, { ...acc, isActive: false });
    expect((await call("GET", "/api/auth/me", { token })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { body: { email: acc.email, password: DEMO_PASSWORD } })).status).toBe(401);
  });
});

describe("Password reset with security codes", () => {
  const request = (email: string) => call("POST", "/api/auth/password-reset/request", { body: { email } });
  const confirm = (email: string, code: string, newPassword: string) => call("POST", "/api/auth/password-reset/confirm", { body: { email, code, newPassword } });

  it("emails a 6-digit security code and lets the user choose a new password with it", async () => {
    const oldToken = await staff("hubcity");
    expect((await request("hubcity@pharmafind.demo")).status).toBe(200);
    expect(lastMail().to).toBe("hubcity@pharmafind.demo");
    const code = codeFromMail();
    expect(app.db.query<any>("securityCodes").some((c) => c.codeHash === code)).toBe(false); // codes are stored hashed
    expect((await confirm("hubcity@pharmafind.demo", code, "Brand-New-Pass9")).status).toBe(200);
    expect((await call("POST", "/api/auth/login", { body: { email: "hubcity@pharmafind.demo", password: DEMO_PASSWORD } })).status).toBe(401);
    await login("hubcity@pharmafind.demo", "Brand-New-Pass9");
    expect((await call("GET", "/api/auth/me", { token: oldToken })).status).toBe(401); // old sessions end
  });
  it("answers identically for unknown e-mails and sends nothing (no account enumeration)", async () => {
    const a = await request("hubcity@pharmafind.demo");
    const sent = app.adapters.email.outbox.length;
    const b = await request("nobody@pharmafind.demo");
    expect(b.status).toBe(a.status);
    expect(b.body.data.message).toBe(a.body.data.message);
    expect(app.adapters.email.outbox.length).toBe(sent);
  });
  it("codes are single-use", async () => {
    await request("hubcity@pharmafind.demo");
    const code = codeFromMail();
    expect((await confirm("hubcity@pharmafind.demo", code, "Another-Pass1")).status).toBe(200);
    expect((await confirm("hubcity@pharmafind.demo", code, "Third-Pass12")).status).toBe(400);
  });
  it("codes expire after 15 minutes", async () => {
    await request("hubcity@pharmafind.demo");
    const code = codeFromMail();
    app.clock.advance(16 * MIN);
    expect((await confirm("hubcity@pharmafind.demo", code, "Another-Pass1")).status).toBe(400);
  });
  it("invalidates the code after 5 wrong attempts", async () => {
    await request("hubcity@pharmafind.demo");
    const code = codeFromMail();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await confirm("hubcity@pharmafind.demo", wrong, "Another-Pass1")).status).toBe(400);
    expect((await confirm("hubcity@pharmafind.demo", code, "Another-Pass1")).status).toBe(400);
  });
  it("a new request invalidates the earlier code", async () => {
    await request("hubcity@pharmafind.demo");
    const first = codeFromMail();
    app.clock.advance(MIN);
    await request("hubcity@pharmafind.demo");
    const second = codeFromMail();
    if (first !== second) expect((await confirm("hubcity@pharmafind.demo", first, "Another-Pass1")).status).toBe(400);
    expect((await confirm("hubcity@pharmafind.demo", second, "Another-Pass1")).status).toBe(200);
  });
  it("enforces the password policy on reset", async () => {
    await request("hubcity@pharmafind.demo");
    const code = codeFromMail();
    expect((await confirm("hubcity@pharmafind.demo", code, "short1")).status).toBe(400);
    expect((await confirm("hubcity@pharmafind.demo", code, "alllettersnodigits")).status).toBe(400);
    expect((await confirm("hubcity@pharmafind.demo", code, "Good-Pass-77")).status).toBe(200); // the code survived the bad attempts
  });
});

describe("Per-pharmacy access control", () => {
  it("requires login for every portal route", async () => {
    for (const [m, p] of [["GET", "/api/portal/ph-hubcity/dashboard"], ["GET", "/api/portal/ph-hubcity/preview"], ["POST", "/api/portal/ph-hubcity/csv"], ["PUT", "/api/portal/ph-hubcity/feed"], ["GET", "/api/portal/ph-hubcity/verification"]]) {
      expect((await call(m, p)).status, `${m} ${p}`).toBe(401);
    }
  });
  it("a manager cannot read or change another pharmacy's data", async () => {
    const token = await staff("hubcity");
    expect((await call("GET", "/api/portal/ph-raider/dashboard", { token })).status).toBe(403);
    expect((await call("GET", "/api/portal/ph-raider/preview", { token })).status).toBe(403);
    expect((await call("PUT", "/api/portal/ph-raider/listings/lst-ph-raider-PF-10001", { token, body: { stock: 1, price: 1 } })).status).toBe(403);
    expect((await call("POST", "/api/portal/ph-raider/csv", { token, body: { fileName: "a.csv", content: csv("PF-10001,1,1.00") } })).status).toBe(403);
    expect((await call("PUT", "/api/portal/ph-raider/feed", { token, body: { posEndpoint: "https://x.demo-pos.example/f", intervalMinutes: 60 } })).status).toBe(403);
    expect(listingOf("ph-raider", "PF-10001").price).toBe(8.99);
  });
  it("cannot reach another pharmacy's listing through your own pharmacy path", async () => {
    const token = await staff("hubcity");
    const r = await call("PUT", "/api/portal/ph-hubcity/listings/lst-ph-raider-PF-10001", { token, body: { stock: 1, price: 1 } });
    expect(r.status).toBe(404);
    expect(listingOf("ph-raider", "PF-10001").price).toBe(8.99);
  });
  it("admins cannot use pharmacy portal routes and staff cannot use admin routes", async () => {
    expect((await call("GET", "/api/portal/ph-hubcity/dashboard", { token: await admin() })).status).toBe(403);
    expect((await call("GET", "/api/admin/requests", { token: await staff("hubcity") })).status).toBe(403);
    expect((await call("GET", "/api/admin/requests")).status).toBe(401);
  });
});

/* ===================================================================================================
 * Manual stock/price entry  (sequence diagram 2, option 1)
 * =================================================================================================*/
describe("Manual listing editor", () => {
  const put = (token: string, id: string, body: unknown, ph = "ph-hubcity") => call("PUT", `/api/portal/${ph}/listings/${id}`, { token, body });

  it("updates stock and price and stamps lastUpdated with the current time", async () => {
    const token = await staff("hubcity");
    app.clock.advance(3 * HOUR);
    const r = await put(token, "lst-ph-hubcity-PF-10001", { stock: 7, price: 10.25 });
    expect(r.status).toBe(200);
    expect(r.body.data.listing).toMatchObject({ stock: 7, price: 10.25, lastUpdated: app.clock.iso(), isStale: false, ageMinutes: 0 });
    expect(listingOf("ph-hubcity", "PF-10001")).toMatchObject({ stock: 7, price: 10.25, lastUpdated: app.clock.iso() });
  });
  it("rejects invalid values and leaves the listing untouched", async () => {
    const token = await staff("hubcity");
    const before = listingOf("ph-hubcity", "PF-10001");
    for (const body of [
      { stock: 5, price: 0 }, { stock: 5, price: -1 }, { stock: 5, price: 1.234 }, { stock: -1, price: 5 }, { stock: 2.5, price: 5 },
      { stock: "5", price: 5 }, { stock: 5, price: "5.00" }, { stock: 5 }, { price: 5 }, { stock: 1e9, price: 5 }, { stock: 5, price: 1e9 },
    ]) {
      const r = await put(token, "lst-ph-hubcity-PF-10001", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(listingOf("ph-hubcity", "PF-10001")).toEqual(before);
  });
  it("allows stock 0 (out of stock)", async () => {
    expect((await put(await staff("hubcity"), "lst-ph-hubcity-PF-10001", { stock: 0, price: 9.49 })).status).toBe(200);
  });
  it("returns 404 for a listing that does not exist", async () => {
    expect((await put(await staff("hubcity"), "lst-nope", { stock: 1, price: 1 })).status).toBe(404);
  });
  it("lists the pharmacy's own listings for the editor", async () => {
    const r = await call("GET", "/api/portal/ph-hubcity/listings", { token: await staff("hubcity") });
    expect(r.status).toBe(200);
    expect(r.body.data.listings.length).toBe(8);
    expect(r.body.data.listings[0]).toMatchObject({ catalogId: expect.any(String), brandName: expect.any(String), price: expect.any(Number) });
  });
  it("adds a listing for a catalog product and refuses unknown products or duplicates", async () => {
    const token = await staff("hubcity");
    const ok = await call("POST", "/api/portal/ph-hubcity/listings", { token, body: { catalogId: "PF-10009", stock: 4, price: 9.5 } });
    expect(ok.status).toBe(201);
    expect(listingOf("ph-hubcity", "PF-10009")).toMatchObject({ stock: 4, price: 9.5 });
    expect((await call("POST", "/api/portal/ph-hubcity/listings", { token, body: { catalogId: "PF-10009", stock: 4, price: 9.5 } })).status).toBe(409);
    expect((await call("POST", "/api/portal/ph-hubcity/listings", { token, body: { catalogId: "PF-99999", stock: 4, price: 9.5 } })).status).toBe(400);
  });
  it("a manual edit counts as a sync (dashboard time moves)", async () => {
    const token = await staff("westgate");
    expect((await call("GET", "/api/portal/ph-westgate/dashboard", { token })).body.data.isStale).toBe(true);
    await put(token, "lst-ph-westgate-PF-10001", { stock: 10, price: 8.5 }, "ph-westgate");
    const d = await call("GET", "/api/portal/ph-westgate/dashboard", { token });
    expect(d.body.data.isStale).toBe(false);
    expect(d.body.data.lastSyncAt).toBe(app.clock.iso());
  });

  /* Sequence diagram 2 (option 1): API->>SL: record (success, source = manual entry, no feed import);
   * class diagrams: FeedImport "0..1" -- "1" SyncLog, so a SyncLog may exist without a FeedImport. */
  const logsOf = (ph: string) => app.db.query<any>("syncLogs", (l) => l.pharmacy === ph);
  const importsOf = (ph: string) => app.db.query<any>("feedImports", (i) => i.pharmacy === ph);

  it("a manual save writes exactly one successful SyncLog, marked as manual entry, with no feed import", async () => {
    const token = await staff("hubcity");
    const logsBefore = logsOf("ph-hubcity").length;
    const importsBefore = importsOf("ph-hubcity").length;
    app.clock.advance(2 * HOUR);
    expect((await put(token, "lst-ph-hubcity-PF-10001", { stock: 7, price: 10.25 })).status).toBe(200);
    const logs = logsOf("ph-hubcity");
    expect(logs.length).toBe(logsBefore + 1);
    const newest = logs.reduce((a: any, b: any) => (a.syncedAt >= b.syncedAt ? a : b));
    expect(newest).toMatchObject({ pharmacy: "ph-hubcity", feedImport: null, success: true, syncedAt: app.clock.iso() });
    expect(newest.details.toLowerCase()).toContain("manual entry");
    expect(importsOf("ph-hubcity").length).toBe(importsBefore); // no FeedImport is created for manual saves
  });
  it("adding a listing by hand is also a manual-entry sync", async () => {
    const token = await staff("hubcity");
    const before = logsOf("ph-hubcity").length;
    await call("POST", "/api/portal/ph-hubcity/listings", { token, body: { catalogId: "PF-10009", stock: 4, price: 9.5 } });
    const logs = logsOf("ph-hubcity");
    expect(logs.length).toBe(before + 1);
    const newest = logs.reduce((a: any, b: any) => (a.syncedAt >= b.syncedAt ? a : b));
    expect(newest).toMatchObject({ feedImport: null, success: true });
    expect(newest.details.toLowerCase()).toContain("manual entry");
  });
  it("invalid values or a denied request write no SyncLog and do not refresh the sync time", async () => {
    const token = await staff("westgate");
    const logsBefore = logsOf("ph-westgate").length;
    const hubLogsBefore = logsOf("ph-hubcity").length;
    const syncBefore = app.db.get<any>("pharmacies", "ph-westgate").lastSyncAt;
    expect((await put(token, "lst-ph-westgate-PF-10001", { stock: 5, price: 0 }, "ph-westgate")).status).toBe(400);
    expect((await put(token, "lst-ph-hubcity-PF-10001", { stock: 5, price: 5 }, "ph-hubcity")).status).toBe(403);
    expect(logsOf("ph-westgate").length).toBe(logsBefore);
    expect(logsOf("ph-hubcity").length).toBe(hubLogsBefore);
    expect(app.db.get<any>("pharmacies", "ph-westgate").lastSyncAt).toBe(syncBefore);
    expect((await call("GET", "/api/portal/ph-westgate/dashboard", { token })).body.data.isStale).toBe(true);
  });
  it("the sync is recorded after the listing is saved (the saved listing and the log share the same time)", async () => {
    const token = await staff("hubcity");
    app.clock.advance(HOUR);
    await put(token, "lst-ph-hubcity-PF-10002", { stock: 3, price: 4.5 });
    const log = logsOf("ph-hubcity").reduce((a: any, b: any) => (a.syncedAt >= b.syncedAt ? a : b));
    expect(listingOf("ph-hubcity", "PF-10002").lastUpdated).toBe(log.syncedAt);
  });
  it("the dashboard shows the manual entry as the latest sync", async () => {
    const token = await staff("hubcity");
    app.clock.advance(HOUR);
    await put(token, "lst-ph-hubcity-PF-10001", { stock: 6, price: 10 });
    const d = await call("GET", "/api/portal/ph-hubcity/dashboard", { token });
    expect(d.status).toBe(200);
    expect(d.body.data.lastSyncAt).toBe(app.clock.iso());
    expect(d.body.data.latestSync).toMatchObject({ success: true, syncedAt: app.clock.iso() });
    expect(d.body.data.latestSync.details.toLowerCase()).toContain("manual entry");
  });
  it("a manual sync keeps the pharmacy fresh for 24 h and then goes stale like any other sync", async () => {
    const token = await staff("westgate");
    await put(token, "lst-ph-westgate-PF-10001", { stock: 10, price: 8.5 }, "ph-westgate");
    app.clock.advance(2 * HOUR);
    expect(app.db.get<any>("pharmacies", "ph-westgate").lastSyncAt).not.toBeNull();
    expect((await call("GET", "/api/portal/ph-westgate/dashboard", { token })).body.data.isStale).toBe(false);
    app.clock.advance(23 * HOUR); // 25 h since the manual save (the 12 h session has expired, so log in again)
    const fresh = await staff("westgate");
    expect((await call("GET", "/api/portal/ph-westgate/dashboard", { token: fresh })).body.data.isStale).toBe(true);
  });
});

/* ===================================================================================================
 * CSV upload with row validation  (sequence diagram 2, option 2a - Feed Import)
 * =================================================================================================*/
describe("CSV import (Feed Import validates, never fixes)", () => {
  const upload = (content: string, fileName = "stock.csv", ph = "ph-hubcity", token?: string) =>
    staff(ph.replace("ph-", "")).then((t) => call("POST", `/api/portal/${ph}/csv`, { token: token ?? t, body: { fileName, content } }));

  it("saves valid rows and returns an import summary with accepted and rejected counts", async () => {
    app.clock.advance(HOUR);
    const r = await upload(csv("PF-10001,11,9.99", "PF-10004,12,7.00"));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: "accepted", totalRows: 2, validRows: 2, rejectedRows: 0, rejections: [] });
    expect(listingOf("ph-hubcity", "PF-10001")).toMatchObject({ stock: 11, price: 9.99, lastUpdated: app.clock.iso() });
    expect(listingOf("ph-hubcity", "PF-10004")).toMatchObject({ stock: 12, price: 7 });
  });
  it("creates listings for catalog products the pharmacy did not list yet", async () => {
    expect(listingOf("ph-hubcity", "PF-10011")).toBeUndefined();
    await upload(csv("PF-10011,3,21.50"));
    expect(listingOf("ph-hubcity", "PF-10011")).toMatchObject({ stock: 3, price: 21.5, pharmacy: "ph-hubcity", product: "PF-10011" });
  });
  it("rejects bad rows individually with a reason and keeps the good ones", async () => {
    const r = await upload(csv("PF-10001,11,9.99", "PF-99999,5,5.00", "PF-10004,-3,5.00", "PF-10003,2.5,5.00", "PF-10006,4,0", "PF-10008,4,abc", "PF-10009,4"));
    expect(r.body.data).toMatchObject({ status: "accepted", totalRows: 7, validRows: 1, rejectedRows: 6 });
    expect(r.body.data.rejections.map((x: any) => x.row)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(r.body.data.rejections.every((x: any) => typeof x.reason === "string" && x.reason.length > 3)).toBe(true);
    expect(listingOf("ph-hubcity", "PF-10004").stock).toBe(40); // unchanged
  });
  it("does not normalise: padded, lower-case, quoted, exponent or comma-decimal values are rejected as-is", async () => {
    const r = await upload(csv(" PF-10001,5,5.00", "pf-10004,5,5.00", "PF-10003, 5,5.00", "PF-10006,5e1,5.00", "PF-10008,5,5,00", "PF-10009,\"5\",5.00", "PF-10010,05,5.00", "PF-10012,5,5.001"));
    expect(r.body.data.validRows).toBe(0);
    expect(r.body.data.rejectedRows).toBe(8);
    expect(r.body.data.status).toBe("rejected");
  });
  it("rejects duplicate catalog ids inside one file (the later row)", async () => {
    const r = await upload(csv("PF-10001,5,5.00", "PF-10001,6,6.00"));
    expect(r.body.data).toMatchObject({ validRows: 1, rejectedRows: 1 });
    expect(r.body.data.rejections[0].row).toBe(2);
    expect(listingOf("ph-hubcity", "PF-10001").stock).toBe(5);
  });
  it("rejects the whole file when the header is not the standard one, changing nothing", async () => {
    const before = app.db.query("listings");
    const r = await upload("sku,qty,cost\nPF-10001,5,5.00\n");
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: "rejected", validRows: 0 });
    expect(r.body.data.rejections[0].reason).toMatch(/header/i);
    expect(app.db.query("listings")).toEqual(before);
  });
  it("rejects an empty file and a header-only file", async () => {
    expect((await upload("")).body.data.status).toBe("rejected");
    expect((await upload("catalogId,stock,price\n")).body.data.status).toBe("rejected");
  });
  it("accepts Windows line endings", async () => {
    const r = await upload("catalogId,stock,price\r\nPF-10001,5,5.00\r\n");
    expect(r.body.data).toMatchObject({ status: "accepted", validRows: 1 });
  });
  it("rejects rows with too many columns", async () => {
    expect((await upload(csv("PF-10001,5,5.00,extra"))).body.data.validRows).toBe(0);
  });
  it("keeps a copy of the uploaded file and records the import and the sync", async () => {
    const content = csv("PF-10001,11,9.99");
    const r = await upload(content, "my stock.csv");
    const imp = app.db.get<any>("feedImports", r.body.data.importId);
    expect(imp).toMatchObject({ pharmacy: "ph-hubcity", source: "csv", totalRows: 1, validRows: 1, rejectedRows: 0 });
    expect(app.files.retrieve(imp.storedFilePath).toString()).toBe(content);
    const log = app.db.query<any>("syncLogs", (l) => l.feedImport === imp.importId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ pharmacy: "ph-hubcity", success: true, syncedAt: app.clock.iso() });
    expect(app.db.get<any>("pharmacies", "ph-hubcity").lastSyncAt).toBe(app.clock.iso());
  });
  it("a fully rejected file records a FAILED sync and does not refresh the pharmacy's sync time", async () => {
    const before = app.db.get<any>("pharmacies", "ph-westgate").lastSyncAt;
    app.clock.advance(HOUR);
    const r = await upload(csv("PF-99999,5,5.00"), "bad.csv", "ph-westgate");
    expect(r.body.data.status).toBe("rejected");
    const log = app.db.query<any>("syncLogs", (l) => l.feedImport === r.body.data.importId)[0];
    expect(log.success).toBe(false);
    expect(app.db.get<any>("pharmacies", "ph-westgate").lastSyncAt).toBe(before);
    expect((await call("GET", "/api/portal/ph-westgate/dashboard", { token: await staff("westgate") })).body.data.isStale).toBe(true);
  });
  it("never touches other pharmacies' listings", async () => {
    const before = listingOf("ph-raider", "PF-10001");
    await upload(csv("PF-10001,1,1.00"));
    expect(listingOf("ph-raider", "PF-10001")).toEqual(before);
  });
  it("rejects a missing or oversized upload at the API boundary", async () => {
    const token = await staff("hubcity");
    expect((await call("POST", "/api/portal/ph-hubcity/csv", { token, body: { fileName: "a.csv" } })).status).toBe(400);
    expect((await call("POST", "/api/portal/ph-hubcity/csv", { token, body: { fileName: "a.csv", content: "x".repeat(1_100_000) } })).status).toBe(413);
  });
  it("a successful import clears the stale state of the pharmacy listing", async () => {
    const token = await staff("westgate");
    await call("POST", "/api/portal/ph-westgate/csv", { token, body: { fileName: "a.csv", content: csv("PF-10001,9,8.00") } });
    const r = await search({ q: "advil" });
    const w = r.body.data.results.find((g: any) => g.pharmacy.pharmacyId === "ph-westgate").items.find((i: any) => i.catalogId === "PF-10001");
    expect(w.isStale).toBe(false);
  });
});

/* ===================================================================================================
 * Automatic POS feed  (sequence diagram 2, option 2b)
 * =================================================================================================*/
describe("Automatic POS feed", () => {
  const EP = "https://maple.demo-pos.example/feed";
  const configure = (token: string, body: unknown, ph = "ph-raider") => call("PUT", `/api/portal/${ph}/feed`, { token, body });

  it("tests the connection, enables the feed and schedules it", async () => {
    const token = await staff("raider");
    const r = await configure(token, { posEndpoint: EP, intervalMinutes: 30 });
    expect(r.status).toBe(200);
    expect(r.body.data.feed).toMatchObject({ pharmacy: "ph-raider", posEndpoint: EP, intervalMinutes: 30, isEnabled: true, lastPulledAt: null });
    const job = app.services.scheduler.listJobs().find((j) => j.type === "pull_pos_feeds")!;
    expect(new Date(job.nextRunAt).getTime()).toBeLessThanOrEqual(T0.getTime() + 30 * MIN);
    expect((await call("GET", "/api/portal/ph-raider/feed", { token })).body.data.feed.isEnabled).toBe(true);
  });
  it("a failed connection gives a clear error and enables nothing", async () => {
    const token = await staff("raider");
    const r = await configure(token, { posEndpoint: "https://unreachable.invalid/feed", intervalMinutes: 30 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("CONNECTION_FAILED");
    expect(r.body.error.message).toMatch(/connect/i);
    expect(app.db.query("automaticFeeds", (f: any) => f.pharmacy === "ph-raider")).toHaveLength(0);
  });
  it("rejects malformed feed settings", async () => {
    const token = await staff("raider");
    for (const body of [{ posEndpoint: "http://insecure.demo-pos.example/f", intervalMinutes: 30 }, { posEndpoint: "not a url", intervalMinutes: 30 }, { posEndpoint: EP, intervalMinutes: 1 }, { posEndpoint: EP, intervalMinutes: 99999 }, { posEndpoint: EP, intervalMinutes: 10.5 }, { posEndpoint: EP }, {}]) {
      expect((await configure(token, body)).status, JSON.stringify(body)).toBe(400);
    }
  });
  it("one feed per pharmacy: configuring again updates it", async () => {
    const token = await staff("hubcity");
    await configure(token, { posEndpoint: EP, intervalMinutes: 120 }, "ph-hubcity");
    const feeds = app.db.query<any>("automaticFeeds", (f) => f.pharmacy === "ph-hubcity");
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({ posEndpoint: EP, intervalMinutes: 120 });
  });
  it("can be disabled", async () => {
    const token = await staff("hubcity");
    const r = await call("POST", "/api/portal/ph-hubcity/feed/disable", { token });
    expect(r.status).toBe(200);
    expect(r.body.data.feed.isEnabled).toBe(false);
    app.clock.advance(5 * HOUR);
    await app.services.scheduler.runJob("pull_pos_feeds");
    expect(app.db.query("feedImports", (i: any) => i.source === "pos")).toHaveLength(0);
  });
  it("the scheduler pulls due feeds through Feed Import: listings, file copy and sync log are updated", async () => {
    app.clock.advance(2 * HOUR); // seeded hubcity feed: interval 60 min, last pulled 2 h before T0
    const result = await app.services.scheduler.runJob("pull_pos_feeds");
    expect(result.summary).toContain("1 feed");
    const imp = app.db.query<any>("feedImports", (i) => i.source === "pos")[0];
    expect(imp).toMatchObject({ pharmacy: "ph-hubcity", status: "accepted", rejectedRows: 0 });
    expect(imp.feed).toBeTruthy();
    expect(app.files.retrieve(imp.storedFilePath).length).toBeGreaterThan(10);
    expect(listingOf("ph-hubcity", "PF-10001").lastUpdated).toBe(app.clock.iso());
    expect(app.db.query<any>("syncLogs", (l) => l.feedImport === imp.importId)[0].success).toBe(true);
    expect(app.db.get<any>("automaticFeeds", imp.feed).lastPulledAt).toBe(app.clock.iso());
  });
  it("does not pull a feed again before its own interval has passed", async () => {
    app.clock.advance(2 * HOUR);
    await app.services.scheduler.runJob("pull_pos_feeds");
    app.clock.advance(10 * MIN);
    expect((await app.services.scheduler.runJob("pull_pos_feeds")).summary).toContain("0 feed");
    app.clock.advance(55 * MIN);
    expect((await app.services.scheduler.runJob("pull_pos_feeds")).summary).toContain("1 feed");
  });
  it("rejects non-compliant POS rows without fixing them", async () => {
    app.adapters.posFeed.setMode("https://hubcity.demo-pos.example/feed", "invalid");
    app.clock.advance(2 * HOUR);
    await app.services.scheduler.runJob("pull_pos_feeds");
    const imp = app.db.query<any>("feedImports", (i) => i.source === "pos")[0];
    expect(imp.rejectedRows).toBe(3);
    expect(imp.validRows).toBeGreaterThan(0);
    expect(imp.status).toBe("accepted");
    expect(listingOf("ph-hubcity", "PF-99999")).toBeUndefined();
  });
  it("rejects a whole feed that is not a list of rows", async () => {
    app.adapters.posFeed.setMode("https://hubcity.demo-pos.example/feed", "malformed");
    const before = listingOf("ph-hubcity", "PF-10001");
    app.clock.advance(2 * HOUR);
    await app.services.scheduler.runJob("pull_pos_feeds");
    const imp = app.db.query<any>("feedImports", (i) => i.source === "pos")[0];
    expect(imp.status).toBe("rejected");
    expect(listingOf("ph-hubcity", "PF-10001")).toEqual(before);
    expect(app.db.query<any>("syncLogs", (l) => l.feedImport === imp.importId)[0].success).toBe(false);
  });
  it("records a failed sync when the POS system is down and keeps the old data", async () => {
    app.adapters.posFeed.setMode("https://hubcity.demo-pos.example/feed", "down");
    const before = listingOf("ph-hubcity", "PF-10001");
    app.clock.advance(2 * HOUR);
    await app.services.scheduler.runJob("pull_pos_feeds");
    const imp = app.db.query<any>("feedImports", (i) => i.source === "pos")[0];
    expect(imp.status).toBe("rejected");
    expect(app.db.query<any>("syncLogs", (l) => l.feedImport === imp.importId)[0]).toMatchObject({ success: false });
    expect(listingOf("ph-hubcity", "PF-10001")).toEqual(before);
  });
});

/* ===================================================================================================
 * Last-sync dashboard + public preview  (sequence diagram 3, parts 1-2)
 * =================================================================================================*/
describe("Pharmacy dashboard and public listing preview", () => {
  it("shows last sync time, OK status, feed info and listing count when data is fresh", async () => {
    const r = await call("GET", "/api/portal/ph-hubcity/dashboard", { token: await staff("hubcity") });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ isStale: false, ageMinutes: 2 * 60, listingCount: 8, pharmacy: { pharmacyId: "ph-hubcity", verificationStatus: "verified" } });
    expect(r.body.data.lastSyncAt).toBe(new Date(T0.getTime() - 2 * HOUR).toISOString());
    expect(r.body.data.feed).toMatchObject({ isEnabled: true });
  });
  it("shows a warning (isStale) once the last successful sync is older than 24 h, with a server-computed age", async () => {
    app.clock.advance(23 * HOUR);
    const token = await staff("hubcity");
    expect((await call("GET", "/api/portal/ph-hubcity/dashboard", { token })).body.data.isStale).toBe(true); // 2 h + 23 h = 25 h
    const d = await call("GET", "/api/portal/ph-hubcity/dashboard", { token });
    expect(d.body.data.ageMinutes).toBe(25 * 60);
  });
  it("a pharmacy that never synced counts as stale", async () => {
    const reg = await call("POST", "/api/pharmacies/register", { body: registration() });
    const d = await call("GET", `/api/portal/${reg.body.data.pharmacyId}/dashboard`, { token: reg.setSession!.token });
    expect(d.body.data).toMatchObject({ lastSyncAt: null, isStale: true, ageMinutes: null });
  });
  it("preview shows the listings exactly as searchers see them, including stale labels and verified status", async () => {
    const r = await call("GET", "/api/portal/ph-westgate/preview", { token: await staff("westgate") });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ isVerified: true, isVisibleInSearch: true });
    expect(r.body.data.listings).toHaveLength(5);
    expect(r.body.data.listings.every((l: any) => l.isStale === true && l.ageMinutes === 30 * 60)).toBe(true);
  });
  it("preview tells a pending pharmacy that it is not visible yet", async () => {
    const r = await call("GET", "/api/portal/ph-newleaf/preview", { token: await staff("newleaf") });
    expect(r.body.data).toMatchObject({ isVerified: false, isVisibleInSearch: false });
    expect(r.body.data.listings.length).toBe(2);
  });
});

/* ===================================================================================================
 * Notifications, stale-sync alerts and e-mail retries  (sequence diagram 3, parts 3-4)
 * =================================================================================================*/
describe("Stale-sync alerts", () => {
  it("e-mails the pharmacy account when the last sync is older than 24 h - and only those", async () => {
    const r = await app.services.scheduler.runJob("check_stale_sync");
    expect(r.summary).toContain("1 stale-sync alert");
    expect(app.adapters.email.outbox).toHaveLength(1);
    expect(lastMail().to).toBe("westgate@pharmafind.demo");
    expect(lastMail().subject).toMatch(/Westgate/);
    const n = app.db.query<any>("notifications")[0];
    expect(n).toMatchObject({ type: "stale_sync", status: "sent", retryCount: 0 });
  });
  it("does not nag: one alert per account per 24 h", async () => {
    await app.services.scheduler.runJob("check_stale_sync");
    app.clock.advance(2 * HOUR);
    await app.services.scheduler.runJob("check_stale_sync");
    expect(app.db.query("notifications", (n: any) => n.type === "stale_sync")).toHaveLength(1);
    app.clock.advance(25 * HOUR);
    await app.services.scheduler.runJob("check_stale_sync");
    expect(app.db.query("notifications", (n: any) => n.type === "stale_sync").length).toBeGreaterThan(1);
  });
  it("skips pharmacies that are not verified and does not alert fresh ones", async () => {
    app.clock.advance(15 * HOUR); // hubcity 17 h, raider 20 h, depot 24 h, plains 29 h, southside 35 h, westgate 45 h
    await app.services.scheduler.runJob("check_stale_sync");
    const to = app.adapters.email.outbox.map((m) => m.to).sort();
    expect(to).toEqual(["plains@pharmafind.demo", "southside@pharmafind.demo", "westgate@pharmafind.demo"]);
    expect(to).not.toContain("newleaf@pharmafind.demo");
  });
  it("marks a notification failed when the e-mail service rejects it, and the retry job re-sends it", async () => {
    app.adapters.email.failing = true;
    await app.services.scheduler.runJob("check_stale_sync");
    const n = () => app.db.query<any>("notifications")[0];
    expect(n().status).toBe("failed");
    expect(app.adapters.email.outbox).toHaveLength(0);
    app.adapters.email.failing = false;
    const r = await app.services.scheduler.runJob("retry_failed_emails");
    expect(r.summary).toContain("1 e-mail");
    expect(n()).toMatchObject({ status: "sent", retryCount: 1 });
    expect(app.adapters.email.outbox).toHaveLength(1);
  });
  it("gives up retrying after 5 attempts", async () => {
    app.adapters.email.failing = true;
    await app.services.scheduler.runJob("check_stale_sync");
    for (let i = 0; i < 8; i++) await app.services.scheduler.runJob("retry_failed_emails");
    expect(app.db.query<any>("notifications")[0]).toMatchObject({ status: "failed", retryCount: 5 });
  });
  it("security-code e-mails use the same notification pipeline", async () => {
    await call("POST", "/api/auth/password-reset/request", { body: { email: "hubcity@pharmafind.demo" } });
    expect(app.db.query<any>("notifications")[0]).toMatchObject({ type: "security_code", status: "sent" });
  });
});

/* ===================================================================================================
 * Job scheduler and background worker
 * =================================================================================================*/
describe("Job scheduler", () => {
  it("has the four jobs from the architecture, stored in the job table", () => {
    const types = app.services.scheduler.listJobs().map((j) => j.type);
    expect(types).toEqual(["pull_pos_feeds", "check_stale_sync", "refresh_drug_reference", "retry_failed_emails"]);
    expect(app.db.query("scheduledJobs")).toHaveLength(4);
  });
  it("tick() runs only the jobs that are due and reschedules them", async () => {
    expect((await app.services.scheduler.tick()).ran).toEqual([]);
    app.clock.advance(6 * MIN);
    const r = await app.services.scheduler.tick();
    expect(r.ran).toEqual(["pull_pos_feeds", "retry_failed_emails"]);
    const job = app.services.scheduler.listJobs().find((j) => j.type === "pull_pos_feeds")!;
    expect(job.lastRunAt).toBe(app.clock.iso());
    expect(new Date(job.nextRunAt).getTime()).toBe(app.clock.now().getTime() + 5 * MIN);
    expect((await app.services.scheduler.tick()).ran).toEqual([]);
  });
  it("a day later every job is due", async () => {
    app.clock.advance(25 * HOUR);
    expect((await app.services.scheduler.tick()).ran).toHaveLength(4);
  });
  it("runJob forces a job regardless of its schedule and refresh_drug_reference reports its work", async () => {
    const r = await app.services.scheduler.runJob("refresh_drug_reference");
    expect(r.type).toBe("refresh_drug_reference");
    expect(r.summary).toMatch(/refreshed/);
  });
});

/* ===================================================================================================
 * Registration and verification  (sequence diagram 3 p2, all parts)
 * =================================================================================================*/
describe("Pharmacy registration", () => {
  it("registers a pharmacy as PENDING, stores the license and does not list it in search", async () => {
    const r = await call("POST", "/api/pharmacies/register", { body: registration() });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ verificationStatus: "pending" });
    expect(r.setSession?.token).toBeTruthy();
    const ph = app.db.get<any>("pharmacies", r.body.data.pharmacyId);
    expect(ph).toMatchObject({ name: "Maple Street Pharmacy", verificationStatus: "pending", lastSyncAt: null, isAccessible: true });
    const loc = app.db.get<any>("locations", ph.location);
    expect(loc).toMatchObject({ city: "Lubbock" });
    expect(loc.latitude).toBeCloseTo(33.58, 1);
    const vr = app.db.get<any>("verificationRequests", r.body.data.requestId);
    expect(vr).toMatchObject({ pharmacy: ph.pharmacyId, status: "pending", reviewer: null });
    const doc = app.db.query<any>("licenseDocuments", (d) => d.verificationRequest === vr.requestId)[0];
    expect(app.files.retrieve(doc.storagePath).toString()).toBe("%PDF-1.4 demo license");
    expect(app.db.query("accounts", (a: any) => a.email === "maria@maple.example")).toHaveLength(1);
    expect(app.db.query("pharmacyStaff", (s: any) => s.pharmacy === ph.pharmacyId)).toHaveLength(1);
  });
  it("never stores the password in clear text and lets the new manager log in", async () => {
    await call("POST", "/api/pharmacies/register", { body: registration() });
    expect(JSON.stringify(app.db.query("accounts"))).not.toContain("Maple!Pass1");
    await login("maria@maple.example", "Maple!Pass1");
  });
  it("validates every field", async () => {
    for (const bad of [
      { pharmacyName: "A" }, { licenseNumber: "tx-123" }, { licenseNumber: "12345" }, { phone: "abc" }, { email: "nope" }, { password: "short1" }, { password: "nodigitshere" },
      { fullName: "" }, { license: { ...license, mimeType: "text/html" } }, { license: { ...license, contentBase64: "***not base64***" } }, { license: undefined }, { isAccessible: "yes" },
    ]) {
      const r = await call("POST", "/api/pharmacies/register", { body: registration(bad) });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(app.db.query("pharmacies")).toHaveLength(7);
  });
  it("rejects an oversized license file", async () => {
    const big = { ...license, contentBase64: Buffer.alloc(2_100_000, 1).toString("base64") };
    const r = await call("POST", "/api/pharmacies/register", { body: registration({ license: big }) });
    expect([400, 413]).toContain(r.status);
  });
  it("refuses a duplicate e-mail or license number", async () => {
    await call("POST", "/api/pharmacies/register", { body: registration() });
    expect((await call("POST", "/api/pharmacies/register", { body: registration({ licenseNumber: "TX-5550999" }) })).status).toBe(409);
    expect((await call("POST", "/api/pharmacies/register", { body: registration({ email: "other@maple.example" }) })).status).toBe(409);
  });
  it("fails cleanly (nothing saved) when the address cannot be geocoded", async () => {
    const r = await call("POST", "/api/pharmacies/register", { body: registration({ address: "Nowhere Land 123" }) });
    expect(r.status).toBe(400);
    expect(app.db.query("accounts", (a: any) => a.email === "maria@maple.example")).toHaveLength(0);
    expect(app.db.query("pharmacies")).toHaveLength(7);
  });
  it("lets the manager see the pending status", async () => {
    const reg = await call("POST", "/api/pharmacies/register", { body: registration() });
    const v = await call("GET", `/api/portal/${reg.body.data.pharmacyId}/verification`, { token: reg.setSession!.token });
    expect(v.body.data).toMatchObject({ verificationStatus: "pending", isVisibleInSearch: false, latestRequest: { status: "pending" } });
  });
});

describe("Admin verification workflow", () => {
  async function pending() {
    const reg = await call("POST", "/api/pharmacies/register", { body: registration() });
    return { ...reg.body.data, staffToken: reg.setSession!.token as string };
  }

  it("lists pending requests (including the seeded one)", async () => {
    await pending();
    const r = await call("GET", "/api/admin/requests", { token: await admin() });
    expect(r.status).toBe(200);
    expect(r.body.data.requests.map((x: any) => x.pharmacyName).sort()).toEqual(["Maple Street Pharmacy", "New Leaf Pharmacy"]);
    expect(r.body.data.requests[0]).toMatchObject({ requestId: expect.any(String), licenseNumber: expect.any(String), status: "pending" });
  });
  it("review returns the request, the registry result and the license document (downloaded from file storage)", async () => {
    const p = await pending();
    const r = await call("GET", `/api/admin/requests/${p.requestId}`, { token: await admin() });
    expect(r.status).toBe(200);
    expect(r.body.data.registryResult.status).toBe("invalid"); // TX-5550101 is not in the mock registry
    expect(r.body.data.pharmacy).toMatchObject({ name: "Maple Street Pharmacy", licenseNumber: "TX-5550101" });
    expect(Buffer.from(r.body.data.document.contentBase64, "base64").toString()).toBe("%PDF-1.4 demo license");
    expect(r.body.data.document).toMatchObject({ fileName: "license.pdf", mimeType: "application/pdf" });
    expect(app.db.get<any>("verificationRequests", p.requestId).registryResult).toMatchObject({ status: "invalid" });
  });
  it("shows a valid registry result for a known license and 'unavailable' when the registry is down", async () => {
    const seeded = app.db.query<any>("verificationRequests", (v) => v.pharmacy === "ph-newleaf")[0];
    const ok = await call("GET", `/api/admin/requests/${seeded.requestId}`, { token: await admin() });
    expect(ok.body.data.registryResult.status).toBe("valid");
    app.adapters.licenseCheck.available = false;
    const down = await call("GET", `/api/admin/requests/${seeded.requestId}`, { token: await admin() });
    expect(down.status).toBe(200);
    expect(down.body.data.registryResult.status).toBe("unavailable");
  });
  it("approving requires the manual license check first", async () => {
    const p = await pending();
    const token = await admin();
    const early = await call("POST", `/api/admin/requests/${p.requestId}/approve`, { token });
    expect(early.status).toBe(409);
    expect(app.db.get<any>("pharmacies", p.pharmacyId).verificationStatus).toBe("pending");
    await call("POST", `/api/admin/requests/${p.requestId}/manual-check`, { token, body: { confirmed: false, note: "license number is blurry" } });
    expect((await call("POST", `/api/admin/requests/${p.requestId}/approve`, { token })).status).toBe(409);
  });
  it("approval verifies the pharmacy, records the reviewer and puts its listings into search with the verified badge", async () => {
    const p = await pending();
    const token = await admin();
    await staff("hubcity"); // unrelated login
    const own = await call("POST", "/api/portal/" + p.pharmacyId + "/listings", { token: p.staffToken, body: { catalogId: "PF-10001", stock: 9, price: 8.1 } });
    expect(own.status).toBe(201);
    expect(pharmacyIds(await search({ q: "advil" }))).not.toContain(p.pharmacyId);
    expect((await call("POST", `/api/admin/requests/${p.requestId}/manual-check`, { token, body: { confirmed: true, note: "matches registry" } })).status).toBe(200);
    const ok = await call("POST", `/api/admin/requests/${p.requestId}/approve`, { token });
    expect(ok.status).toBe(200);
    expect(app.db.get<any>("verificationRequests", p.requestId)).toMatchObject({ status: "verified", reviewedAt: app.clock.iso(), manualCheck: { confirmed: true } });
    expect(app.db.get<any>("verificationRequests", p.requestId).reviewer).toBeTruthy();
    expect(app.db.get<any>("pharmacies", p.pharmacyId).verificationStatus).toBe("verified");
    const after = await search({ q: "advil" });
    const mine = after.body.data.results.find((g: any) => g.pharmacy.pharmacyId === p.pharmacyId);
    expect(mine.pharmacy.isVerified).toBe(true);
    expect((await call("GET", `/api/portal/${p.pharmacyId}/verification`, { token: p.staffToken })).body.data).toMatchObject({ verificationStatus: "verified", isVisibleInSearch: true });
  });
  it("rejection needs a reason, keeps the pharmacy hidden and shows the reason to the manager", async () => {
    const p = await pending();
    const token = await admin();
    expect((await call("POST", `/api/admin/requests/${p.requestId}/reject`, { token, body: {} })).status).toBe(400);
    expect((await call("POST", `/api/admin/requests/${p.requestId}/reject`, { token, body: { reason: "no" } })).status).toBe(400);
    expect((await call("POST", `/api/admin/requests/${p.requestId}/reject`, { token, body: { reason: "License not found in the state registry" } })).status).toBe(200);
    expect(app.db.get<any>("pharmacies", p.pharmacyId).verificationStatus).toBe("rejected");
    const v = await call("GET", `/api/portal/${p.pharmacyId}/verification`, { token: p.staffToken });
    expect(v.body.data).toMatchObject({ verificationStatus: "rejected", isVisibleInSearch: false, latestRequest: { rejectionReason: "License not found in the state registry" } });
  });
  it("a request can only be decided once", async () => {
    const p = await pending();
    const token = await admin();
    await call("POST", `/api/admin/requests/${p.requestId}/reject`, { token, body: { reason: "Not a licensed pharmacy" } });
    expect((await call("POST", `/api/admin/requests/${p.requestId}/reject`, { token, body: { reason: "Not a licensed pharmacy" } })).status).toBe(409);
    expect((await call("POST", `/api/admin/requests/${p.requestId}/manual-check`, { token, body: { confirmed: true } })).status).toBe(409);
  });
  it("a rejected pharmacy can resubmit a license, creating a new pending request", async () => {
    const p = await pending();
    const token = await admin();
    await call("POST", `/api/admin/requests/${p.requestId}/reject`, { token, body: { reason: "Blurry document, please resend" } });
    expect((await call("POST", `/api/portal/${p.pharmacyId}/verification/resubmit`, { token: p.staffToken, body: { license } })).status).toBe(201);
    expect(app.db.get<any>("pharmacies", p.pharmacyId).verificationStatus).toBe("pending");
    expect(app.db.query("verificationRequests", (v: any) => v.pharmacy === p.pharmacyId)).toHaveLength(2);
    expect((await call("POST", `/api/portal/${p.pharmacyId}/verification/resubmit`, { token: p.staffToken, body: { license } })).status).toBe(409); // already pending
  });
  it("an unknown request id returns 404", async () => {
    expect((await call("GET", "/api/admin/requests/vr-nope", { token: await admin() })).status).toBe(404);
  });
  it("the seeded pending pharmacy can be approved end-to-end", async () => {
    const seeded = app.db.query<any>("verificationRequests", (v) => v.pharmacy === "ph-newleaf")[0];
    const token = await admin();
    await call("POST", `/api/admin/requests/${seeded.requestId}/manual-check`, { token, body: { confirmed: true } });
    expect((await call("POST", `/api/admin/requests/${seeded.requestId}/approve`, { token })).status).toBe(200);
    expect(pharmacyIds(await search({ q: "advil" }))).toContain("ph-newleaf");
  });
});

/* ===================================================================================================
 * REST API (Layer 2): envelope, validation, routing, demo controls
 * =================================================================================================*/
describe("REST API envelope", () => {
  it("wraps every answer in JSON with ok flag and the server time", async () => {
    const ok = await search({ q: "advil" });
    expect(ok.body).toMatchObject({ ok: true, serverNow: T0.toISOString() });
    const bad = await search({ q: "" });
    expect(bad.body).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR", message: expect.any(String) }, serverNow: T0.toISOString() });
  });
  it("unknown routes give 404 and wrong methods 405", async () => {
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("DELETE", "/api/search", { query: {} })).status).toBe(405);
  });
  it("rejects invalid JSON bodies and non-object bodies", async () => {
    expect((await app.api.handle({ method: "POST", path: "/api/auth/login", query: {}, rawBody: "{not json" })).status).toBe(400);
    expect((await call("POST", "/api/auth/login", { body: [1, 2] })).status).toBe(400);
    expect((await call("POST", "/api/auth/login", { body: "text" })).status).toBe(400);
  });
  it("rejects bodies that are too large", async () => {
    expect((await app.api.handle({ method: "POST", path: "/api/auth/login", query: {}, rawBody: " ".repeat(3_500_000) })).status).toBe(413);
  });
  it("does not leak internals when something unexpected breaks", async () => {
    app.db.query = () => { throw new Error("secret stack detail /etc/passwd"); };
    const r = await search({ q: "advil" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret");
  });
  it("serves the product catalog publicly for the editor and search hints", async () => {
    const r = await call("GET", "/api/catalog");
    expect(r.status).toBe(200);
    expect(r.body.data.products.length).toBeGreaterThanOrEqual(10);
    expect(r.body.data.products[0]).toMatchObject({ catalogId: expect.stringMatching(/^PF-\d{5}$/), brandName: expect.any(String) });
  });
});

describe("Demo controls (fast-forward, scheduler, mail outbox, adapter switches)", () => {
  it("advances the demo clock and reports server time", async () => {
    const r = await call("POST", "/api/demo/advance", { body: { hours: 25 } });
    expect(r.status).toBe(200);
    expect(r.body.data.now).toBe(new Date(T0.getTime() + 25 * HOUR).toISOString());
    expect((await call("GET", "/api/demo/state")).body.data).toMatchObject({ now: expect.any(String), offsetMs: 25 * HOUR });
    const s = await search({ q: "ibuprofen" });
    expect(s.body.data.results.flatMap((g: any) => g.items).every((i: any) => i.isStale)).toBe(true);
  });
  it("validates the fast-forward amount and can reset the clock", async () => {
    for (const hours of [0, -1, "x", 1000, null]) expect((await call("POST", "/api/demo/advance", { body: { hours } })).status).toBe(400);
    await call("POST", "/api/demo/advance", { body: { hours: 3 } });
    const r = await call("POST", "/api/demo/reset-clock");
    expect(r.body.data.now).toBe(T0.toISOString());
  });
  it("runs the scheduler on demand, all due jobs or one named job", async () => {
    await call("POST", "/api/demo/advance", { body: { hours: 25 } });
    const all = await call("POST", "/api/demo/run-scheduler", { body: {} });
    expect(all.body.data.ran).toHaveLength(4);
    const one = await call("POST", "/api/demo/run-scheduler", { body: { job: "check_stale_sync" } });
    expect(one.body.data.ran).toEqual(["check_stale_sync"]);
    expect((await call("POST", "/api/demo/run-scheduler", { body: { job: "bogus" } })).status).toBe(400);
  });
  it("exposes the simulated mailbox and adapter switches", async () => {
    await call("POST", "/api/auth/password-reset/request", { body: { email: "hubcity@pharmafind.demo" } });
    expect((await call("GET", "/api/demo/outbox")).body.data.emails).toHaveLength(1);
    await call("POST", "/api/demo/adapters", { body: { emailFailing: true, licenseRegistryAvailable: false } });
    expect(app.adapters.email.failing).toBe(true);
    expect(app.adapters.licenseCheck.available).toBe(false);
    expect((await call("POST", "/api/demo/adapters", { body: { posMode: { endpoint: "https://hubcity.demo-pos.example/feed", mode: "down" } } })).status).toBe(200);
    expect((await call("POST", "/api/demo/adapters", { body: { posMode: { endpoint: "https://hubcity.demo-pos.example/feed", mode: "weird" } } })).status).toBe(400);
  });
  it("the cron endpoint runs whatever is due", async () => {
    app.clock.advance(25 * HOUR);
    const r = await call("GET", "/api/cron");
    expect(r.status).toBe(200);
    expect(r.body.data.ran.length).toBe(4);
  });
  it("demo routes can be switched off", async () => {
    const locked = createApp({ now: T0, demoEnabled: false });
    const r = await locked.api.handle({ method: "POST", path: "/api/demo/advance", query: {}, body: { hours: 1 } });
    expect(r.status).toBe(404);
  });
  it("the opportunistic background worker (autoTick) runs due jobs when requests arrive", async () => {
    const a = createApp({ now: T0, autoTick: true });
    a.clock.advance(25 * HOUR);
    await a.api.handle({ method: "GET", path: "/api/search", query: { q: "advil", lat: TTU.lat, lng: TTU.lng } });
    expect(a.services.scheduler.listJobs().every((j) => j.lastRunAt !== null)).toBe(true);
  });
});
