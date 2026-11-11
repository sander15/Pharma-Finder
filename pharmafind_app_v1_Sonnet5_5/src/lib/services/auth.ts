import { MINUTE_MS, type Ctx } from "../context";
import { AppError } from "../errors";
import { generateSecurityCode, hashCode, hashPassword, signToken, verifyPassword, verifyToken } from "../security";
import type { Account, Admin, PharmacyStaff, Role, SecurityCode, SessionAccount } from "../types";
import type { NotificationService } from "./notifications";

export const SESSION_TTL_SEC = 12 * 3600;
export const CODE_TTL_MS = 15 * MINUTE_MS;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_LOGIN_FAILURES = 5;
export const LOCKOUT_MS = 15 * MINUTE_MS;

export const PASSWORD_RULE = "Password must be at least 8 characters and contain a letter and a digit";
export const isStrongPassword = (p: string) => p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);

const GENERIC_LOGIN_ERROR = "Incorrect e-mail or password";
const GENERIC_CODE_ERROR = "That security code is invalid or has expired";
// Verified against when the e-mail is unknown, so unknown and known accounts cost the same time.
const DUMMY_HASH = hashPassword("not-a-real-password-1");

/** Access and Authentication (Layer 2): authenticate, issue session token, authorize, own-pharmacy scope, password reset. */
export class AuthService {
  private failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(private ctx: Ctx, private notifications: NotificationService) {}

  /* ---------------------------------------------------------------------------------------------- sessions */

  private findByEmail(email: string): Account | undefined {
    const e = email.trim().toLowerCase();
    return this.ctx.db.query<Account>("accounts", (a) => a.email.toLowerCase() === e)[0];
  }

  private toSession(account: Account): SessionAccount {
    const staff = this.ctx.db.query<PharmacyStaff>("pharmacyStaff", (s) => s.account === account.accountId)[0];
    const admin = this.ctx.db.query<Admin>("admins", (a) => a.account === account.accountId)[0];
    return { accountId: account.accountId, email: account.email, role: account.role, fullName: staff?.fullName ?? admin?.fullName ?? account.email, pharmacyId: staff?.pharmacy ?? null };
  }

  issueSessionToken(account: Account): string {
    const iat = this.ctx.clock.now().getTime();
    return signToken({ sub: account.accountId, v: account.tokenVersion, iat, exp: iat + SESSION_TTL_SEC * 1000 }, this.ctx.secret);
  }

  async login(emailIn: string, password: string): Promise<{ token: string; account: SessionAccount }> {
    const key = emailIn.trim().toLowerCase();
    const now = this.ctx.clock.now().getTime();
    const f = this.failures.get(key);
    if (f && f.lockedUntil > now) throw new AppError("TOO_MANY_ATTEMPTS", "Too many failed attempts. Try again in a few minutes.");
    const account = this.findByEmail(emailIn);
    const ok = verifyPassword(password, account?.passwordHash ?? DUMMY_HASH) && !!account && account.isActive;
    if (!ok) {
      const prior = f && f.lockedUntil <= now && f.lockedUntil !== 0 ? { count: 0, lockedUntil: 0 } : f ?? { count: 0, lockedUntil: 0 };
      const count = prior.count + 1;
      this.failures.set(key, { count, lockedUntil: count >= MAX_LOGIN_FAILURES ? now + LOCKOUT_MS : 0 });
      if (this.failures.size > 5000) this.failures.clear();
      throw new AppError("UNAUTHENTICATED", GENERIC_LOGIN_ERROR);
    }
    this.failures.delete(key);
    return { token: this.issueSessionToken(account!), account: this.toSession(account!) };
  }

  /** Returns the session account for a valid, unexpired token of an active account, otherwise null. */
  authenticate(token: string | undefined): SessionAccount | null {
    if (!token) return null;
    const payload = verifyToken(token, this.ctx.secret);
    if (!payload || this.ctx.clock.now().getTime() > payload.exp) return null;
    const account = this.ctx.db.get<Account>("accounts", payload.sub);
    if (!account || !account.isActive || payload.v !== account.tokenVersion) return null;
    return this.toSession(account);
  }

