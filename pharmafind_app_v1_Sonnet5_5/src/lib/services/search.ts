import type { Ctx } from "../context";
import { AppError } from "../errors";
import type { Coordinates, ListingItem, SearchRecord } from "../types";
import type { CatalogService } from "./catalog";
import type { ListingService } from "./listings";
import type { PharmacyService } from "./pharmacies";

export interface SearchParams {
  q: string;
  origin?: Coordinates;
  address?: string;
  maxDistanceKm: number;
  needsAccessibleAccess: boolean;
  includeOutOfStock: boolean;
}

export interface PharmacyResult {
  pharmacy: {
    pharmacyId: string;
    name: string;
    address: string;
    city: string;
    phone: string;
    distanceKm: number;
    isAccessible: boolean | null;
    isVerified: boolean;
    directionsUrl: string;
  };
  items: ListingItem[];
}

export interface SearchResponse {
  query: string;
  origin: Coordinates;
  results: PharmacyResult[];
  totalPharmacies: number;
}

/** Search and Compare (Layer 3): matchProduct, findListings, filterVerifiedOnly, filterAccessible, rankByDistance. */
export class SearchService {
  constructor(private ctx: Ctx, private catalog: CatalogService, private listings: ListingService, private pharmacies: PharmacyService) {}

  /** Location.toCoordinates(): GPS coordinates are used as they are; a typed address goes through the Geocoding adapter. */
  private async toCoordinates(p: SearchParams): Promise<Coordinates> {
    if (p.origin) return p.origin;
    try {
      return await this.ctx.adapters.geocoding.geocode(p.address ?? "");
    } catch {
      throw new AppError("VALIDATION_ERROR", "We could not find that address. Try a different one or use your current location.");
    }
  }

  async search(p: SearchParams): Promise<SearchResponse> {
    const products = this.catalog.matchByName(p.q); // Step A: one name may match several presentations
    const origin = await this.toCoordinates(p); // Step B
    const groups = new Map<string, PharmacyResult>();

    for (const product of products) {
      for (const listing of this.listings.forProduct(product.catalogId)) {
        // Step D: Listing -> Pharmacy.isVisibleInSearch() (verified only) -> Location.distanceTo()
        if (!p.includeOutOfStock && !this.listings.isInStock(listing)) continue;
        const pharmacy = this.pharmacies.get(listing.pharmacy);
        if (!pharmacy || !this.pharmacies.isVisibleInSearch(pharmacy)) continue;
        if (p.needsAccessibleAccess && pharmacy.isAccessible !== true) continue; // filterAccessible()
        const distanceKm = this.pharmacies.distanceTo(pharmacy, origin);
        if (distanceKm > p.maxDistanceKm) continue;
        let group = groups.get(pharmacy.pharmacyId);
        if (!group) {
          const loc = this.pharmacies.getLocation(pharmacy);
          group = {
            pharmacy: {
              pharmacyId: pharmacy.pharmacyId,
              name: pharmacy.name,
              address: loc.address,
              city: loc.city,
              phone: pharmacy.phone,
              distanceKm: Math.round(distanceKm * 100) / 100,
              isAccessible: pharmacy.isAccessible,
              isVerified: this.pharmacies.isVerified(pharmacy),
              directionsUrl: this.ctx.adapters.directions.getRouteLink(origin, loc),
            },
            items: [],
          };
          groups.set(pharmacy.pharmacyId, group);
        }
        group.items.push(this.listings.toItem(listing, product));
      }
    }

    // Step E: rankByDistance(), nearest first; one line per presentation inside each pharmacy
    const results = [...groups.values()].sort((a, b) => a.pharmacy.distanceKm - b.pharmacy.distanceKm || a.pharmacy.name.localeCompare(b.pharmacy.name));
    for (const g of results) g.items.sort((a, b) => a.brandName.localeCompare(b.brandName) || a.dosage.localeCompare(b.dosage) || a.catalogId.localeCompare(b.catalogId));

    const searchId = this.ctx.db.nextId("search");
    this.ctx.db.save<SearchRecord>("searches", searchId, { searchId, queryText: p.q, origin, performedAt: this.ctx.clock.iso(), maxDistanceKm: p.maxDistanceKm, needsAccessibleAccess: p.needsAccessibleAccess });
    return { query: p.q, origin, results, totalPharmacies: results.length };
  }
}
