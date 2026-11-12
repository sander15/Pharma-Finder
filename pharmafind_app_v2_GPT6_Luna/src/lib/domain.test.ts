import { describe, expect, it } from "vitest";
import {
  importFeedRows,
  isStale,
  geocodeDemoAddress,
  authenticateDemoUser,
  authorizePharmacyScope,
  testPosConnection,
  verificationDecision,
  createSyncLog,
  attemptEmailDelivery,
  parseStandardCsv,
  searchInventory,
  updateListing,
  type FeedRow,
  type Listing,
  type Pharmacy,
  type Product,
} from "./domain";

const now = new Date("2026-11-10T18:00:00.000Z");
const products: Product[] = [
  { catalogId: "PF-1001", brandName: "Paracetamol", genericName: "Acetaminophen", presentation: "Tableta", strength: "500 mg", packSize: "20 tabletas", category: "Alivio del dolor" },
  { catalogId: "PF-1002", brandName: "Paracetamol", genericName: "Acetaminophen", presentation: "Jarabe", strength: "120 mg / 5 ml", packSize: "120 ml", category: "Alivio del dolor" },
];
const pharmacies: Pharmacy[] = [
  { id: "farmacia-central", name: "Farmacia Central", address: "Av. Reforma 12-40, Zona 10", latitude: 14.5995, longitude: -90.5133, verified: true, accessible: true, lastUpdated: "2026-11-10T17:00:00.000Z" },
  { id: "botica-norte", name: "Botica del Norte", address: "6a Avenida 3-21, Zona 1", latitude: 14.6412, longitude: -90.5131, verified: true, accessible: false, lastUpdated: "2026-11-08T10:00:00.000Z" },
  { id: "pending-pharmacy", name: "Farmacia Pendiente", address: "Zona 4", latitude: 14.62, longitude: -90.52, verified: false, accessible: true, lastUpdated: "2026-11-10T17:00:00.000Z" },
];
const listings: Listing[] = [
  { id: "l1", pharmacyId: "farmacia-central", catalogId: "PF-1001", stock: 14, price: 18.5 },
  { id: "l2", pharmacyId: "farmacia-central", catalogId: "PF-1002", stock: 3, price: 32 },
  { id: "l3", pharmacyId: "botica-norte", catalogId: "PF-1001", stock: 8, price: 16 },
  { id: "l4", pharmacyId: "pending-pharmacy", catalogId: "PF-1001", stock: 20, price: 12 },
];

describe("consumer search", () => {
  it("returns each matching presentation, nearest pharmacy first, and hides unverified pharmacies", () => {
    const results = searchInventory("paracetamol", { latitude: 14.599, longitude: -90.515 }, products, pharmacies, listings);
    expect(results.map((result) => `${result.pharmacy.name}:${result.product.presentation}`)).toEqual([
      "Farmacia Central:Tableta",
      "Farmacia Central:Jarabe",
      "Botica del Norte:Tableta",
    ]);
    expect(results.some((result) => result.pharmacy.id === "pending-pharmacy")).toBe(false);
    expect(results[0].listing.stock).toBe(14);
  });

  it("can limit results to accessible pharmacies", () => {
    const results = searchInventory("Paracetamol", { latitude: 14.599, longitude: -90.515 }, products, pharmacies, listings, true);
    expect(results.every((result) => result.pharmacy.accessible)).toBe(true);
  });

  it("keeps out-of-stock listings visible with their exact zero stock status", () => {
    const outOfStock = listings.map((listing) => listing.id === "l2" ? { ...listing, stock: 0 } : listing);
    const results = searchInventory("Paracetamol", { latitude: 14.599, longitude: -90.515 }, products, pharmacies, outOfStock);
    expect(results.find((result) => result.listing.id === "l2")?.listing.stock).toBe(0);
  });

  it("returns a location error for an address the mock geocoder cannot resolve", () => {
    expect(geocodeDemoAddress("Zona 10, Ciudad de Guatemala")).toEqual({ latitude: 14.5995, longitude: -90.5133 });
    expect(geocodeDemoAddress("Mars Station 4")).toBeNull();
  });
});