  /* ---------------------------------------------------------------------------------------- authorization */

  /** Account.hasPermission() */
  hasPermission(session: SessionAccount, role: Role): boolean {
    return session.role === role;
  }

  /** Account.canAccessPharmacy(): staff may only touch their own pharmacy; admins use the admin console instead. */
  canAccessPharmacy(session: SessionAccount, pharmacyId: string): boolean {
    return session.role === "pharmacy_staff" && session.pharmacyId === pharmacyId;
  }

  requireRole(session: SessionAccount | null, role: Role): SessionAccount {
    if (!session) throw new AppError("UNAUTHENTICATED", "Please log in");
    if (!this.hasPermission(session, role)) throw new AppError("FORBIDDEN", "You do not have permission to do that");
    return session;
  }

  /** checkPharmacyScope() */
  requirePharmacyScope(session: SessionAccount | null, pharmacyId: string): SessionAccount {
    if (!session) throw new AppError("UNAUTHENTICATED", "Please log in");
    if (!this.canAccessPharmacy(session, pharmacyId)) throw new AppError("FORBIDDEN", "Access denied: you can only manage your own pharmacy");
    return session;
  }

  /* ------------------------------------------------------------------------ password reset / security codes */

  /** Always answers the same way, so nobody can probe which e-mails have an account. */
  async startPasswordReset(email: string): Promise<void> {
    const account = this.findByEmail(email);
    if (!account || !account.isActive) return;
    for (const c of this.ctx.db.query<SecurityCode>("securityCodes", (c) => c.account === account.accountId && !c.isUsed)) {
      this.ctx.db.save("securityCodes", c.codeId, { ...c, isUsed: true }); // a new request invalidates earlier codes
    }
    const code = generateSecurityCode();
    const notification = await this.notifications.composeAndSend(
      account.accountId,
      "security_code",
      "Your Pharmafind security code",
      `Your Pharmafind security code is ${code}.\n\nIt expires in 15 minutes and can be used once. If you did not ask to reset your password, you can ignore this e-mail.\n`,
    );
    const codeId = this.ctx.db.nextId("code");
    this.ctx.db.save<SecurityCode>("securityCodes", codeId, {
      codeId,
      account: account.accountId,
      codeHash: hashCode(code, this.ctx.secret),
      expiresAt: new Date(this.ctx.clock.now().getTime() + CODE_TTL_MS).toISOString(),
      isUsed: false,
      failedAttempts: 0,
      notification: notification.notificationId,
    });
  }

  /** verifySecurityCode() + resetPassword() */
  resetPassword(email: string, code: string, newPassword: string): void {
    if (!isStrongPassword(newPassword)) throw new AppError("VALIDATION_ERROR", PASSWORD_RULE);
    const account = this.findByEmail(email);
    const live = account
      ? this.ctx.db.query<SecurityCode>("securityCodes", (c) => c.account === account.accountId && !c.isUsed).sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0]
      : undefined;
    if (!account || !live || new Date(live.expiresAt).getTime() < this.ctx.clock.now().getTime()) throw new AppError("VALIDATION_ERROR", GENERIC_CODE_ERROR);
    if (hashCode(code, this.ctx.secret) !== live.codeHash) {
      const failedAttempts = live.failedAttempts + 1;
      this.ctx.db.save("securityCodes", live.codeId, { ...live, failedAttempts, isUsed: failedAttempts >= MAX_CODE_ATTEMPTS });
      throw new AppError("VALIDATION_ERROR", GENERIC_CODE_ERROR);
    }
    this.ctx.db.save("securityCodes", live.codeId, { ...live, isUsed: true });
    this.ctx.db.save("accounts", account.accountId, { ...account, passwordHash: hashPassword(newPassword), tokenVersion: account.tokenVersion + 1 });
    this.failures.delete(email.trim().toLowerCase());
  }
}
