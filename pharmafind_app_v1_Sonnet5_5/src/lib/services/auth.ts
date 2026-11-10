import { z } from "zod";
import { HOUR_MS, MINUTE_MS, type Ctx } from "../context";
import { AppError } from "../errors";
import { hashCode, hashPassword, randomSecurityCode, signToken, verifyPassword, verifyToken } from "../security";
import type { Account, Admin, PharmacyStaff, Role, SecurityCode, SessionAccount } from "../types";
import { parseInput } from "../validation";
import type { NotificationService } from "./notifications";

export const SESSION_TTL_MS = 12 * HOUR_MS;
export const CODE_TTL_MS = 15 * MINUTE_MS;
const MAX_CODE_ATTEMPTS = 5;

export type Permission = "listing:update" | "csv:upload" | "feed:configure" | "dashboard:view" | "verification:view" | "verification:resubmit" | "verification:review";

const PERMISSIONS: Record<Role, Permission[]> = {
  pharmacy_staff: ["listing:update", "csv:upload", "feed:configure", "dashboard:view", "verification:view", "verification:resubmit"],
  admin: ["verification:review"],
};

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(100);

// A precomputed hash so unknown e-mails cost the same time as wrong passwords.
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

/** Layer 2 - Access and Authentication: logins, roles, password reset, security codes, own-pharmacy scope. */
export class AuthService {
  constructor(
    private ctx: Ctx,
    private notifications: NotificationService,
  ) {}

  private findByEmail(email: string): Account | undefined {
    const e = email.trim().toLowerCase();
    return this.ctx.db.query<Account>("accounts", (a) => a.email.toLowerCase() === e)[0];
  }

  toSession(account: Account): SessionAccount {
    const staff = this.ctx.db.query<PharmacyStaff>("pharmacyStaff", (s) => s.account === account.accountId)[0];
    const admin = this.ctx.db.query<Admin>("admins", (a) => a.account === account.accountId)[0];
    return { accountId: account.accountId, email: account.email, role: account.role, fullName: staff?.fullName ?? admin?.fullName ?? account.email, pharmacyId: staff?.pharmacy ?? null };
  }

  /* ---------- login / session ---------- */

  async login(email: string, password: string): Promise<{ token: string; account: SessionAccount }> {
    const account = typeof email === "string" ? this.findByEmail(email) : undefined;
    const ok = typeof password === "string" && verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !account.isActive || !ok) throw new AppError("INVALID_CREDENTIALS", "Incorrect e-mail or password");
    return { token: this.issueSessionToken(account), account: this.toSession(account) };
  }

  issueSessionToken(account: Account): string {
    return signToken({ sub: account.accountId, exp: this.ctx.clock.now().getTime() + SESSION_TTL_MS }, this.ctx.sessionSecret);
  }

  async authenticate(token: string | null | undefined): Promise<SessionAccount> {
    const payload = token ? verifyToken<{ sub?: string; exp?: number }>(token, this.ctx.sessionSecret) : null;
    if (!payload?.sub || typeof payload.exp !== "number" || payload.exp <= this.ctx.clock.now().getTime()) {
      throw new AppError("UNAUTHENTICATED", "Please sign in");
    }
    const account = this.ctx.db.get<Account>("accounts", payload.sub);
    if (!account || !account.isActive) throw new AppError("UNAUTHENTICATED", "Please sign in");
    return this.toSession(account);
  }

  /* ---------- authorization ---------- */

  hasPermission(account: SessionAccount, permission: Permission): boolean {
    return PERMISSIONS[account.role].includes(permission);
  }

  /** Own-pharmacy data only: staff may touch their pharmacy and nothing else. */
  canAccessPharmacy(account: SessionAccount, pharmacyId: string): boolean {
    return account.role === "pharmacy_staff" && account.pharmacyId === pharmacyId;
  }

  authorize(account: SessionAccount, permission: Permission, pharmacyId?: string): void {
    if (!this.hasPermission(account, permission)) throw new AppError("FORBIDDEN", "Your account does not have permission for this action");
    if (pharmacyId !== undefined && !this.canAccessPharmacy(account, pharmacyId)) throw new AppError("FORBIDDEN", "You do not have access to this pharmacy");
  }

  /* ---------- password reset with security codes ---------- */

  async startPasswordReset(email: string): Promise<void> {
    const account = this.findByEmail(email);
    if (!account || !account.isActive) return; // same outcome either way: no account enumeration

    for (const c of this.ctx.db.query<SecurityCode>("securityCodes", (x) => x.account === account.accountId && !x.isUsed)) this.invalidate(c);

    const code = randomSecurityCode();
    const codeId = this.ctx.db.nextId("code");
    const notification = this.notifications.compose(
      account.accountId,
      "security_code",
      "Your Pharmafind security code",
      `Your Pharmafind security code is ${code}. It expires in 15 minutes. If you did not request a password reset, ignore this e-mail.`,
    );
    this.ctx.db.save<SecurityCode>("securityCodes", codeId, {
      codeId, account: account.accountId, codeHash: hashCode(code, account.accountId),
      expiresAt: new Date(this.ctx.clock.now().getTime() + CODE_TTL_MS).toISOString(), isUsed: false, failedAttempts: 0, notification: notification.notificationId,
    });
    await this.notifications.send(notification);
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    parseInput(passwordSchema, newPassword, "Invalid password");
    const account = this.findByEmail(email);
    if (!account || !account.isActive) throw new AppError("INVALID_CODE", "The security code is invalid or expired");
    if (!(await this.verifySecurityCode(account, code))) throw new AppError("INVALID_CODE", "The security code is invalid or expired");
    this.ctx.db.save("accounts", account.accountId, { ...account, passwordHash: hashPassword(newPassword) });
  }

  /** SecurityCode.verify(): constant outcome for wrong/expired/used; locks the code after 5 wrong tries. */
  private async verifySecurityCode(account: Account, code: string): Promise<boolean> {
    const now = this.ctx.clock.now().getTime();
    const active = this.ctx.db.query<SecurityCode>("securityCodes", (c) => c.account === account.accountId && !c.isUsed && new Date(c.expiresAt).getTime() > now);
    const hash = hashCode(String(code), account.accountId);
    const match = active.find((c) => c.codeHash === hash);
    if (!match) {
      for (const c of active) {
        const failed = c.failedAttempts + 1;
        this.ctx.db.save("securityCodes", c.codeId, { ...c, failedAttempts: failed, isUsed: failed >= MAX_CODE_ATTEMPTS });
      }
      return false;
    }
    this.invalidate(match);
    return true;
  }

  private invalidate(c: SecurityCode): void {
    this.ctx.db.save("securityCodes", c.codeId, { ...c, isUsed: true });
  }

  /* ---------- registration helper ---------- */

  emailTaken(email: string): boolean {
    return !!this.findByEmail(email);
  }
}