describe("feed imports", () => {
  it("accepts only the exact standard CSV header and canonical numeric columns", () => {
    expect(parseStandardCsv("catalogId,stock,price\nPF-1001,5,20\nPF-1002,0,18.5")).toEqual([
      { catalogId: "PF-1001", stock: 5, price: 20 },
      { catalogId: "PF-1002", stock: 0, price: 18.5 },
    ]);
    expect(parseStandardCsv("catalogId,stock,price\nPF-1001, 5,20\nPF-1002,1,18,extra")[0].stock).toBeNaN();
    expect(() => parseStandardCsv("Product,Quantity,Price\nParacetamol,5,20")).toThrow("CSV header must be exactly catalogId,stock,price");
  });

  it("accepts standard catalog rows and rejects malformed rows without normalizing them", () => {
    const rows: FeedRow[] = [
      { catalogId: "PF-1001", stock: 5, price: 20 },
      { catalogId: "paracetamol 500mg", stock: 5, price: 20 },
      { catalogId: "PF-1002", stock: -1, price: 18 },
      { catalogId: "PF-1002", stock: 2.5, price: 18 },
    ];
    const imported = importFeedRows("farmacia-central", rows, products, pharmacies, listings, now);
    expect(imported.accepted).toBe(1);
    expect(imported.rejected.map((row) => row.reason)).toEqual(["Unknown catalog ID", "Stock must be a whole number at least 0", "Stock must be a whole number at least 0"]);
    expect(imported.listings.find((listing) => listing.catalogId === "PF-1001" && listing.pharmacyId === "farmacia-central")?.stock).toBe(5);
    expect(imported.listings.find((listing) => listing.catalogId === "PF-1001" && listing.pharmacyId === "farmacia-central")?.lastUpdated).toBe(now.toISOString());
    expect(imported.listings.find((listing) => listing.catalogId === "PF-1002" && listing.pharmacyId === "farmacia-central")?.lastUpdated).toBeUndefined();
  });

  it("rejects updates outside the manager's pharmacy scope", () => {
    expect(() => updateListing("farmacia-central", "botica-norte", "l3", 9, 10, listings, pharmacies, now)).toThrow("Access denied");
  });

  it("rejects invalid manual stock and price values", () => {
    expect(() => updateListing("farmacia-central", "farmacia-central", "l1", 1.2, 10, listings, pharmacies, now)).toThrow("Stock must be a whole number");
    expect(() => updateListing("farmacia-central", "farmacia-central", "l1", 1, 0, listings, pharmacies, now)).toThrow("Price must be greater than zero");
  });

  it("timestamps only the listing changed by a manual update", () => {
    const updated = updateListing("farmacia-central", "farmacia-central", "l1", 15, 19, listings, pharmacies, now);
    expect(updated.find((listing) => listing.id === "l1")?.lastUpdated).toBe(now.toISOString());
    expect(updated.find((listing) => listing.id === "l2")?.lastUpdated).toBeUndefined();
  });

  it("validates POS endpoint and pull interval before enabling the scheduled feed", () => {
    expect(testPosConnection("https://pos.demo/pharmafind", 60)).toEqual({ connected: true });
    expect(testPosConnection("not a url", 60).connected).toBe(false);
    expect(testPosConnection("https://offline.demo/feed", 60).connected).toBe(false);
    expect(testPosConnection("https://pos.demo/feed", 2).connected).toBe(false);
  });
});

describe("data freshness", () => {
  it("marks data stale only when it is older than 24 hours", () => {
    expect(isStale("2026-11-09T18:00:00.000Z", now)).toBe(false);
    expect(isStale("2026-11-09T17:59:59.000Z", now)).toBe(true);
  });
});

describe("account and verification flows", () => {
  it("authenticates the demo pharmacy and admin accounts and enforces pharmacy scope", () => {
    const manager = authenticateDemoUser("patricia@farmacia.demo", "farmacia123");
    const admin = authenticateDemoUser("admin@pharmafind.demo", "admin123");
    expect(manager?.role).toBe("pharmacy");
    expect(authorizePharmacyScope(manager!, "farmacia-central")).toBe(true);
    expect(authorizePharmacyScope(manager!, "botica-norte")).toBe(false);
    expect(admin?.role).toBe("admin");
    expect(authenticateDemoUser("patricia@farmacia.demo", "wrong")).toBeNull();
  });

  it("requires a rejection reason and returns the decision status", () => {
    expect(verificationDecision("approve")).toEqual({ status: "verified" });
    expect(verificationDecision("reject", "License did not match")).toEqual({ status: "rejected", reason: "License did not match" });
    expect(() => verificationDecision("reject", "  ")).toThrow("A rejection reason is required");
  });
});

describe("sync and email workflows", () => {
  it("records accepted and rejected counts in a sync log", () => {
    expect(createSyncLog("farmacia-central", "csv", 3, 2, now)).toMatchObject({ pharmacyId: "farmacia-central", source: "csv", acceptedRows: 3, rejectedRows: 2, status: "partial" });
  });

  it("marks failed email deliveries and records a successful retry", () => {
    const failed = attemptEmailDelivery("stale-alert-1", true, now);
    expect(failed.status).toBe("failed");
    const retried = attemptEmailDelivery(failed.id, false, now, failed.attempts);
    expect(retried).toMatchObject({ id: failed.id, status: "sent", attempts: 2 });
  });
});
