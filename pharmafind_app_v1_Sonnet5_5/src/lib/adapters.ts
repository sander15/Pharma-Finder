/**
 * Integration Adapters (Layer 4): the replaceable boundary to the six external systems of the context diagram.
 * Every adapter below is a MOCK. Swapping in a real client means implementing the same interface; nothing else changes.
 * Data crossing these adapters is already in Pharmafind's standard format and catalog IDs - adapters never translate it.
 */
import type { Clock } from "./clock";
import { DRUG_REFERENCE, KNOWN_PLACES, LICENSE_REGISTRY } from "./mockData";
import type { Coordinates, DrugReferenceEntry } from "./types";

export interface EmailMessage { to: string; subject: string; body: string }
export interface EmailAdapter { sendEmail(message: EmailMessage): Promise<void> }

export interface DrugReferenceAdapter {
  fetchEntry(referenceId: string): Promise<Omit<DrugReferenceEntry, "lastUpdated">>;
  searchByName(name: string): Promise<Omit<DrugReferenceEntry, "lastUpdated">[]>;
}

export interface PosFeedConnector {
  testConnection(endpoint: string): Promise<{ ok: boolean; error?: string }>;
  /** Returns whatever the POS system sent. It is `unknown` on purpose: only Feed Import decides whether it is valid. */
  pullFeed(endpoint: string): Promise<unknown>;
}

export interface LicenseCheckAdapter {
  checkLicense(licenseNumber: string): Promise<{ found: boolean; holderName: string | null }>;
}

export interface DirectionsAdapter { getRouteLink(from: Coordinates, to: Coordinates): string }
export interface GeocodingAdapter { geocode(address: string): Promise<Coordinates> }

/* ------------------------------------------------------------------------------------------ mocks */

export class MockEmailAdapter implements EmailAdapter {
  readonly outbox: (EmailMessage & { sentAt: string })[] = [];
  /** Demo switch: simulate the e-mail service being down. */
  failing = false;
  constructor(private clock: Clock) {}

  async sendEmail(message: EmailMessage): Promise<void> {
    if (this.failing) throw new Error("E-mail service unavailable");
    this.outbox.push({ ...message, sentAt: this.clock.iso() });
    if (this.outbox.length > 200) this.outbox.shift();
  }
}

export class MockDrugReferenceAdapter implements DrugReferenceAdapter {
  available = true;
  private check() {
    if (!this.available) throw new Error("Drug reference database unavailable");
  }
  async fetchEntry(referenceId: string) {
    this.check();
    const entry = DRUG_REFERENCE.find((e) => e.referenceId === referenceId);
    if (!entry) throw new Error(`Unknown reference ${referenceId}`);
    return { ...entry };
  }
  async searchByName(name: string) {
    this.check();
    const q = name.trim().toLowerCase();
    return DRUG_REFERENCE.filter((e) => e.genericName.toLowerCase().includes(q) || e.brandName.toLowerCase().includes(q)).map((e) => ({ ...e }));
  }
}

export type PosMode = "valid" | "invalid" | "malformed" | "down";
export const POS_MODES: PosMode[] = ["valid", "invalid", "malformed", "down"];

interface PosRow { catalogId: string; stock: number; price: number }

/** Mock POS connector. Any https host ending in `.demo-pos.example` is reachable and serves standard-format rows. */
export class MockPosFeedConnector implements PosFeedConnector {
  private datasets = new Map<string, PosRow[]>();
  private modes = new Map<string, PosMode>();
  private pulls = new Map<string, number>();

  registerEndpoint(endpoint: string, rows: PosRow[]) {
    this.datasets.set(endpoint, rows.map((r) => ({ ...r })));
  }
  setMode(endpoint: string, mode: PosMode) {
    this.modes.set(endpoint, mode);
  }
  getModes(): Record<string, PosMode> {
    return Object.fromEntries(this.modes);
  }
  knownEndpoints(): string[] {
    return [...this.datasets.keys()];
  }

  private reachable(endpoint: string): boolean {
    if (this.modes.get(endpoint) === "down") return false;
    if (this.datasets.has(endpoint)) return true;
    try {
      const u = new URL(endpoint);
      return u.protocol === "https:" && u.hostname.endsWith(".demo-pos.example");
    } catch {
      return false;
    }
  }

  async testConnection(endpoint: string) {
    return this.reachable(endpoint) ? { ok: true } : { ok: false, error: "Could not connect to the POS endpoint" };
  }

  async pullFeed(endpoint: string): Promise<unknown> {
    if (!this.reachable(endpoint)) throw new Error("POS endpoint unreachable");
    const mode = this.modes.get(endpoint) ?? "valid";
    if (mode === "malformed") return { error: "unexpected payload", rows: "n/a" };
    if (!this.datasets.has(endpoint)) {
      this.datasets.set(endpoint, [{ catalogId: "PF-10004", stock: 20, price: 7.49 }, { catalogId: "PF-10001", stock: 15, price: 9.29 }]);
    }
    const n = (this.pulls.get(endpoint) ?? 0) + 1;
    this.pulls.set(endpoint, n);
    // The POS system sells things between pulls, so stock drifts down a little each time (still standard format).
    const rows: unknown[] = this.datasets.get(endpoint)!.map((r) => ({ catalogId: r.catalogId, stock: Math.max(0, r.stock - n), price: r.price }));
    if (mode === "invalid") {
      rows.push({ catalogId: "PF-99999", stock: 5, price: 3.5 }); // not in the Pharmafind catalog
      rows.push({ catalogId: "PF-10004", stock: -1, price: 5 }); // negative stock
      rows.push({ catalogId: "PF-10001", stock: 2.5, price: 5 }); // fractional stock
    }
    return rows;
  }
}

export class MockLicenseCheckAdapter implements LicenseCheckAdapter {
  available = true;
  async checkLicense(licenseNumber: string) {
    if (!this.available) throw new Error("Licensing registry unavailable");
    const holder = LICENSE_REGISTRY[licenseNumber];
    return { found: holder !== undefined, holderName: holder ?? null };
  }
}

export class MockDirectionsAdapter implements DirectionsAdapter {
  getRouteLink(from: Coordinates, to: Coordinates): string {
    const f = `${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}`;
    const t = `${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${f}%3B${t}`;
  }
}

export class MockGeocodingAdapter implements GeocodingAdapter {
  async geocode(address: string): Promise<Coordinates> {
    const key = address.trim().toLowerCase().replace(/\s+/g, " ");
    const hit = KNOWN_PLACES[key];
    if (!hit) throw new Error("Address not found");
    return { ...hit };
  }
}

export interface Adapters {
  email: MockEmailAdapter;
  drugReference: MockDrugReferenceAdapter;
  posFeed: MockPosFeedConnector;
  licenseCheck: MockLicenseCheckAdapter;
  directions: MockDirectionsAdapter;
  geocoding: MockGeocodingAdapter;
}

export function createAdapters(clock: Clock): Adapters {
  return {
    email: new MockEmailAdapter(clock),
    drugReference: new MockDrugReferenceAdapter(),
    posFeed: new MockPosFeedConnector(),
    licenseCheck: new MockLicenseCheckAdapter(),
    directions: new MockDirectionsAdapter(),
    geocoding: new MockGeocodingAdapter(),
  };
}
