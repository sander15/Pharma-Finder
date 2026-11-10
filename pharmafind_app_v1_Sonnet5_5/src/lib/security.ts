import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Crypto helpers for Access and Authentication.
 * Demo note: scrypt cost is intentionally low (N=1024) so tests and cold starts stay fast.
 * Raise N (e.g. 2**15) for a real deployment.
 */
const SCRYPT = { N: 1024, r: 8, p: 1 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32, SCRYPT).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32, SCRYPT);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** One-way hash for short security codes (salted with the account id). */
export function hashCode(code: string, accountId: string): string {
  return createHash("sha256").update(`${accountId}:${code}`).digest("hex");
}

export function randomSecurityCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Stateless signed session token: base64url(payload).hmac - works across serverless instances. */
export function signToken(payload: Record<string, unknown>, secret: string): string {
  const body = b64(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken<T = Record<string, unknown>>(token: string, secret: string): T | null {
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
