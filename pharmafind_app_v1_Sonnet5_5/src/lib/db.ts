import { distanceKm } from "./geo";
import type { Coordinates, Location } from "./types";

const TABLES = [
  "accounts",
  "pharmacyStaff",
  "admins",
  "pharmacies",
  "locations",
  "verificationRequests",
  "licenseDocuments",
  "products",
  "drugReferenceEntries",
  "listings",
  "automaticFeeds",
  "feedImports",
  "syncLogs",
  "notifications",
  "securityCodes",
  "scheduledJobs",
  "searches",
] as const;

export type TableName = (typeof TABLES)[number];

/**
 * MOCK of «service - Layer 4» Relational DB with Geo Extension.
 * In-memory tables keyed by primary key. Records are cloned in/out so callers can never mutate
 * stored rows by accident (mimics a real DB boundary). Demo caveat: on Vercel the data lives in
 * the serverless instance's memory and resets on cold start.
 */
export class RelationalDbGeo {
  private tables = new Map<TableName, Map<string, unknown>>();
  private counters = new Map<string, number>();

  constructor() {
    for (const t of TABLES) this.tables.set(t, new Map());
  }

  save<T>(table: TableName, id: string, record: T): T {
    this.tables.get(table)!.set(id, structuredClone(record));
    return structuredClone(record);
  }

  get<T>(table: TableName, id: string): T | undefined {
    const r = this.tables.get(table)!.get(id);
    return r === undefined ? undefined : (structuredClone(r) as T);
  }

  query<T>(table: TableName, predicate?: (row: T) => boolean): T[] {
    const rows = [...this.tables.get(table)!.values()].map((r) => structuredClone(r) as T);
    return predicate ? rows.filter(predicate) : rows;
  }

  remove(table: TableName, id: string): void {
    this.tables.get(table)!.delete(id);
  }

  /** Geo extension: locations within radiusKm of a point, nearest first. */
  geoQuery(center: Coordinates, radiusKm: number): Array<Location & { distanceKm: number }> {
    return this.query<Location>("locations")
      .map((l) => ({ ...l, distanceKm: distanceKm(center, l) }))
      .filter((l) => l.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /** Demo helper: wipes every table (used by the Demo Panel reset). */
  clear(): void {
    for (const t of this.tables.values()) t.clear();
    this.counters.clear();
  }

  nextId(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }
}
