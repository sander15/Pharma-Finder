import type { Ctx } from "../context";
import { AppError } from "../errors";
import type { DrugReferenceEntry, Product } from "../types";

/** Entities Product + DrugReferenceEntry (matchesName, getGenericAlternatives, refreshFromReference). */
export class CatalogService {
  constructor(private ctx: Ctx) {}

  listProducts(): Product[] {
    return this.ctx.db.query<Product>("products").sort((a, b) => a.catalogId.localeCompare(b.catalogId));
  }

  getProduct(catalogId: string): Product | undefined {
    return this.ctx.db.get<Product>("products", catalogId);
  }

  getReference(referenceId: string): DrugReferenceEntry | undefined {
    return this.ctx.db.get<DrugReferenceEntry>("drugReferenceEntries", referenceId);
  }

  /** Product.matchesName: brand or generic name contains the (user typed) query, case-insensitively. */
  matchesName(product: Product, queryText: string): boolean {
    const q = queryText.trim().toLowerCase();
    if (q.length < 2) return false;
    const names = [product.genericName];
    if (product.brandName !== "Generic") names.push(product.brandName); // "Generic" is a label, not a brand
    return names.some((n) => n.toLowerCase().includes(q));
  }

  matchProducts(queryText: string): Product[] {
    return this.listProducts().filter((p) => this.matchesName(p, queryText));
  }

  /** DrugReferenceEntry.getGenericAlternatives: other entries with the same active ingredient. */
  async getGenericAlternatives(referenceId: string): Promise<DrugReferenceEntry[]> {
    const entry = this.getReference(referenceId);
    if (!entry) throw new AppError("NOT_FOUND", "Drug reference entry not found");
    return this.ctx.db
      .query<DrugReferenceEntry>("drugReferenceEntries", (r) => r.activeIngredient === entry.activeIngredient && r.referenceId !== referenceId)
      .sort((a, b) => a.referenceId.localeCompare(b.referenceId));
  }

  /** Scheduled job: pull the latest entry for every reference ID through the Drug Reference adapter. */
  async refreshAllFromReference(): Promise<number> {
    let refreshed = 0;
    for (const entry of this.ctx.db.query<DrugReferenceEntry>("drugReferenceEntries")) {
      const fresh = await this.ctx.adapters.drugReference.fetchEntry(entry.referenceId);
      if (fresh) {
        this.ctx.db.save("drugReferenceEntries", fresh.referenceId, fresh);
        refreshed++;
      }
    }
    return refreshed;
  }
}
