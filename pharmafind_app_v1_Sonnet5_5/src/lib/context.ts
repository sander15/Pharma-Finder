import type { Adapters } from "./adapters";
import type { Clock } from "./clock";
import type { RelationalDbGeo } from "./db";
import type { FileStorage } from "./fileStorage";

/** Shared infrastructure handed to every service (Layer 4 services + adapters + clock). */
export interface Ctx {
  db: RelationalDbGeo;
  files: FileStorage;
  clock: Clock;
  adapters: Adapters;
  sessionSecret: string;
}

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;
/** Data older than this is "stale": shown with a warning to searchers and alerted to the pharmacy. */
export const STALE_AFTER_MS = 24 * HOUR_MS;
