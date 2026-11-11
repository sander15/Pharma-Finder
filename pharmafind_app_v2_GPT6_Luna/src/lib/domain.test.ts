import { describe, expect, it } from "vitest";
import {
  importFeedRows,
  isStale,
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

  it("does not present out-of-stock listings as available search results", () => {
    const outOfStock = listings.map((listing) => listing.id === "l2" ? { ...listing, stock: 0 } : listing);
    const results = searchInventory("Paracetamol", { latitude: 14.599, longitude: -90.515 }, products, pharmacies, outOfStock);
    expect(results.some((result) => result.listing.stock === 0)).toBe(false);
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
  });

  it("rejects updates outside the manager's pharmacy scope", () => {
    expect(() => updateListing("farmacia-central", "botica-norte", "l3", 9, 10, listings, pharmacies, now)).toThrow("Access denied");
  });

  it("rejects invalid manual stock and price values", () => {
    expect(() => updateListing("farmacia-central", "farmacia-central", "l1", 1.2, 10, listings, pharmacies, now)).toThrow("Stock must be a whole number");
    expect(() => updateListing("farmacia-central", "farmacia-central", "l1", 1, 0, listings, pharmacies, now)).toThrow("Price must be greater than zero");
  });
});

describe("data freshness", () => {
  it("marks data stale only when it is older than 24 hours", () => {
    expect(isStale("2026-11-09T18:00:00.000Z", now)).toBe(false);
    expect(isStale("2026-11-09T17:59:59.000Z", now)).toBe(true);
  });
});
