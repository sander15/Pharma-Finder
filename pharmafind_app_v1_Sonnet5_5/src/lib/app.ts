import { createMockAdapters, type Adapters } from "./adapters";
import { RestApi } from "./api";
import { Clock } from "./clock";
import type { Ctx } from "./context";
import { RelationalDbGeo } from "./db";
import { FileStorage } from "./fileStorage";
import { seedDatabase } from "./seed";
import { AdminService } from "./services/admin";
import { AuthService } from "./services/auth";
import { CatalogService } from "./services/catalog";
import { FeedImportService } from "./services/feedImport";
import { ListingService } from "./services/listings";
import { NotificationService } from "./services/notifications";
import { PharmacyService } from "./services/pharmacies";
import { PortalService } from "./services/portal";
import { RegistrationService } from "./services/registration";
import { SchedulerService } from "./services/scheduler";
import { SearchService } from "./services/search";
import { SyncLogService } from "./services/syncLogs";

export interface CreateAppOptions {
  /** Fixed starting instant for the clock (tests). Omit to use real time. */
  now?: Date;
  sessionSecret?: string;
  /** Run due scheduled jobs opportunistically on incoming API traffic (serverless stand-in for a worker). */
  autoTick?: boolean;
}

/** Composition root: wires Layers 1-4 (+ mocked external systems) into one object. */
export interface App {
  clock: Clock;
  db: RelationalDbGeo;
  files: FileStorage;
  adapters: Adapters;
  catalog: CatalogService;
  listings: ListingService;
  syncLogs: SyncLogService;
  pharmacies: PharmacyService;
  notifications: NotificationService;
  auth: AuthService;
  feedImport: FeedImportService;
  search: SearchService;
  registration: RegistrationService;
  portal: PortalService;
  admin: AdminService;
  scheduler: SchedulerService;
  api: RestApi;
  autoTick: boolean;
  /** Demo: wipe all mock data and re-seed. */
  reset(): void;
}

export function createApp(options: CreateAppOptions = {}): App {
  const clock = new Clock(options.now);
  const db = new RelationalDbGeo();
  const files = new FileStorage();
  const adapters = createMockAdapters(clock);
  const ctx: Ctx = { db, files, clock, adapters, sessionSecret: options.sessionSecret ?? process.env.SESSION_SECRET ?? "pharmafind-demo-secret-change-me" };

  seedDatabase(db, files, clock);

  const catalog = new CatalogService(ctx);
  const listings = new ListingService(ctx);
  const syncLogs = new SyncLogService(ctx);
  const pharmacies = new PharmacyService(ctx, syncLogs);
  const notifications = new NotificationService(ctx);
  const auth = new AuthService(ctx, notifications);
  const feedImport = new FeedImportService(ctx, listings, syncLogs, pharmacies);
  const search = new SearchService(ctx, catalog, listings, pharmacies);
  const registration = new RegistrationService(ctx, auth, pharmacies);
  const portal = new PortalService(ctx, auth, pharmacies, listings, catalog, feedImport, syncLogs, registration);
  const admin = new AdminService(ctx, auth, registration, pharmacies);
  const scheduler = new SchedulerService(ctx, feedImport, pharmacies, notifications, catalog);

  const app: App = {
    clock, db, files, adapters, catalog, listings, syncLogs, pharmacies, notifications, auth, feedImport, search, registration, portal, admin, scheduler,
    api: undefined as unknown as RestApi,
    autoTick: options.autoTick ?? false,
    reset() {
      db.clear();
      files.clear();
      adapters.email.outbox.length = 0;
      adapters.email.setFailing(false);
      clock.reset();
      seedDatabase(db, files, clock);
    },
  };
  app.api = new RestApi(app);
  return app;
}

/** Process-wide singleton for the Next.js server (survives hot reloads and is reused between requests). */
const g = globalThis as unknown as { __pharmafind?: App };
export function getApp(): App {
  if (!g.__pharmafind) g.__pharmafind = createApp({ autoTick: true });
  return g.__pharmafind;
}
