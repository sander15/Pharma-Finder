import type { Adapters } from "./adapters";
import type { Clock } from "./clock";
import type { RelationalDbGeo } from "./db";
import type { FileStorage } from "./fileStorage";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
/** Data recency rule: stock/price data older than this is labelled "stale" / "likely out of date". */
export const STALE_AFTER_MS = 24 * HOUR_MS;

/** Everything a Layer 3 service needs from Layer 4. */
export interface Ctx {
  db: RelationalDbGeo;
  files: FileStorage;
  clock: Clock;
  adapters: Adapters;
  secret: string;
}

/** Whole minutes between an ISO timestamp and the server clock. */
export function ageMinutes(ctx: Ctx, iso: string): number {
  return Math.max(0, Math.floor((ctx.clock.now().getTime() - new Date(iso).getTime()) / MINUTE_MS));
}
