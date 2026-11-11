import { ageMinutes, STALE_AFTER_MS, type Ctx } from "../context";
import { AppError } from "../errors";
import type { Listing, ListingItem, Product } from "../types";
import type { CatalogService } from "./catalog";
import type { PharmacyService } from "./pharmacies";

export const MAX_STOCK = 1_000_000;
export const MAX_PRICE = 100_000;
export const LOW_STOCK_AT_MOST = 5;

export const listingIdFor = (pharmacyId: string, catalogId: string) => `lst-${pharmacyId}-${catalogId}`;

/** Validates stock/price values that come from the manual editor (JSON numbers). Feed Import has its own strict row checks. */
export function validateStockAndPrice(stock: unknown, price: unknown): { stock: number; price: number } {
  if (typeof stock !== "number" || !Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) {
    throw new AppError("VALIDATION_ERROR", `Stock must be a whole number between 0 and ${MAX_STOCK}`);
  }
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) {
    throw new AppError("VALIDATION_ERROR", `Price must be a positive amount with at most 2 decimals (max ${MAX_PRICE})`);
  }
  return { stock, price };
}

/** Listing entity (stock + price of one product at one pharmacy). */
export class ListingService {
  constructor(private ctx: Ctx, private catalog: CatalogService, private pharmacies: PharmacyService) {}

  isInStock(l: Listing): boolean {
    return l.stock > 0;
  }

  /** Builds the client-facing line. All time values come from the SERVER clock, so label and flag can never disagree. */
  toItem(l: Listing, product: Product): ListingItem {
    const stockStatus = l.stock === 0 ? "out_of_stock" : l.stock <= LOW_STOCK_AT_MOST ? "low_stock" : "in_stock";
    return {
      listingId: l.listingId,
      catalogId: product.catalogId,
      brandName: product.brandName,
      genericName: product.genericName,
      presentation: product.presentation,
      dosage: product.dosage,
      stock: l.stock,
      stockStatus,
      price: l.price,
      lastUpdated: l.lastUpdated,
      ageMinutes: ageMinutes(this.ctx, l.lastUpdated),
      isStale: this.ctx.clock.now().getTime() - new Date(l.lastUpdated).getTime() > STALE_AFTER_MS,
    };
  }

  get(listingId: string): Listing | undefined {
    return this.ctx.db.get<Listing>("listings", listingId);
  }

  /** Product.getListings() */
  forProduct(catalogId: string): Listing[] {
    return this.ctx.db.query<Listing>("listings", (l) => l.product === catalogId);
  }

  /** Pharmacy.getListings() */
  forPharmacy(pharmacyId: string): Listing[] {
    return this.ctx.db.query<Listing>("listings", (l) => l.pharmacy === pharmacyId);
  }

  itemsForPharmacy(pharmacyId: string): ListingItem[] {
    return this.forPharmacy(pharmacyId)
      .map((l) => ({ l, p: this.catalog.getProduct(l.product) }))
      .filter((x): x is { l: Listing; p: Product } => !!x.p)
      .map(({ l, p }) => this.toItem(l, p))
      .sort((a, b) => a.brandName.localeCompare(b.brandName) || a.dosage.localeCompare(b.dosage) || a.catalogId.localeCompare(b.catalogId));
  }

  /** Writes a listing with lastUpdated = now (shared by the editor and Feed Import). */
  save(pharmacyId: string, catalogId: string, stock: number, price: number): Listing {
    const listingId = listingIdFor(pharmacyId, catalogId);
    return this.ctx.db.save<Listing>("listings", listingId, { listingId, pharmacy: pharmacyId, product: catalogId, stock, price, lastUpdated: this.ctx.clock.iso() });
  }

  /** Manual entry: updateStock() + updatePrice() on an existing listing of the manager's own pharmacy. */
  update(pharmacyId: string, listingId: string, stockIn: unknown, priceIn: unknown): ListingItem {
    const existing = this.get(listingId);
    if (!existing || existing.pharmacy !== pharmacyId) throw new AppError("NOT_FOUND", "Listing not found");
    const { stock, price } = validateStockAndPrice(stockIn, priceIn);
    const saved = this.save(pharmacyId, existing.product, stock, price);
    this.pharmacies.recordSync(pharmacyId, null, true, `Manual update of ${existing.product}`);
    return this.toItem(saved, this.catalog.getProduct(existing.product)!);
  }

  create(pharmacyId: string, catalogId: string, stockIn: unknown, priceIn: unknown): ListingItem {
    const product = this.catalog.getProduct(catalogId);
    if (!product) throw new AppError("VALIDATION_ERROR", `Unknown catalog id ${catalogId}`);
    if (this.get(listingIdFor(pharmacyId, catalogId))) throw new AppError("CONFLICT", "This product is already listed; edit the existing listing");
    const { stock, price } = validateStockAndPrice(stockIn, priceIn);
    const saved = this.save(pharmacyId, catalogId, stock, price);
    this.pharmacies.recordSync(pharmacyId, null, true, `Manual listing of ${catalogId}`);
    return this.toItem(saved, product);
  }
}
