export interface ConnectionResult {
  ok: boolean;
  message: string;
}

/** «interface - Layer 4» POS Feed Connector (external: Pharmacy inventory / POS systems, 1..*). */
export interface PosFeedConnector {
  pullFeed(endpoint: string): Promise<unknown[]>;
  testConnection(endpoint: string): Promise<ConnectionResult>;
}

/** Rows in the Pharmafind standard format: { catalogId, stock (whole number), price (> 0, 2 dp) }. */
type Row = { catalogId: string; stock: number; price: number };

const COMPLIANT: Record<string, Row[]> = {
  "https://pos.mock/hub-city": [
    { catalogId: "PF-1001", stock: 38, price: 7.99 },
    { catalogId: "PF-1002", stock: 22, price: 8.49 },
    { catalogId: "PF-1005", stock: 30, price: 9.49 },
    { catalogId: "PF-1011", stock: 14, price: 12.99 },
  ],
  "https://pos.mock/slide-road": [
    { catalogId: "PF-1001", stock: 30, price: 7.49 },
    { catalogId: "PF-1002", stock: 18, price: 8.29 },
    { catalogId: "PF-1004", stock: 9, price: 8.99 },
    { catalogId: "PF-1005", stock: 26, price: 8.99 },
    { catalogId: "PF-1010", stock: 40, price: 11.5 },
  ],
  "https://pos.mock/canyon-lakes": [
    { catalogId: "PF-1001", stock: 24, price: 8.99 },
    { catalogId: "PF-1003", stock: 15, price: 6.99 },
    { catalogId: "PF-1012", stock: 33, price: 13.49 },
  ],
  "https://pos.mock/tech-terrace": [
    { catalogId: "PF-1001", stock: 11, price: 8.49 },
    { catalogId: "PF-1006", stock: 7, price: 9.79 },
  ],
};

/** A syntactically reachable POS that sends NON-standard data (wrong field names/types). */
const NON_COMPLIANT: unknown[] = [
  { sku: "PF-1001", qty: "5", cost: "7.5" },
  { sku: "PF-1002", qty: "2", cost: "$8.00" },
  { catalogId: "pf-1003", stock: "many", price: "cheap" },
];

/** A POS that sends some good rows and some bad ones. */
const MIXED: unknown[] = [
  { catalogId: "PF-1001", stock: 12, price: 7.99 },
  { catalogId: "PF-1002", stock: 8, price: 8.49 },
  { catalogId: "PF-9999", stock: 3, price: 1.99 }, // unknown catalog ID
  { catalogId: "PF-1005", stock: -4, price: 9.99 }, // negative stock
];

const UNREACHABLE = new Set(["https://pos.mock/down"]);

/**
 * MOCK POS systems. Known endpoints (also listed in the portal help text):
 *   https://pos.mock/hub-city | slide-road | canyon-lakes | tech-terrace   -> compliant feeds
 *   https://pos.mock/mixed          -> partially compliant (some rows rejected)
 *   https://pos.mock/non-compliant  -> connects, but data is not in the standard format (all rejected)
 *   https://pos.mock/down           -> connection error
 * Any other endpoint fails to connect. Data is returned exactly as the "POS" sends it.
 */
export class MockPosFeedConnector implements PosFeedConnector {
  static readonly ENDPOINTS = [...Object.keys(COMPLIANT), "https://pos.mock/mixed", "https://pos.mock/non-compliant", "https://pos.mock/down"];

  private known(endpoint: string): boolean {
    return endpoint in COMPLIANT || endpoint === "https://pos.mock/mixed" || endpoint === "https://pos.mock/non-compliant";
  }

  async testConnection(endpoint: string): Promise<ConnectionResult> {
    if (UNREACHABLE.has(endpoint)) return { ok: false, message: "Connection timed out (simulated POS outage)." };
    if (!this.known(endpoint)) return { ok: false, message: `Could not reach a POS system at "${endpoint}".` };
    return { ok: true, message: "Connected to POS system." };
  }

  async pullFeed(endpoint: string): Promise<unknown[]> {
    const test = await this.testConnection(endpoint);
    if (!test.ok) throw new Error(test.message);
    if (endpoint === "https://pos.mock/mixed") return structuredClone(MIXED);
    if (endpoint === "https://pos.mock/non-compliant") return structuredClone(NON_COMPLIANT);
    return structuredClone(COMPLIANT[endpoint]);
  }
}
