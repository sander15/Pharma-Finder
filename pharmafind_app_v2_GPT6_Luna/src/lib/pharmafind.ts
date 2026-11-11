export type Coordinates = { latitude: number; longitude: number };
export type Pharmacy = { id: string; name: string; verified: boolean; optedIn: boolean; accessible: boolean | null; latitude: number; longitude: number; address?: string; phone?: string; licenseNumber?: string; lastSyncAt?: string; feedEndpoint?: string; feedEnabled?: boolean };
export type Product = { id: string; catalogId: string; brandName: string; genericName: string; presentation: string; dosage: string; packSize: string; description?: string };
export type Listing = { id: string; pharmacyId: string; productId: string; stock: number; price: number; updatedAt: string };
export type DemoState = { pharmacies: Pharmacy[]; products: Product[]; listings: Listing[] };
export type SearchResult = Product & { listingId: string; pharmacyId: string; pharmacyName: string; address?: string; phone?: string; distanceKm: number; latitude: number; longitude: number; stock: number; price: number; updatedAt: string; isStale: boolean; accessible: boolean | null; verified: boolean };
export type FeedRow = { catalogId: string; stock: number; price: number };
export type ImportSummary = { accepted: number; rejected: number; errors: string[]; importedAt: string };

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const SEED_STATE: DemoState = {
  pharmacies: [
    { id: 'farmacia-central', name: 'Farmacia Central', verified: true, optedIn: true, accessible: true, latitude: 9.9333, longitude: -84.0833, address: 'Avenida Central, San José', phone: '+506 2222 0101', lastSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { id: 'farmacia-del-parque', name: 'Farmacia del Parque', verified: true, optedIn: true, accessible: false, latitude: 9.9368, longitude: -84.0795, address: 'Parque Central, San José', phone: '+506 2222 0202', lastSyncAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() },
    { id: 'farmacia-norte', name: 'Farmacia Norte', verified: true, optedIn: true, accessible: null, latitude: 9.9490, longitude: -84.0800, address: 'Barrio Amón, San José', phone: '+506 2222 0303', lastSyncAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
    { id: 'farmacia-demo-pending', name: 'Farmacia Demo (Pending)', verified: false, optedIn: true, accessible: true, latitude: 9.9400, longitude: -84.0700, address: 'San José', lastSyncAt: new Date().toISOString() },
  ],
  products: [
    { id: 'prod-acet-tablet', catalogId: 'PF-ACET-500-TAB', brandName: 'PainAway', genericName: 'Acetaminophen', presentation: 'Tablet', dosage: '500 mg', packSize: '20 tablets', description: 'For pain and fever relief.' },
    { id: 'prod-acet-syrup', catalogId: 'PF-ACET-250-SYR', brandName: 'PainAway Kids', genericName: 'Acetaminophen', presentation: 'Oral suspension', dosage: '250 mg/5 mL', packSize: '120 mL', description: 'Liquid presentation.' },
    { id: 'prod-ibuprofen', catalogId: 'PF-IBU-200-TAB', brandName: 'Reliefen', genericName: 'Ibuprofen', presentation: 'Tablet', dosage: '200 mg', packSize: '24 tablets', description: 'Non-prescription pain relief.' },
    { id: 'prod-loratadine', catalogId: 'PF-LORA-10-TAB', brandName: 'AllerFree', genericName: 'Loratadine', presentation: 'Tablet', dosage: '10 mg', packSize: '10 tablets', description: 'Non-drowsy allergy relief.' },
  ],
  listings: [
    { id: 'list-1', pharmacyId: 'farmacia-central', productId: 'prod-acet-tablet', stock: 18, price: 1250, updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { id: 'list-2', pharmacyId: 'farmacia-del-parque', productId: 'prod-acet-tablet', stock: 0, price: 1125, updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() },
    { id: 'list-3', pharmacyId: 'farmacia-norte', productId: 'prod-acet-tablet', stock: 7, price: 1190, updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
    { id: 'list-4', pharmacyId: 'farmacia-central', productId: 'prod-acet-syrup', stock: 5, price: 2350, updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { id: 'list-5', pharmacyId: 'farmacia-del-parque', productId: 'prod-acet-syrup', stock: 3, price: 2200, updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() },
    { id: 'list-6', pharmacyId: 'farmacia-central', productId: 'prod-ibuprofen', stock: 22, price: 1800, updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { id: 'list-7', pharmacyId: 'farmacia-norte', productId: 'prod-ibuprofen', stock: 4, price: 1690, updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
    { id: 'list-8', pharmacyId: 'farmacia-del-parque', productId: 'prod-loratadine', stock: 12, price: 2450, updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() },
  ],
};

export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude); const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function searchProducts(state: DemoState, options: { query: string; origin: Coordinates; accessibleOnly?: boolean; now?: Date }): SearchResult[] {
  const q = options.query.trim().toLocaleLowerCase();
  if (!q) return [];
  const now = options.now ?? new Date();
  const products = state.products.filter((p) => p.brandName.toLocaleLowerCase().includes(q) || p.genericName.toLocaleLowerCase().includes(q));
  const matches: SearchResult[] = [];
  for (const listing of state.listings) {
    const product = products.find((p) => p.id === listing.productId);
    const pharmacy = state.pharmacies.find((p) => p.id === listing.pharmacyId);
    if (!product || !pharmacy || !pharmacy.optedIn || !pharmacy.verified) continue;
    if (options.accessibleOnly && pharmacy.accessible !== true) continue;
    matches.push({ ...product, listingId: listing.id, pharmacyId: pharmacy.id, pharmacyName: pharmacy.name, address: pharmacy.address, phone: pharmacy.phone, distanceKm: distanceKm(options.origin, pharmacy), latitude: pharmacy.latitude, longitude: pharmacy.longitude, stock: listing.stock, price: listing.price, updatedAt: listing.updatedAt, isStale: now.getTime() - new Date(listing.updatedAt).getTime() > STALE_AFTER_MS, accessible: pharmacy.accessible, verified: pharmacy.verified });
  }
  return matches.sort((a, b) => a.distanceKm - b.distanceKm || a.price - b.price);
}

export function updateManualListing(state: DemoState, pharmacyId: string, listingId: string, stock: number, price: number, actorPharmacyId = pharmacyId, now = new Date()): void {
  if (actorPharmacyId !== pharmacyId) throw new Error('Access denied: managers may only update their own pharmacy.');
  if (!Number.isInteger(stock) || stock < 0) throw new Error('Stock must be a whole number of zero or more.');
  if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be greater than zero.');
  const listing = state.listings.find((item) => item.id === listingId && item.pharmacyId === pharmacyId);
  if (!listing) throw new Error('Listing not found for this pharmacy.');
  listing.stock = stock; listing.price = price; listing.updatedAt = now.toISOString();
  const pharmacy = state.pharmacies.find((item) => item.id === pharmacyId);
  if (pharmacy) pharmacy.lastSyncAt = now.toISOString();
}

export function importFeed(state: DemoState, pharmacyId: string, rows: FeedRow[], now = new Date(), actorPharmacyId = pharmacyId): ImportSummary {
  if (actorPharmacyId !== pharmacyId) throw new Error('Access denied: managers may only import for their own pharmacy.');
  if (!state.pharmacies.some((pharmacy) => pharmacy.id === pharmacyId)) throw new Error('Pharmacy not found.');
  const errors: string[] = []; let accepted = 0;
  rows.forEach((row, index) => {
    const product = state.products.find((item) => item.catalogId === row.catalogId);
    if (!product) { errors.push(`Row ${index + 1}: unknown Pharmafind catalog ID.`); return; }
    if (!Number.isInteger(row.stock) || row.stock < 0) { errors.push(`Row ${index + 1}: stock must be a whole number of zero or more.`); return; }
    if (!Number.isFinite(row.price) || row.price <= 0) { errors.push(`Row ${index + 1}: price must be greater than zero.`); return; }
    const existing = state.listings.find((item) => item.pharmacyId === pharmacyId && item.productId === product.id);
    if (existing) { existing.stock = row.stock; existing.price = row.price; existing.updatedAt = now.toISOString(); }
    else state.listings.push({ id: `list-${Date.now()}-${accepted}`, pharmacyId, productId: product.id, stock: row.stock, price: row.price, updatedAt: now.toISOString() });
    accepted += 1;
  });
  const pharmacy = state.pharmacies.find((item) => item.id === pharmacyId);
  if (accepted && pharmacy) pharmacy.lastSyncAt = now.toISOString();
  return { accepted, rejected: errors.length, errors, importedAt: now.toISOString() };
}

export function parseStandardCsv(contents: string): FeedRow[] {
  const lines = contents.trim().split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== 'catalogId,stock,price') throw new Error('CSV header must be exactly: catalogId,stock,price');
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split(',').map((part) => part.trim());
    if (cols.length !== 3) return { catalogId: '', stock: Number.NaN, price: Number.NaN };
    return { catalogId: cols[0], stock: Number(cols[1]), price: Number(cols[2]) };
  });
}

