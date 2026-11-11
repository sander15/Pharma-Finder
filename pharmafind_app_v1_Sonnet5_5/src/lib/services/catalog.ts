import type { Ctx } from "../context";
import type { DrugReferenceEntry, Product } from "../types";

/** Product Catalog (Layer 3): Product + DrugReferenceEntry behaviour. */
export class CatalogService {
  constructor(private ctx: Ctx) {}

  listProducts(): Product[] {
    return this.ctx.db.query<Product>("products").sort((a, b) => a.catalogId.localeCompare(b.catalogId));
  }

  getProduct(catalogId: string): Product | undefined {
    return this.ctx.db.get<Product>("products", catalogId);
  }

  hasCatalogId(catalogId: string): boolean {
    return this.getProduct(catalogId) !== undefined;
  }

  /** Product.matchesName(): brand or generic name contains the text (case-insensitive). One Product per presentation. */
  matchByName(text: string): Product[] {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return this.ctx.db
      .query<Product>("products", (p) => p.brandName.toLowerCase().includes(q) || p.genericName.toLowerCase().includes(q))
      .sort((a, b) => a.catalogId.localeCompare(b.catalogId));
  }

  /** DrugReferenceEntry.fetchFromAdapter() for every entry; a failing reference system never breaks the app. */
  async refreshAllFromReference(): Promise<number> {
    let refreshed = 0;
    for (const entry of this.ctx.db.query<DrugReferenceEntry>("drugReferenceEntries")) {
      try {
        const fresh = await this.ctx.adapters.drugReference.fetchEntry(entry.referenceId);
        this.ctx.db.save("drugReferenceEntries", entry.referenceId, { ...fresh, lastUpdated: this.ctx.clock.iso() });
        refreshed++;
      } catch {
        /* keep the previous entry; the next scheduled run retries */
      }
    }
    return refreshed;
  }
}
