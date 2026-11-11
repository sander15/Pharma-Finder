import { z, type ZodType, type ZodTypeDef } from "zod";
import { POS_MODES } from "./adapters";
import type { Services } from "./app";
import { HOUR_MS, type Ctx } from "./context";
import { AppError } from "./errors";
import { SESSION_TTL_SEC, isStrongPassword, PASSWORD_RULE } from "./services/auth";
import { MAX_FEED_INTERVAL, MIN_FEED_INTERVAL } from "./services/automaticFeed";
import { JOB_TYPES } from "./services/scheduler";
import type { Account, Pharmacy, SessionAccount } from "./types";

export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  /** Already-parsed JSON body (tests, internal callers). */
  body?: unknown;
  /** Raw body text as received over HTTP; parsed and size-checked here. */
  rawBody?: string;
  /** Session token taken from the HttpOnly cookie. */
  token?: string;
  /** Authorization header (only used by the cron endpoint). */
  authorization?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  /** Tells the HTTP adapter to set or clear the HttpOnly session cookie. */
  setSession?: { token?: string; maxAgeSec?: number; clear?: boolean };
}

export interface RestApiDeps { ctx: Ctx; services: Services; autoTick: boolean; demoEnabled: boolean }

const MAX_BODY_CHARS = 3_000_000;
const MAX_CSV_CHARS = 1_000_000;
const AUTO_TICK_EVERY_MS = 30_000;

/* -------------------------------------------------------------------------------------------- schemas */

const email = z.string().trim().email("Enter a valid e-mail address").max(254);
const numberText = (min: number, max: number, what: string) =>
  z.string().regex(/^-?\d+(\.\d+)?$/, `${what} must be a number`).transform(Number).refine((n) => n >= min && n <= max, `${what} is out of range`);
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const searchQuery = z
  .object({
    q: z.string().trim().min(2, "Type at least 2 characters").max(100, "Search text is too long"),
    lat: numberText(-90, 90, "lat").optional(),
    lng: numberText(-180, 180, "lng").optional(),
    address: z.string().trim().min(2, "Address is too short").max(200).optional(),
    maxDistanceKm: numberText(0, 500, "maxDistanceKm").refine((n) => n > 0, "maxDistanceKm must be greater than 0").optional(),
    needsAccessibleAccess: bool.optional(),
    includeOutOfStock: bool.optional(),
  })
  .superRefine((v, ctx) => {
    const hasCoords = v.lat !== undefined && v.lng !== undefined;
    if ((v.lat === undefined) !== (v.lng === undefined)) ctx.addIssue({ code: "custom", message: "Send both lat and lng", path: ["lat"] });
    else if (!hasCoords && !v.address) ctx.addIssue({ code: "custom", message: "Tell us where you are: share your location or type an address", path: ["address"] });
  });

const loginBody = z.object({ email, password: z.string().min(1).max(128) });
const resetRequestBody = z.object({ email });
const resetConfirmBody = z.object({ email, code: z.string().regex(/^\d{6}$/, "The code has 6 digits"), newPassword: z.string().max(128) });

const licenseSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  mimeType: z.string().max(60),
  contentBase64: z.string().min(1).max(MAX_BODY_CHARS),
});
const registerBody = z.object({
  pharmacyName: z.string().trim().min(2, "Pharmacy name is too short").max(100),
  licenseNumber: z.string().regex(/^[A-Z]{2}-\d{6,8}$/, "License number looks like TX-1234567"),
  phone: z.string().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number"),
  address: z.string().trim().min(3, "Enter the street address").max(200),
  city: z.string().trim().min(2).max(80),
  isAccessible: z.boolean().nullable().optional(),
  fullName: z.string().trim().min(2, "Enter your full name").max(100),
  email,
  password: z.string().max(128).refine(isStrongPassword, PASSWORD_RULE),
  license: licenseSchema,
});
const resubmitBody = z.object({ license: licenseSchema });

const csvBody = z.object({ fileName: z.string().trim().min(1).max(120), content: z.string() });
const listingEditBody = z.object({ stock: z.unknown(), price: z.unknown() }); // validated by Listing.validate()
const listingCreateBody = z.object({ catalogId: z.string().max(20), stock: z.unknown(), price: z.unknown() });
const feedBody = z.object({
  posEndpoint: z.string().max(300).refine((s) => {
    try {
      return new URL(s).protocol === "https:";
    } catch {
      return false;
    }
  }, "The POS endpoint must be a valid https:// address"),
  intervalMinutes: z.number().int(`Interval must be a whole number of minutes`).min(MIN_FEED_INTERVAL, `Interval must be at least ${MIN_FEED_INTERVAL} minutes`).max(MAX_FEED_INTERVAL, `Interval must be at most ${MAX_FEED_INTERVAL} minutes (24 h)`),
});

