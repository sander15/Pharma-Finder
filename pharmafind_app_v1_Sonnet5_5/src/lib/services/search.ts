import { STALE_AFTER_MS, type Ctx } from "../context";
import { AppError } from "../errors";
import { distanceKm } from "../geo";
import type { Coordinates, Pharmacy, SearchRecord } from "../types";
import type { CatalogService } from "./catalog";
import type { ListingService } from "./listings";
import type { PharmacyService } from "./pharmacies";

export type SearchOrigin = Coordinates | { address: string };

export interface SearchInput {
  queryText: string;
  origin: SearchOrigin;
  maxDistanceKm?: number;
  needsAccessibleAccess?: boolean;
  inStockOnly?: boolean;
}

export interface ListingResult {
  listingId: string;
  pharmacyId: string;
  pharmacyName: string;
  address: string;
  phone: string;
  distanceKm: number;
  stock: number;
  inStock: boolean;
  price: number;
  lastUpdated: string;
  isStale: boolean;
  isAccessible: boolean;
  verified: true;
  directionsUrl: string;
}

export interface ProductGroup {
  product: { catalogId: string; brandName: string; genericName: string; presentation: string; dosage: string };
  alternatives: string[]; // other brands with the same active ingredient
  listings: ListingResult[];
}

export interface SearchResponse {
  searchId: string;
  queryText: string;
  origin: Coordinates & { address?: string };
  groups: ProductGroup[];
}

const DEFAULT_MAX_KM = 50;
const MAX_STORED_SEARCHES = 500;

/**
 * Search and Compare (Layer 3). Follows sequence diagram 1: geocode origin -> Product.matchesName ->
 * Product.getListings -> Listing.isInStock / Pharmacy.isVisibleInSearch / Location.distanceTo ->
 * filterVerifiedOnly -> filterAccessible -> rankByDistance, results grouped per presentation+dosage.
 */
export class SearchService {
  constructor(
    private ctx: Ctx,
    private catalog: CatalogService,
    private listings: ListingService,
    private pharmacies: PharmacyService,
  ) {}

  async resolveOrigin(origin: SearchOrigin): Promise<Coordinates & { address?: string }> {
    if ("address" in origin) {
      const hit = await this.ctx.adapters.geocoding.geocode(origin.address);
      if (!hit) throw new AppError("ADDRESS_NOT_FOUND", `We couldn't find "${origin.address}". Try a landmark or street address in the demo city.`);
      return { latitude: hit.latitude, longitude: hit.longitude, address: hit.address };
    }
    const { latitude, longitude } = origin;
    const okLat = typeof latitude === "number" && latitude >= -90 && latitude <= 90;
    const okLng = typeof longitude === "number" && longitude >= -180 && longitude <= 180;
    if (!okLat || !okLng) throw new AppError("VALIDATION_ERROR", "Invalid coordinates");
    return { latitude, longitude };
  }

  async search(input: SearchInput): Promise<SearchResponse> {
    const queryText = typeof input.queryText === "string" ? input.queryText.trim() : "";
    if (queryText.length < 2) throw new AppError("VALIDATION_ERROR", "Enter at least 2 characters of a medicine name");
    const maxKm = input.maxDistanceKm ?? DEFAULT_MAX_KM;
    if (typeof maxKm !== "number" || !(maxKm > 0) || maxKm > 500) throw new AppError("VALIDATION_ERROR", "maxDistanceKm must be between 0 and 500");

    const origin = await this.resolveOrigin(input.origin);
    const inStockOnly = input.inStockOnly ?? true;
    const needsAccessible = input.needsAccessibleAccess ?? false;
    const now = this.ctx.clock.now().getTime();

    const groups: ProductGroup[] = [];
    for (const product of this.catalog.matchProducts(queryText)) {
      const results: ListingResult[] = [];
      for (const listing of this.listings.getListingsForProduct(product.catalogId)) {
        const pharmacy = this.ctx.db.get<Pharmacy>("pharmacies", listing.pharmacy);
        if (!pharmacy || !this.pharmacies.isVisibleInSearch(pharmacy)) continue; // filterVerifiedOnly
        if (needsAccessible && !pharmacy.isAccessible) continue; // filterAccessible
        const inStock = this.listings.isInStock(listing);
        if (inStockOnly && !inStock) continue;
        const location = this.pharmacies.location(pharmacy);
        const distance = distanceKm(origin, location);
        if (distance > maxKm) continue;
        results.push({
          listingId: listing.listingId, pharmacyId: pharmacy.pharmacyId, pharmacyName: pharmacy.name, address: location.address, phone: pharmacy.phone,
          distanceKm: Math.round(distance * 100) / 100, stock: listing.stock, inStock, price: listing.price, lastUpdated: listing.lastUpdated,
          isStale: now - new Date(listing.lastUpdated).getTime() > STALE_AFTER_MS, isAccessible: pharmacy.isAccessible, verified: true,
          directionsUrl: this.ctx.adapters.directions.getRouteLink(origin, location),
        });
      }
      if (results.length === 0) continue;
      results.sort((a, b) => a.distanceKm - b.distanceKm); // rankByDistance

      const alternatives = [...new Set((await this.catalog.getGenericAlternatives(product.reference)).map((r) => r.brandName))];
      groups.push({
        product: { catalogId: product.catalogId, brandName: product.brandName, genericName: product.genericName, presentation: product.presentation, dosage: product.dosage },
        alternatives,
        listings: results,
      });
    }
    groups.sort((a, b) => a.listings[0].distanceKm - b.listings[0].distanceKm || a.product.catalogId.localeCompare(b.product.catalogId));

    return { searchId: this.record(queryText, origin, maxKm, needsAccessible), queryText, origin, groups };
  }

  private record(queryText: string, origin: Coordinates, maxKm: number, needsAccessible: boolean): string {
    const searchId = this.ctx.db.nextId("search");
    this.ctx.db.save<SearchRecord>("searches", searchId, {
      searchId, queryText, origin: { latitude: origin.latitude, longitude: origin.longitude }, performedAt: this.ctx.clock.iso(), maxDistanceKm: maxKm, needsAccessibleAccess: needsAccessible,
    });
    const n = Number(searchId.split("-")[1]);
    if (n > MAX_STORED_SEARCHES) this.ctx.db.remove("searches", `search-${n - MAX_STORED_SEARCHES}`); // keep the demo's memory bounded
    return searchId;
  }
}
