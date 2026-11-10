import { z } from "zod";
import type { App } from "./app";
import { MockPosFeedConnector } from "./adapters";
import { AppError, type ErrorCode } from "./errors";
import { licenseUploadSchema } from "./services/registration";
import type { JobType, SessionAccount } from "./types";
import { parseInput } from "./validation";
import { DEMO_PASSWORD, SEED } from "./seed";

export const SESSION_COOKIE = "pf_session";
const MAX_BODY_BYTES = 3_000_000;

interface RouteCtx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  account: SessionAccount | null;
  token: string | null;
}

interface RouteResult {
  status?: number;
  data?: unknown;
  headers?: Record<string, string>;
}

interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pattern: string;
  auth: "public" | "user";
  handler: (c: RouteCtx) => Promise<RouteResult> | RouteResult;
}

const emailBody = z.object({ email: z.string() });
const loginBody = z.object({ email: z.string(), password: z.string() });
const resetConfirmBody = z.object({ email: z.string(), code: z.string(), newPassword: z.string() });
const listingBody = z.object({ catalogId: z.unknown(), stock: z.unknown(), price: z.unknown() });
const csvBody = z.object({ fileName: z.string().max(200), content: z.string() });
const feedBody = z.object({ posEndpoint: z.string(), intervalMinutes: z.number() });
const rejectBody = z.object({ reason: z.string() });
const manualBody = z.object({ confirmed: z.boolean(), note: z.string().max(500).default("") });
const hoursBody = z.object({ hours: z.number().min(0).max(24 * 30) });
const failingBody = z.object({ failing: z.boolean() });

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/, "must be a number");
const searchQuery = z.object({
  q: z.string().min(1, "q is required"),
  lat: decimal.optional(),
  lng: decimal.optional(),
  address: z.string().min(1).max(200).optional(),
  maxDistanceKm: decimal.optional(),
  accessible: z.enum(["true", "false"]).optional(),
  inStockOnly: z.enum(["true", "false"]).optional(),
});

/**
 * Layer 2 - REST API (entry point): receiveRequest -> validateInput -> authorize every call ->
 * routeRequest -> sendJsonResponse. Responses are always JSON: { data } or { error: { code, message, details? } }.
 */
export class RestApi {
  private routes: Route[];
  private lastAutoTick = 0;

  constructor(private app: App) {
    this.routes = this.buildRoutes();
  }

  /* ---------------- entry point ---------------- */

