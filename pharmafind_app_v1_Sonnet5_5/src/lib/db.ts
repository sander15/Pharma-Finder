import { haversineKm } from "./geo";
import type { Coordinates } from "./types";

/**
 * Mock of the "Relational DB with Geo Extension" (Layer 4): in-memory tables of records keyed by id.
 * Rows are copied in and out so callers can never mutate stored data by accident.
 */
export class RelationalDbGeo {
  private tables = new Map<string, Map<string, unknown>>();
  private counters = new Map<string, number>();

  private table(name: string): Map<string, unknown> {
    let t = this.tables.get(name);
    if (!t) this.tables.set(name, (t = new Map()));
    return t;
  }

  save<T>(table: string, id: string, entity: T): T {
    this.table(table).set(id, structuredClone(entity));
    return structuredClone(entity);
  }

  get<T>(table: string, id: string): T | undefined {
    const row = this.table(table).get(id);
    return row === undefined ? undefined : (structuredClone(row) as T);
  }

  query<T>(table: string, predicate?: (row: T) => boolean): T[] {
    const rows = [...this.table(table).values()].map((r) => structuredClone(r) as T);
    return predicate ? rows.filter(predicate) : rows;
  }

  delete(table: string, id: string): void {
    this.table(table).delete(id);
  }

  nextId(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }

  /** Geo extension: distance in km between two coordinate pairs. */
  geoQuery(a: Coordinates, b: Coordinates): number {
    return haversineKm(a, b);
  }
}
