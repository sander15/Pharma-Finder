import type { Clock } from "../clock";
import type { DrugReferenceEntry } from "../types";
import { REFERENCE_ENTRIES } from "./catalogData";

/** «interface - Layer 4» Drug Reference Adapter (external: Drug reference database). */
export interface DrugReferenceAdapter {
  fetchEntry(referenceId: string): Promise<DrugReferenceEntry | null>;
  searchByName(name: string): Promise<DrugReferenceEntry[]>;
}

/**
 * MOCK drug reference database. It already speaks Pharmafind's standard format (same reference
 * IDs and field names), so entries are returned as-is - there is no mapping step. Each fetch
 * reports `lastUpdated` = "now" to simulate the upstream database being freshly revised.
 */
export class MockDrugReferenceAdapter implements DrugReferenceAdapter {
  constructor(private clock: Clock) {}

  async fetchEntry(referenceId: string): Promise<DrugReferenceEntry | null> {
    const e = REFERENCE_ENTRIES.find((r) => r.referenceId === referenceId);
    return e ? { ...e, lastUpdated: this.clock.iso() } : null;
  }

  async searchByName(name: string): Promise<DrugReferenceEntry[]> {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    return REFERENCE_ENTRIES.filter((r) => [r.brandName, r.genericName, r.activeIngredient].some((n) => n.toLowerCase().includes(q))).map((e) => ({
      ...e,
      lastUpdated: this.clock.iso(),
    }));
  }
}