  async handle(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const method = req.method.toUpperCase();
      const segments = this.segments(url.pathname);

      let matched: { route: Route; params: Record<string, string> } | null = null;
      for (const route of this.routes) {
        if (route.method !== method) continue;
        const params = this.match(route.pattern, segments);
        if (params) {
          matched = { route, params };
          break;
        }
      }
      if (!matched) throw new AppError("NOT_FOUND", `No route for ${method} ${url.pathname}`);

      const token = this.extractToken(req);
      const account = matched.route.auth === "user" ? await this.app.auth.authenticate(token) : null; // authorizes each call
      const body = await this.readBody(req, method);

      await this.maybeAutoTick();
      const result = await matched.route.handler({ req, url, params: matched.params, body, account, token });
      return this.sendJsonResponse(result.status ?? 200, { data: result.data ?? null }, result.headers);
    } catch (e) {
      return this.sendError(e);
    }
  }

  /* ---------------- helpers ---------------- */

  private segments(pathname: string): string[] {
    return pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  }

  private match(pattern: string, segs: string[]): Record<string, string> | null {
    const parts = pattern.split("/").filter(Boolean);
    if (parts.length !== segs.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(":")) params[parts[i].slice(1)] = segs[i];
      else if (parts[i] !== segs[i]) return null;
    }
    return params;
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.get("authorization");
    if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || null;
    const cookie = req.headers.get("cookie");
    if (cookie) {
      for (const part of cookie.split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k === SESSION_COOKIE) return v.join("=") || null;
      }
    }
    return null;
  }

  /** validateInput(): rejects malformed JSON and oversized bodies before any logic runs. */
  private async readBody(req: Request, method: string): Promise<unknown> {
    if (method === "GET" || method === "DELETE") return undefined;
    const text = await req.text();
    if (!text) return undefined;
    if (text.length > MAX_BODY_BYTES) throw new AppError("VALIDATION_ERROR", "Request body is too large");
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON");
    }
  }

  private sendJsonResponse(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
  }

  private sendError(e: unknown): Response {
    if (e instanceof AppError) return this.sendJsonResponse(e.status, { error: { code: e.code, message: e.message, details: e.details } });
    console.error("Unhandled API error", e);
    const code: ErrorCode = "INTERNAL";
    return this.sendJsonResponse(500, { error: { code, message: "Something went wrong" } });
  }

  private cookie(req: Request, token: string, maxAgeSeconds: number): string {
    const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
  }

  /** Serverless stand-in for the always-on worker: due jobs run opportunistically (at most every 30s). Opt-in. */
  private async maybeAutoTick(): Promise<void> {
    if (!this.app.autoTick) return;
    const nowMs = Date.now();
    if (nowMs - this.lastAutoTick < 30_000) return;
    this.lastAutoTick = nowMs;
    try {
      await this.app.scheduler.tick();
    } catch (e) {
      console.error("Scheduler tick failed", e);
    }
  }

  private user(c: RouteCtx): SessionAccount {
    return c.account as SessionAccount;
  }

  /* ---------------- route table ---------------- */

  private buildRoutes(): Route[] {
    const a = this.app;
    const demoOn = () => {
      if (process.env.PHARMAFIND_DEMO_ROUTES === "off") throw new AppError("NOT_FOUND", "Demo routes are disabled");
    };

    return [
      /* ---- consumer (public) ---- */
      {
        method: "GET", pattern: "/api/search", auth: "public",
        handler: async (c) => {
          const q = parseInput(searchQuery, Object.fromEntries(c.url.searchParams), "Invalid search");
          if ((q.lat === undefined) !== (q.lng === undefined)) throw new AppError("VALIDATION_ERROR", "Provide both lat and lng");
          let origin;
          if (q.lat !== undefined && q.lng !== undefined) origin = { latitude: Number(q.lat), longitude: Number(q.lng) };
          else if (q.address) origin = { address: q.address };
          else throw new AppError("VALIDATION_ERROR", "Provide your location (lat & lng) or an address");
          const data = await a.search.search({
            queryText: q.q, origin,
            maxDistanceKm: q.maxDistanceKm === undefined ? undefined : Number(q.maxDistanceKm),
            needsAccessibleAccess: q.accessible === "true",
            inStockOnly: q.inStockOnly === "false" ? false : true,
          });
          return { data };
        },
      },
      {
        method: "GET", pattern: "/api/geocode", auth: "public",
        handler: async (c) => {
          const address = parseInput(z.string().min(1).max(200), c.url.searchParams.get("address"), "Invalid address");
          const hit = await a.adapters.geocoding.geocode(address);
          if (!hit) throw new AppError("ADDRESS_NOT_FOUND", `We couldn't find "${address}"`);
          return { data: hit };
        },
      },
      { method: "GET", pattern: "/api/geocode/suggestions", auth: "public", handler: () => ({ data: a.adapters.geocoding.suggestions() }) },
      { method: "GET", pattern: "/api/catalog", auth: "public", handler: () => ({ data: a.catalog.listProducts() }) },

      /* ---- auth ---- */
      {
        method: "POST", pattern: "/api/auth/login", auth: "public",
        handler: async (c) => {
          const b = parseInput(loginBody, c.body, "Invalid login");
          const { token, account } = await a.auth.login(b.email, b.password);
          return { data: { token, account }, headers: { "set-cookie": this.cookie(c.req, token, 12 * 3600) } };
        },
      },
      { method: "POST", pattern: "/api/auth/logout", auth: "public", handler: (c) => ({ data: { ok: true }, headers: { "set-cookie": this.cookie(c.req, "", 0) } }) },
      { method: "GET", pattern: "/api/auth/me", auth: "user", handler: (c) => ({ data: this.user(c) }) },
      {
        method: "POST", pattern: "/api/auth/password-reset/request", auth: "public",
        handler: async (c) => {
          await a.auth.startPasswordReset(parseInput(emailBody, c.body, "Invalid request").email);
          return { data: { ok: true, message: "If that e-mail has an account, a security code was sent." } };
        },
      },
      {
        method: "POST", pattern: "/api/auth/password-reset/confirm", auth: "public",
        handler: async (c) => {
          const b = parseInput(resetConfirmBody, c.body, "Invalid request");
          await a.auth.resetPassword(b.email, b.code, b.newPassword);
          return { data: { ok: true } };
        },
      },

      /* ---- pharmacy registration + portal ---- */
      { method: "POST", pattern: "/api/pharmacies/register", auth: "public", handler: async (c) => ({ status: 201, data: await a.registration.register(c.body) }) },
      { method: "GET", pattern: "/api/pharmacies/:id/dashboard", auth: "user", handler: async (c) => ({ data: await a.portal.viewDashboard(this.user(c), c.params.id) }) },
      {
        method: "PUT", pattern: "/api/pharmacies/:id/listings", auth: "user",
        handler: async (c) => ({ data: await a.portal.updateListing(this.user(c), c.params.id, parseInput(listingBody, c.body, "Invalid listing")) }),
      },
      {
        method: "POST", pattern: "/api/pharmacies/:id/csv", auth: "user",
        handler: async (c) => {
          const b = parseInput(csvBody, c.body, "Invalid upload");
          return { data: await a.portal.uploadCsv(this.user(c), c.params.id, b.fileName, b.content) };
        },
      },
      {
        method: "PUT", pattern: "/api/pharmacies/:id/feed", auth: "user",
        handler: async (c) => ({ data: await a.portal.configureAutomaticFeed(this.user(c), c.params.id, parseInput(feedBody, c.body, "Invalid feed settings")) }),
      },
      { method: "DELETE", pattern: "/api/pharmacies/:id/feed", auth: "user", handler: async (c) => ({ data: await a.portal.disableAutomaticFeed(this.user(c), c.params.id) }) },
      { method: "GET", pattern: "/api/pharmacies/:id/verification", auth: "user", handler: async (c) => ({ data: await a.portal.viewVerificationStatus(this.user(c), c.params.id) }) },
      {
        method: "POST", pattern: "/api/pharmacies/:id/verification/resubmit", auth: "user",
        handler: async (c) => ({ status: 201, data: await a.portal.resubmitVerification(this.user(c), c.params.id, parseInput(licenseUploadSchema, c.body, "Invalid license document")) }),
      },

      /* ---- admin console ---- */
      { method: "GET", pattern: "/api/admin/requests", auth: "user", handler: async (c) => ({ data: await a.admin.listPendingRequests(this.user(c)) }) },
      { method: "GET", pattern: "/api/admin/requests/:id", auth: "user", handler: async (c) => ({ data: await a.admin.viewRequest(this.user(c), c.params.id) }) },
      { method: "POST", pattern: "/api/admin/requests/:id/review", auth: "user", handler: async (c) => ({ data: await a.admin.reviewRegistration(this.user(c), c.params.id) }) },
      {
        method: "POST", pattern: "/api/admin/requests/:id/manual-check", auth: "user",
        handler: async (c) => ({ data: await a.admin.checkLicenseManually(this.user(c), c.params.id, parseInput(manualBody, c.body, "Invalid manual check")) }),
      },
      { method: "POST", pattern: "/api/admin/requests/:id/approve", auth: "user", handler: async (c) => ({ data: await a.admin.approve(this.user(c), c.params.id) }) },
      {
        method: "POST", pattern: "/api/admin/requests/:id/reject", auth: "user",
        handler: async (c) => ({ data: await a.admin.reject(this.user(c), c.params.id, parseInput(rejectBody, c.body, "Invalid rejection").reason) }),
      },
      { method: "GET", pattern: "/api/admin/requests/:id/document", auth: "user", handler: async (c) => ({ data: await a.admin.getLicenseDocument(this.user(c), c.params.id) }) },

      /* ---- background worker trigger (Vercel Cron) ---- */
      {
        method: "GET", pattern: "/api/cron", auth: "public",
        handler: async (c) => {
          const secret = process.env.CRON_SECRET;
          if (secret && c.req.headers.get("authorization") !== `Bearer ${secret}`) throw new AppError("UNAUTHENTICATED", "Invalid cron secret");
          return { data: await a.scheduler.tick() };
        },
      },

      /* ---- demo control panel (mock-world switches) ---- */
      {
        method: "GET", pattern: "/api/demo/state", auth: "public",
        handler: () => {
          demoOn();
          return {
            data: {
              now: a.clock.iso(),
              clockOffsetHours: Math.round((a.clock.offset / 3_600_000) * 10) / 10,
              emailFailing: a.adapters.email.isFailing,
              outbox: [...a.adapters.email.outbox].reverse().slice(0, 40),
              jobs: a.scheduler.listJobs(),
              posEndpoints: MockPosFeedConnector.ENDPOINTS,
              accounts: {
                password: DEMO_PASSWORD,
                admin: SEED.admin.email,
                pharmacies: Object.values(SEED.pharmacies).map((p) => ({ pharmacyId: p.id, email: p.email, license: p.license })),
              },
            },
          };
        },
      },
      {
        method: "POST", pattern: "/api/demo/advance-time", auth: "public",
        handler: (c) => {
          demoOn();
          a.clock.advance(parseInput(hoursBody, c.body, "Invalid hours").hours * 3_600_000);
          return { data: { now: a.clock.iso() } };
        },
      },
      {
        method: "POST", pattern: "/api/demo/run-jobs", auth: "public",
        handler: async (c) => {
          demoOn();
          const forced = c.url.searchParams.get("force");
          if (forced) return { data: { ran: [forced], results: [await a.scheduler.runJob(parseInput(z.enum(["pull_pos_feeds", "check_stale_sync", "refresh_drug_reference", "retry_failed_emails"]), forced, "Invalid job") as JobType)] } };
          return { data: await a.scheduler.tick() };
        },
      },
      {
        method: "POST", pattern: "/api/demo/email-failure", auth: "public",
        handler: (c) => {
          demoOn();
          a.adapters.email.setFailing(parseInput(failingBody, c.body, "Invalid body").failing);
          return { data: { emailFailing: a.adapters.email.isFailing } };
        },
      },
      {
        method: "POST", pattern: "/api/demo/reset", auth: "public",
        handler: () => {
          demoOn();
          a.reset();
          return { data: { ok: true } };
        },
      },
    ];
  }
}
