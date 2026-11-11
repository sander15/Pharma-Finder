import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { importFeed, searchListings, type FeedRow } from "./pharmafind.ts";

const valid: FeedRow = { catalogId: "MED-001", stock: 8, price: 4.25 };

describe("Pharmafind domain rules", () => {
  it("imports standard catalog rows and rejects invalid rows without normalization", () => {
    const result = importFeed([valid, { catalogId: "med-001", stock: 2, price: 3 }, { catalogId: "MED-002", stock: -1, price: 4 }]);
    assert.deepEqual(result.validRows, [valid]);
    assert.equal(result.rejectedRows.length, 2);
    assert.match(result.rejectedRows[0].reason, /catalog/i);
    assert.match(result.rejectedRows[1].reason, /stock/i);
  });
  it("rejects a noncompliant feed as a whole", () => {
    const result = importFeed([{ product: "MED-001", qty: 8, cost: 4.25 }]);
    assert.equal(result.accepted, false);
    assert.deepEqual(result.validRows, []);
  });
  it("returns only verified, in-stock, optionally accessible pharmacies ranked by distance", () => {
    const listings = [
      { catalogId: "MED-001", pharmacyId: "near-pending", pharmacyName: "Pending", verified: false, accessible: true, stock: 5, price: 3, distanceKm: 1, lastUpdated: "2026-11-10T12:00:00Z" },
      { catalogId: "MED-001", pharmacyId: "far", pharmacyName: "Far", verified: true, accessible: true, stock: 5, price: 2, distanceKm: 8, lastUpdated: "2026-11-10T12:00:00Z" },
      { catalogId: "MED-001", pharmacyId: "near", pharmacyName: "Near", verified: true, accessible: false, stock: 5, price: 4, distanceKm: 2, lastUpdated: "2026-11-10T12:00:00Z" },
      { catalogId: "MED-001", pharmacyId: "empty", pharmacyName: "Empty", verified: true, accessible: true, stock: 0, price: 1, distanceKm: 0.5, lastUpdated: "2026-11-10T12:00:00Z" }
    ];
    assert.deepEqual(searchListings(listings, "MED-001", true).map(x => x.pharmacyId), ["far"]);
  });
});
