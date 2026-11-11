export type FeedRow = { catalogId: string; stock: number; price: number };
export type RejectedRow = { row: unknown; rowNumber: number; reason: string };
export type ImportResult = { accepted: boolean; totalRows: number; validRows: FeedRow[]; rejectedRows: RejectedRow[]; syncedAt: string | null };
export type Listing = FeedRow & { pharmacyId: string; pharmacyName: string; verified: boolean; accessible: boolean; distanceKm: number; lastUpdated: string };

export const products = [
  { catalogId: "MED-001", brandName: "Dolorin", genericName: "Acetaminophen", presentation: "Tablets", dosage: "500 mg", description: "Pain and fever relief" },
  { catalogId: "MED-002", brandName: "Amoxil", genericName: "Amoxicillin", presentation: "Capsules", dosage: "500 mg", description: "Antibiotic" },
  { catalogId: "MED-003", brandName: "Lorat", genericName: "Loratadine", presentation: "Tablets", dosage: "10 mg", description: "Non-drowsy allergy relief" },
  { catalogId: "MED-004", brandName: "Metfor", genericName: "Metformin", presentation: "Tablets", dosage: "850 mg", description: "Blood glucose management" },
  { catalogId: "MED-005", brandName: "Salbutamol", genericName: "Salbutamol", presentation: "Inhaler", dosage: "100 mcg/dose", description: "Relief inhaler" }
];

const initial: Listing[] = [
  { catalogId: "MED-001", pharmacyId: "farmacia-central", pharmacyName: "Farmacia Central", verified: true, accessible: true, stock: 24, price: 3.2, distanceKm: 1.2, lastUpdated: "2026-11-10T15:42:00.000Z" },
  { catalogId: "MED-001", pharmacyId: "salud-norte", pharmacyName: "Farmacia Salud Norte", verified: true, accessible: false, stock: 8, price: 2.85, distanceKm: 3.6, lastUpdated: "2026-11-10T14:18:00.000Z" },
  { catalogId: "MED-001", pharmacyId: "botica-verde", pharmacyName: "Botica Verde", verified: true, accessible: true, stock: 0, price: 3.05, distanceKm: 5.1, lastUpdated: "2026-11-09T16:10:00.000Z" },
  { catalogId: "MED-001", pharmacyId: "farmacia-pending", pharmacyName: "Farmacia La Esperanza", verified: false, accessible: true, stock: 17, price: 2.5, distanceKm: 0.8, lastUpdated: "2026-11-10T14:00:00.000Z" },
  { catalogId: "MED-002", pharmacyId: "farmacia-central", pharmacyName: "Farmacia Central", verified: true, accessible: true, stock: 7, price: 8.4, distanceKm: 1.2, lastUpdated: "2026-11-10T15:42:00.000Z" },
  { catalogId: "MED-002", pharmacyId: "salud-norte", pharmacyName: "Farmacia Salud Norte", verified: true, accessible: false, stock: 14, price: 7.9, distanceKm: 3.6, lastUpdated: "2026-11-10T14:18:00.000Z" },
  { catalogId: "MED-003", pharmacyId: "farmacia-central", pharmacyName: "Farmacia Central", verified: true, accessible: true, stock: 12, price: 5.1, distanceKm: 1.2, lastUpdated: "2026-11-10T15:42:00.000Z" },
  { catalogId: "MED-004", pharmacyId: "botica-verde", pharmacyName: "Botica Verde", verified: true, accessible: true, stock: 36, price: 6.75, distanceKm: 5.1, lastUpdated: "2026-11-09T16:10:00.000Z" },
  { catalogId: "MED-005", pharmacyId: "salud-norte", pharmacyName: "Farmacia Salud Norte", verified: true, accessible: false, stock: 4, price: 12.6, distanceKm: 3.6, lastUpdated: "2026-11-10T14:18:00.000Z" }
];
let listings = initial.map(x => ({ ...x }));
export function getListings() { return listings.map(x => ({ ...x })); }
export function resetDemoData() { listings = initial.map(x => ({ ...x })); }

export function importFeed(input: unknown[]): ImportResult {
  const errors: RejectedRow[] = [];
  const valid: FeedRow[] = [];
  const catalogIds = new Set(products.map(p => p.catalogId));
  const exactKeys = (row: Record<string, unknown>) => Object.keys(row).sort().join(",") === "catalogId,price,stock";
  input.forEach((raw, index) => {
    const row = raw as Record<string, unknown> | null;
    let reason = "";
    if (!row || typeof row !== "object" || Array.isArray(row) || !exactKeys(row)) reason = "Row must use exactly catalogId, stock, and price fields.";
    else if (typeof row.catalogId !== "string" || !catalogIds.has(row.catalogId)) reason = "Unknown or invalid catalog ID; catalog IDs must match exactly.";
    else if (typeof row.stock !== "number" || !Number.isInteger(row.stock) || row.stock < 0) reason = "Stock must be a non-negative whole number.";
    else if (typeof row.price !== "number" || !Number.isFinite(row.price) || row.price < 0) reason = "Price must be a non-negative number.";
    if (reason) errors.push({ row: raw, rowNumber: index + 1, reason });
    else valid.push({ catalogId: row!.catalogId as string, stock: row!.stock as number, price: row!.price as number });
  });
  // A feed with structural/schema noncompliance is rejected as a whole. Validly-shaped rows
  // with domain errors are reported individually and do not block other valid rows.
  const schemaRejected = errors.some(e => e.reason.startsWith("Row must use exactly"));
  if (!schemaRejected && valid.length) {
    for (const row of valid) {
      const existing = listings.find(x => x.catalogId === row.catalogId && x.pharmacyId === "farmacia-central");
      if (existing) Object.assign(existing, row, { lastUpdated: new Date().toISOString() });
      else listings.push({ ...row, pharmacyId: "farmacia-central", pharmacyName: "Farmacia Central", verified: true, accessible: true, distanceKm: 1.2, lastUpdated: new Date().toISOString() });
    }
  }
  const accepted = !schemaRejected;
  return { accepted, totalRows: input.length, validRows: schemaRejected ? [] : valid, rejectedRows: errors, syncedAt: accepted && valid.length ? new Date().toISOString() : null };
}

export function searchListings(all: Listing[], catalogId: string, accessibleOnly = false): Listing[] {
  return all.filter(x => x.catalogId === catalogId && x.verified && x.stock > 0 && (!accessibleOnly || x.accessible)).sort((a, b) => a.distanceKm - b.distanceKm);
}

export function searchProducts(query: string) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  return products.filter(p => `${p.brandName} ${p.genericName} ${p.presentation} ${p.dosage} ${p.catalogId}`.toLocaleLowerCase().includes(q));
}

export const pharmacies = [
  { id: "farmacia-central", name: "Farmacia Central", verification: "Verified", accessible: true, lastSync: "Today, 9:42 AM", stale: false, address: "Av. Central, San José", phone: "+506 2222 0140" },
  { id: "salud-norte", name: "Farmacia Salud Norte", verification: "Verified", accessible: false, lastSync: "Today, 8:18 AM", stale: false, address: "Calle 7, Barrio Amón", phone: "+506 2222 0182" },
  { id: "botica-verde", name: "Botica Verde", verification: "Verified", accessible: true, lastSync: "Yesterday, 10:10 AM", stale: true, address: "Paseo Colón, San José", phone: "+506 2222 0169" },
  { id: "farmacia-pending", name: "Farmacia La Esperanza", verification: "Pending review", accessible: true, lastSync: "Today, 8:00 AM", stale: false, address: "San Pedro, Montes de Oca", phone: "+506 2222 0118" }
];

