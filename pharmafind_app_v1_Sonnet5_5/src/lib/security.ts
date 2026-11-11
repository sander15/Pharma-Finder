import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

/** Demo-grade scrypt cost (a production system would use a much higher N). */
const SCRYPT_N = 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !n || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: Number(n), r: 8, p: 1 });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
  [k: string]: unknown;
}

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

/** Stateless signed session token: base64url(payload).HMAC-SHA256 */
export function signToken(payload: TokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Returns the payload when the signature is valid, otherwise null. Expiry is checked by the caller (it owns the clock). */
export function verifyToken(token: string, secret: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(sign(parts[0], secret));
  const given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as TokenPayload;
    return typeof payload?.sub === "string" ? payload : null;
  } catch {
    return null;
  }
}

export function generateSecurityCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(`security-code:${code}`).digest("hex");
}
