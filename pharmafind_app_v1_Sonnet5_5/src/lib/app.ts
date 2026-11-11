import { createAdapters, type Adapters } from "./adapters";
import { Clock } from "./clock";
import type { Ctx } from "./context";
import { RelationalDbGeo } from "./db";
import { FileStorage } from "./fileStorage";
import { RestApi } from "./api";
import { seed } from "./seed";
import { AuthService } from "./services/auth";
import { AutomaticFeedService } from "./services/automaticFeed";
import { CatalogService } from "./services/catalog";
import { FeedImportService } from "./services/feedImport";
import { ListingService } from "./services/listings";
import { NotificationService } from "./services/notifications";
import { PharmacyService } from "./services/pharmacies";
import { SchedulerService } from "./services/scheduler";
import { SearchService } from "./services/search";
import { SyncLogService } from "./services/syncLogs";
import { VerificationService } from "./services/verification";

export interface Services {
  auth: AuthService;
  catalog: CatalogService;
  syncLogs: SyncLogService;
  pharmacies: PharmacyService;
  listings: ListingService;
  feedImport: FeedImportService;
  automaticFeeds: AutomaticFeedService;
  notifications: NotificationService;
  verification: VerificationService;
  search: SearchService;
  scheduler: SchedulerService;
}

export interface AppOptions {
  /** Fixed starting time (tests). Omit to follow real time. */
  now?: Date | string | number;
  sessionSecret?: string;
  /** Load the demo data set (default true). */
  seed?: boolean;
  /** Opportunistically run due background jobs when API requests arrive (serverless stand-in for a worker). */
  autoTick?: boolean;
  /** Expose /api/demo/* controls (default true; this is a demo build). */
  demoEnabled?: boolean;
}

export interface App {
  clock: Clock;
  db: RelationalDbGeo;
  files: FileStorage;
  adapters: Adapters;
  services: Services;
  api: RestApi;
}

/** Composition root: wires Layer 4 (mock DB, file storage, adapters) -> Layer 3 services -> Layer 2 REST API. */
export function createApp(opts: AppOptions = {}): App {
  const clock = new Clock(opts.now);
  const adapters = createAdapters(clock);
  const ctx: Ctx = { db: new RelationalDbGeo(), files: new FileStorage(), clock, adapters, secret: opts.sessionSecret ?? "pharmafind-demo-session-secret-change-me" };

  const syncLogs = new SyncLogService(ctx);
  const catalog = new CatalogService(ctx);
  const pharmacies = new PharmacyService(ctx, syncLogs);
  const listings = new ListingService(ctx, catalog, pharmacies);
  const feedImport = new FeedImportService(ctx, catalog, listings, pharmacies);
  const automaticFeeds = new AutomaticFeedService(ctx);
  const notifications = new NotificationService(ctx);
  const scheduler = new SchedulerService(ctx, automaticFeeds, feedImport, pharmacies, notifications, catalog);
  automaticFeeds.scheduleHook = (minutes) => scheduler.schedule("pull_pos_feeds", minutes);
  const services: Services = {
    auth: new AuthService(ctx, notifications),
    catalog, syncLogs, pharmacies, listings, feedImport, automaticFeeds, notifications, scheduler,
    verification: new VerificationService(ctx, pharmacies),
    search: new SearchService(ctx, catalog, listings, pharmacies),
  };

  if (opts.seed !== false) seed(ctx, adapters);

  const api = new RestApi({ ctx, services, autoTick: opts.autoTick ?? false, demoEnabled: opts.demoEnabled ?? true });
  return { clock, db: ctx.db, files: ctx.files, adapters, services, api };
}