const adminListQuery = z.object({ status: z.enum(["pending", "verified", "rejected", "all"]).optional() });
const manualCheckBody = z.object({ confirmed: z.boolean(), note: z.string().max(500).optional() });
const rejectBody = z.object({ reason: z.string().trim().min(5, "Give the pharmacy a reason (at least 5 characters)").max(500) });

const advanceBody = z.object({ hours: z.number().positive("Hours must be greater than 0").max(720, "At most 720 hours (30 days) at a time") });
const runSchedulerBody = z.object({ job: z.enum(JOB_TYPES as [string, ...string[]]).optional() });
const adaptersBody = z.object({
  emailFailing: z.boolean().optional(),
  licenseRegistryAvailable: z.boolean().optional(),
  drugReferenceAvailable: z.boolean().optional(),
  posMode: z.object({ endpoint: z.string().max(300), mode: z.enum(POS_MODES as [string, ...string[]]) }).optional(),
});

function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const details = r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
  const first = details[0];
  throw new AppError("VALIDATION_ERROR", first ? (first.field ? `${first.field}: ${first.message}` : first.message) : "Invalid input", details);
}

/* ------------------------------------------------------------------------------------------ routing */

type Access = "public" | "session" | "staff" | "admin" | "cron";

interface RouteCtx { params: Record<string, string>; query: Record<string, string>; body: Record<string, unknown>; session: SessionAccount | null; req: ApiRequest }
interface RouteResult { status?: number; data: unknown; setSession?: ApiResponse["setSession"] }
interface Route { method: string; pattern: string; access: Access; demo?: boolean; handler: (c: RouteCtx) => Promise<RouteResult> | RouteResult }
interface CompiledRoute extends Route { regex: RegExp; names: string[] }

function compile(r: Route): CompiledRoute {
  const names: string[] = [];
  const src = r.pattern.replace(/:([A-Za-z]+)/g, (_m, n: string) => (names.push(n), "([^/]+)"));
  return { ...r, regex: new RegExp(`^${src}/?$`), names };
}

/** REST API (Layer 2): receiveRequest -> validateInput -> authorize -> routeRequest -> sendJsonResponse. */
export class RestApi {
  private routes: CompiledRoute[];
  private lastAutoTick = 0;
  private ticking = false;

  constructor(private deps: RestApiDeps) {
    this.routes = this.buildRoutes().map(compile);
  }

  /* -------------------------------------------------------------------------------------------- pipeline */

