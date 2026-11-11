export type Coordinates = { latitude: number; longitude: number };
export type Product = {
  catalogId: string;
  brandName: string;
  genericName: string;
  presentation: string;
  strength: string;
  packSize: string;
  category: string;
};
export type Pharmacy = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  verified: boolean;
  accessible: boolean | null;
  lastUpdated: string;
};
export type Listing = { id: string; pharmacyId: string; catalogId: string; stock: number; price: number };
export type SearchResult = { pharmacy: Pharmacy; product: Product; listing: Listing; distanceKm: number };
export type FeedRow = { catalogId: string; stock: number; price: number };
export type RejectedFeedRow = { row: number; reason: string };

export function parseStandardCsv(contents: string): FeedRow[] {
  const lines = contents.split(/\r?\n/);
  if (lines[0] !== "catalogId,stock,price") throw new Error("CSV header must be exactly catalogId,stock,price");
  return lines.slice(1).filter((line, index, all) => line !== "" || index < all.length - 1).map((line) => {
    const columns = line.split(",");
    if (columns.length !== 3) return { catalogId: columns[0] ?? "", stock: Number.NaN, price: Number.NaN };
    const [catalogId, stockText, priceText] = columns;
    const canonicalInteger = /^(0|[1-9]\d*)$/.test(stockText);
    const canonicalPrice = /^(0|[1-9]\d*)(\.\d+)?$/.test(priceText);
    return { catalogId, stock: canonicalInteger ? Number(stockText) : Number.NaN, price: canonicalPrice ? Number(priceText) : Number.NaN };
  });
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
export function distanceKm(from: Coordinates, to: Coordinates): number {
  const earthRadius = 6371;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function searchInventory(query: string, origin: Coordinates, products: Product[], pharmacies: Pharmacy[], listings: Listing[], accessibleOnly = false): SearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const matchingProducts = products.filter((product) => [product.brandName, product.genericName, product.category].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
  const pharmacyById = new Map(pharmacies.filter((pharmacy) => pharmacy.verified).map((pharmacy) => [pharmacy.id, pharmacy]));
  const productById = new Map(matchingProducts.map((product) => [product.catalogId, product]));
  return listings.flatMap((listing) => {
    const pharmacy = pharmacyById.get(listing.pharmacyId);
    const product = productById.get(listing.catalogId);
    if (!pharmacy || !product || listing.stock <= 0 || (accessibleOnly && pharmacy.accessible !== true)) return [];
    return [{ pharmacy, product, listing, distanceKm: distanceKm(origin, pharmacy) }];
  }).sort((a, b) => a.distanceKm - b.distanceKm || a.listing.price - b.listing.price);
}

export function isStale(lastUpdated: string, now = new Date()): boolean {
  return now.getTime() - new Date(lastUpdated).getTime() > 24 * 60 * 60 * 1000;
}

export function updateListing(managerPharmacyId: string, targetPharmacyId: string, listingId: string, stock: number, price: number, listings: Listing[], pharmacies: Pharmacy[], now = new Date()): Listing[] {
  if (managerPharmacyId !== targetPharmacyId || !pharmacies.some((pharmacy) => pharmacy.id === managerPharmacyId)) throw new Error("Access denied: managers can only update their own pharmacy");
  if (!Number.isInteger(stock) || stock < 0) throw new Error("Stock must be a whole number at least 0");
  if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be greater than zero");
  const target = listings.find((listing) => listing.id === listingId && listing.pharmacyId === managerPharmacyId);
  if (!target) throw new Error("Listing not found");
  return listings.map((listing) => listing.id === listingId ? { ...listing, stock, price } : listing);
}

export function importFeedRows(pharmacyId: string, rows: FeedRow[], products: Product[], pharmacies: Pharmacy[], listings: Listing[], now = new Date()): { accepted: number; rejected: RejectedFeedRow[]; listings: Listing[]; pharmacy: Pharmacy } {
  const pharmacy = pharmacies.find((item) => item.id === pharmacyId);
  if (!pharmacy) throw new Error("Pharmacy not found");
  const knownCatalogIds = new Set(products.map((product) => product.catalogId));
  const rejected: RejectedFeedRow[] = [];
  let nextListings = [...listings];
  rows.forEach((row, index) => {
    if (typeof row.catalogId !== "string" || !knownCatalogIds.has(row.catalogId)) {
      rejected.push({ row: index + 1, reason: "Unknown catalog ID" });
      return;
    }
    if (!Number.isInteger(row.stock) || row.stock < 0) {
      rejected.push({ row: index + 1, reason: "Stock must be a whole number at least 0" });
      return;
    }
    if (!Number.isFinite(row.price) || row.price <= 0) {
      rejected.push({ row: index + 1, reason: "Price must be greater than zero" });
      return;
    }
    const existing = nextListings.find((listing) => listing.pharmacyId === pharmacyId && listing.catalogId === row.catalogId);
    if (existing) nextListings = nextListings.map((listing) => listing.id === existing.id ? { ...listing, stock: row.stock, price: row.price } : listing);
    else nextListings.push({ id: `${pharmacyId}-${row.catalogId}`, pharmacyId, catalogId: row.catalogId, stock: row.stock, price: row.price });
  });
  return { accepted: rows.length - rejected.length, rejected, listings: nextListings, pharmacy: { ...pharmacy, lastUpdated: now.toISOString() } };
}
