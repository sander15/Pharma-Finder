import type { Ctx } from "../context";
import { AppError } from "../errors";
import type { Listing, Product } from "../types";

export interface ListingInput {
  catalogId?: unknown;
  stock?: unknown;
  price?: unknown;
}

const MAX_STOCK = 1_000_000;
const MAX_PRICE = 100_000;

/** Entity Listing: validate(), updateStock(), updatePrice(), isInStock(). */
export class ListingService {
  constructor(private ctx: Ctx) {}

  getListing(pharmacyId: string, catalogId: string): Listing | undefined {
    return this.ctx.db.query<Listing>("listings", (l) => l.pharmacy === pharmacyId && l.product === catalogId)[0];
  }

  getListings(pharmacyId: string): Listing[] {
    return this.ctx.db.query<Listing>("listings", (l) => l.pharmacy === pharmacyId).sort((a, b) => a.product.localeCompare(b.product));
  }

  getListingsForProduct(catalogId: string): Listing[] {
    return this.ctx.db.query<Listing>("listings", (l) => l.product === catalogId);
  }

  isInStock(l: Listing): boolean {
    return l.stock > 0;
  }

  /**
   * Strict validation (no coercion): catalogId must be a known Pharmafind catalog ID, stock a
   * whole number >= 0, price a number > 0 with at most 2 decimals.
   */
  validate(input: ListingInput): { catalogId: string; stock: number; price: number } {
    const problems: Array<{ field: string; message: string }> = [];
    const { catalogId, stock, price } = input;

    if (typeof catalogId !== "string" || !this.ctx.db.get<Product>("products", catalogId)) {
      problems.push({ field: "catalogId", message: "Unknown catalog ID (must match the Pharmafind catalog exactly)" });
    }
    if (typeof stock !== "number" || !Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) {
      problems.push({ field: "stock", message: `Stock must be a whole number between 0 and ${MAX_STOCK}` });
    }
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) {
      problems.push({ field: "price", message: "Price must be a positive number with at most 2 decimals" });
    }
    if (problems.length) throw new AppError("VALIDATION_ERROR", `Invalid listing: ${problems.map((p) => p.message).join("; ")}`, problems);
    return { catalogId: catalogId as string, stock: stock as number, price: price as number };
  }

  /** updateStock() + updatePrice() + validate(): creates the listing if the pharmacy did not stock it yet. */
  setListing(pharmacyId: string, input: ListingInput): Listing {
    const v = this.validate(input);
    const existing = this.getListing(pharmacyId, v.catalogId);
    const listing: Listing = {
      listingId: existing?.listingId ?? `lst-${pharmacyId}-${v.catalogId}`,
      pharmacy: pharmacyId,
      product: v.catalogId,
      stock: v.stock,
      price: v.price,
      lastUpdated: this.ctx.clock.iso(),
    };
    return this.ctx.db.save("listings", listing.listingId, listing);
  }
}