  async handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      if (this.deps.autoTick && !req.path.startsWith("/api/demo/")) await this.maybeTick();
      const body = this.readBody(req);
      const path = req.path.length > 1 ? req.path.replace(/\/+$/, "") : req.path;
      const { route, params, pathMatched } = this.match(req.method.toUpperCase(), path);
      if (!route || (route.demo && !this.deps.demoEnabled)) {
        if (pathMatched && !route) throw new AppError("METHOD_NOT_ALLOWED", "Method not allowed");
        throw new AppError("NOT_FOUND", "Not found");
      }
      const session = this.deps.services.auth.authenticate(req.token);
      this.authorize(route, session, params, req);
      const result = await route.handler({ params, query: req.query ?? {}, body, session, req });
      return { status: result.status ?? 200, body: this.ok(result.data), setSession: result.setSession };
    } catch (err) {
      if (err instanceof AppError) return { status: err.status, body: { ok: false, error: { code: err.code, message: err.message, details: err.details }, serverNow: this.deps.ctx.clock.iso() } };
      console.error("[pharmafind] unexpected error", err);
      return { status: 500, body: { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." }, serverNow: this.deps.ctx.clock.iso() } };
    }
  }

  private ok(data: unknown) {
    return { ok: true, data, serverNow: this.deps.ctx.clock.iso() };
  }

  /** validateInput() part 1: the envelope. Field-level checks happen per route with zod. */
  private readBody(req: ApiRequest): Record<string, unknown> {
    let body: unknown = req.body;
    if (req.rawBody !== undefined) {
      if (req.rawBody.length > MAX_BODY_CHARS) throw new AppError("PAYLOAD_TOO_LARGE", "The request is too large");
      if (req.rawBody.trim() === "") body = undefined;
      else {
        try {
          body = JSON.parse(req.rawBody);
        } catch {
          throw new AppError("VALIDATION_ERROR", "The request body is not valid JSON");
        }
      }
    }
    if (body === undefined || body === null) return {};
    if (typeof body !== "object" || Array.isArray(body)) throw new AppError("VALIDATION_ERROR", "The request body must be a JSON object");
    return body as Record<string, unknown>;
  }

  private match(method: string, path: string) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1]!)));
      return { route: r, params, pathMatched };
    }
    return { route: undefined, params: {}, pathMatched };
  }

  /** authorize(): who may call this route (AccessAndAuthentication.authorize / checkPharmacyScope). */
  private authorize(route: Route, session: SessionAccount | null, params: Record<string, string>, req: ApiRequest) {
    const auth = this.deps.services.auth;
    switch (route.access) {
      case "public":
        return;
      case "session":
        if (!session) throw new AppError("UNAUTHENTICATED", "Please log in");
        return;
      case "admin":
        auth.requireRole(session, "admin");
        return;
      case "staff":
        auth.requirePharmacyScope(session, params.pharmacyId!);
        return;
      case "cron": {
        const secret = process.env.CRON_SECRET;
        if (secret && req.authorization !== `Bearer ${secret}`) throw new AppError("UNAUTHENTICATED", "Invalid cron credentials");
      }
    }
  }

  private async maybeTick() {
    const real = Date.now();
    if (this.ticking || real - this.lastAutoTick < AUTO_TICK_EVERY_MS) return;
    this.lastAutoTick = real;
    this.ticking = true;
    try {
      await this.deps.services.scheduler.tick();
    } catch (e) {
      console.error("[pharmafind] background tick failed", e);
    } finally {
      this.ticking = false;
    }
  }

  /* ------------------------------------------------------------------------------------------------ routes */

  private buildRoutes(): Route[] {
    const { ctx, services: s } = this.deps;
    const sess = (c: RouteCtx) => c.session!;
    const pid = (c: RouteCtx) => c.params.pharmacyId!;

    return [
      /* ---------------- consumer (no login needed) ---------------- */
      {
        method: "GET", pattern: "/api/search", access: "public",
        handler: async (c) => {
          const q = parse(searchQuery, c.query);
          const data = await s.search.search({
            q: q.q,
            origin: q.lat !== undefined && q.lng !== undefined ? { latitude: q.lat, longitude: q.lng } : undefined,
            address: q.address,
            maxDistanceKm: q.maxDistanceKm ?? 25,
            needsAccessibleAccess: q.needsAccessibleAccess ?? false,
            includeOutOfStock: q.includeOutOfStock ?? false,
          });
          return { data };
        },
      },
      { method: "GET", pattern: "/api/catalog", access: "public", handler: () => ({ data: { products: s.catalog.listProducts() } }) },

      /* ---------------- authentication ---------------- */
      {
        method: "POST", pattern: "/api/auth/login", access: "public",
        handler: async (c) => {
          const b = parse(loginBody, c.body);
          const { token, account } = await s.auth.login(b.email, b.password);
          return { data: { account }, setSession: { token, maxAgeSec: SESSION_TTL_SEC } };
        },
      },
      { method: "POST", pattern: "/api/auth/logout", access: "public", handler: () => ({ data: { loggedOut: true }, setSession: { clear: true } }) },
      { method: "GET", pattern: "/api/auth/me", access: "session", handler: (c) => ({ data: { account: sess(c) } }) },
      {
        method: "POST", pattern: "/api/auth/password-reset/request", access: "public",
        handler: async (c) => {
          const b = parse(resetRequestBody, c.body);
          await s.auth.startPasswordReset(b.email);
          return { data: { message: "If an account exists for that e-mail, a security code is on its way." } };
        },
      },
      {
        method: "POST", pattern: "/api/auth/password-reset/confirm", access: "public",
        handler: (c) => {
          const b = parse(resetConfirmBody, c.body);
          s.auth.resetPassword(b.email, b.code, b.newPassword);
          return { data: { message: "Your password was changed. You can log in now." } };
        },
      },

      /* ---------------- pharmacy registration ---------------- */
      {
        method: "POST", pattern: "/api/pharmacies/register", access: "public",
        handler: async (c) => {
          const b = parse(registerBody, c.body);
          const r = await s.verification.register({ ...b, isAccessible: b.isAccessible ?? null });
          const account = ctx.db.get<Account>("accounts", r.accountId)!;
          return {
            status: 201,
            data: { pharmacyId: r.pharmacyId, requestId: r.requestId, verificationStatus: "pending", message: "Registration received. Your listing goes live after an administrator verifies your license." },
            setSession: { token: s.auth.issueSessionToken(account), maxAgeSec: SESSION_TTL_SEC },
          };
        },
      },

      /* ---------------- pharmacy portal (own pharmacy only) ---------------- */
      {
        method: "GET", pattern: "/api/portal/:pharmacyId/dashboard", access: "staff",
        handler: (c) => {
          const id = pid(c);
          const ph = s.pharmacies.get(id);
          if (!ph) throw new AppError("NOT_FOUND", "Pharmacy not found");
          const lastOk = s.syncLogs.getLatestSuccessFor(id);
          const latest = s.syncLogs.getLatestFor(id);
          return {
            data: {
              pharmacy: { pharmacyId: id, name: ph.name, verificationStatus: ph.verificationStatus, isVisibleInSearch: s.pharmacies.isVisibleInSearch(ph) },
              lastSyncAt: lastOk?.syncedAt ?? null,
              ageMinutes: s.pharmacies.syncAgeMinutes(id),
              isStale: s.pharmacies.isSyncStale(id),
              latestSync: latest ? { success: latest.success, details: latest.details, syncedAt: latest.syncedAt } : null,
              feed: s.automaticFeeds.getForPharmacy(id) ?? null,
              listingCount: s.listings.forPharmacy(id).length,
            },
          };
        },
      },
      {
        method: "GET", pattern: "/api/portal/:pharmacyId/preview", access: "staff",
        handler: (c) => {
          const ph = s.pharmacies.get(pid(c)) as Pharmacy | undefined;
          if (!ph) throw new AppError("NOT_FOUND", "Pharmacy not found");
          return { data: { isVerified: s.pharmacies.isVerified(ph), isVisibleInSearch: s.pharmacies.isVisibleInSearch(ph), listings: s.listings.itemsForPharmacy(ph.pharmacyId) } };
        },
      },
      { method: "GET", pattern: "/api/portal/:pharmacyId/listings", access: "staff", handler: (c) => ({ data: { listings: s.listings.itemsForPharmacy(pid(c)) } }) },
      {
        method: "PUT", pattern: "/api/portal/:pharmacyId/listings/:listingId", access: "staff",
        handler: (c) => {
          const b = parse(listingEditBody, c.body);
          return { data: { listing: s.listings.update(pid(c), c.params.listingId!, b.stock, b.price) } };
        },
      },
      {
        method: "POST", pattern: "/api/portal/:pharmacyId/listings", access: "staff",
        handler: (c) => {
          const b = parse(listingCreateBody, c.body);
          return { status: 201, data: { listing: s.listings.create(pid(c), b.catalogId, b.stock, b.price) } };
        },
      },
      {
        method: "POST", pattern: "/api/portal/:pharmacyId/csv", access: "staff",
        handler: (c) => {
          const b = parse(csvBody, c.body);
          if (b.content.length > MAX_CSV_CHARS) throw new AppError("PAYLOAD_TOO_LARGE", "The file is larger than 1 MB");
          const r = s.feedImport.importCsv({ pharmacyId: pid(c), fileName: b.fileName, content: b.content });
          return { data: { importId: r.importId, status: r.status, totalRows: r.totalRows, validRows: r.validRows, rejectedRows: r.rejectedRows, rejections: r.rejections.slice(0, 200) } };
        },
      },
      { method: "GET", pattern: "/api/portal/:pharmacyId/feed", access: "staff", handler: (c) => ({ data: { feed: s.automaticFeeds.getForPharmacy(pid(c)) ?? null } }) },
      {
        method: "PUT", pattern: "/api/portal/:pharmacyId/feed", access: "staff",
        handler: async (c) => {
          const b = parse(feedBody, c.body);
          const feed = await s.automaticFeeds.configure(pid(c), b.posEndpoint, b.intervalMinutes);
          return { data: { feed, connection: { ok: true } } };
        },
      },
      { method: "POST", pattern: "/api/portal/:pharmacyId/feed/disable", access: "staff", handler: (c) => ({ data: { feed: s.automaticFeeds.disable(pid(c)) } }) },
      { method: "GET", pattern: "/api/portal/:pharmacyId/verification", access: "staff", handler: (c) => ({ data: s.verification.statusFor(pid(c)) }) },
      {
        method: "POST", pattern: "/api/portal/:pharmacyId/verification/resubmit", access: "staff",
        handler: (c) => {
          const b = parse(resubmitBody, c.body);
          const r = s.verification.resubmit(pid(c), b.license);
          return { status: 201, data: { requestId: r.requestId, verificationStatus: "pending" } };
        },
      },

      /* ---------------- admin console ---------------- */
      {
        method: "GET", pattern: "/api/admin/requests", access: "admin",
        handler: (c) => ({ data: { requests: s.verification.listRequests(parse(adminListQuery, c.query).status ?? "pending") } }),
      },
      { method: "GET", pattern: "/api/admin/requests/:requestId", access: "admin", handler: async (c) => ({ data: await s.verification.review(c.params.requestId!) }) },
      {
        method: "POST", pattern: "/api/admin/requests/:requestId/manual-check", access: "admin",
        handler: (c) => {
          const b = parse(manualCheckBody, c.body);
          return { data: { manualCheck: s.verification.recordManualCheck(c.params.requestId!, b.confirmed, b.note ?? "").manualCheck } };
        },
      },
      { method: "POST", pattern: "/api/admin/requests/:requestId/approve", access: "admin", handler: (c) => ({ data: s.verification.approve(c.params.requestId!, sess(c).accountId) }) },
      {
        method: "POST", pattern: "/api/admin/requests/:requestId/reject", access: "admin",
        handler: (c) => ({ data: s.verification.reject(c.params.requestId!, sess(c).accountId, parse(rejectBody, c.body).reason) }),
      },

      /* ---------------- background worker entry point (Vercel Cron) ---------------- */
      { method: "GET", pattern: "/api/cron", access: "cron", handler: async () => ({ data: await s.scheduler.tick() }) },

      /* ---------------- demo controls ---------------- */
      { method: "GET", pattern: "/api/demo/state", access: "public", demo: true, handler: () => ({ data: this.demoState() }) },
      {
        method: "POST", pattern: "/api/demo/advance", access: "public", demo: true,
        handler: (c) => {
          ctx.clock.advance(parse(advanceBody, c.body).hours * HOUR_MS);
          return { data: this.demoState() };
        },
      },
      { method: "POST", pattern: "/api/demo/reset-clock", access: "public", demo: true, handler: () => (ctx.clock.reset(), { data: this.demoState() }) },
      {
        method: "POST", pattern: "/api/demo/run-scheduler", access: "public", demo: true,
        handler: async (c) => {
          const b = parse(runSchedulerBody, c.body);
          if (b.job) {
            const r = await s.scheduler.runJob(b.job as (typeof JOB_TYPES)[number]);
            return { data: { ran: [r.type], results: [r] } };
          }
          return { data: await s.scheduler.tick() };
        },
      },
      { method: "GET", pattern: "/api/demo/outbox", access: "public", demo: true, handler: () => ({ data: { emails: [...ctx.adapters.email.outbox].reverse() } }) },
      {
        method: "POST", pattern: "/api/demo/adapters", access: "public", demo: true,
        handler: (c) => {
          const b = parse(adaptersBody, c.body);
          if (b.emailFailing !== undefined) ctx.adapters.email.failing = b.emailFailing;
          if (b.licenseRegistryAvailable !== undefined) ctx.adapters.licenseCheck.available = b.licenseRegistryAvailable;
          if (b.drugReferenceAvailable !== undefined) ctx.adapters.drugReference.available = b.drugReferenceAvailable;
          if (b.posMode) ctx.adapters.posFeed.setMode(b.posMode.endpoint, b.posMode.mode as (typeof POS_MODES)[number]);
          return { data: this.demoState() };
        },
      },
    ];
  }

  private demoState() {
    const { ctx, services: s } = this.deps;
    const pharmacies = ctx.db.query<Pharmacy>("pharmacies").map((p) => ({
      pharmacyId: p.pharmacyId,
      name: p.name,
      verificationStatus: p.verificationStatus,
      lastSyncAt: s.syncLogs.getLatestSuccessFor(p.pharmacyId)?.syncedAt ?? null,
      ageMinutes: s.pharmacies.syncAgeMinutes(p.pharmacyId),
      isStale: s.pharmacies.isSyncStale(p.pharmacyId),
    }));
    return {
      now: ctx.clock.iso(),
      realNow: new Date().toISOString(),
      offsetMs: ctx.clock.offsetMs,
      autoTick: this.deps.autoTick,
      jobs: s.scheduler.listJobs(),
      pharmacies,
      outboxCount: ctx.adapters.email.outbox.length,
      adapters: {
        emailFailing: ctx.adapters.email.failing,
        licenseRegistryAvailable: ctx.adapters.licenseCheck.available,
        drugReferenceAvailable: ctx.adapters.drugReference.available,
        posModes: ctx.adapters.posFeed.getModes(),
        posEndpoints: ctx.adapters.posFeed.knownEndpoints(),
      },
    };
  }
}
