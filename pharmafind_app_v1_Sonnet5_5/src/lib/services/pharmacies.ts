import { STALE_AFTER_MS, type Ctx } from "../context";
import { AppError } from "../errors";
import type { Location, Pharmacy, PharmacyStaff, Account } from "../types";
import type { SyncLogService } from "./syncLogs";

/** Entity Pharmacy: isVerified(), isVisibleInSearch(), isSyncStale(), getListings() lives in ListingService. */
export class PharmacyService {
  constructor(
    private ctx: Ctx,
    private syncLogs: SyncLogService,
  ) {}

  get(pharmacyId: string): Pharmacy {
    const p = this.ctx.db.get<Pharmacy>("pharmacies", pharmacyId);
    if (!p) throw new AppError("NOT_FOUND", "Pharmacy not found");
    return p;
  }

  isVerified(p: Pharmacy): boolean {
    return p.verificationStatus === "verified";
  }

  /** Listings of a pharmacy are live only after verification (pending/rejected are hidden). */
  isVisibleInSearch(p: Pharmacy): boolean {
    return this.isVerified(p);
  }

  /** True when the last successful sync is older than 24 hours (or there never was one). */
  isSyncStale(pharmacyId: string): boolean {
    return this.syncLogs.isOlderThan(this.syncLogs.getLatestSuccessFor(pharmacyId), STALE_AFTER_MS);
  }

  location(p: Pharmacy): Location {
    const l = this.ctx.db.get<Location>("locations", p.location);
    if (!l) throw new AppError("INTERNAL", "Pharmacy has no location");
    return l;
  }

  /** Staff accounts working at a pharmacy (recipients of its alerts). */
  staffAccounts(pharmacyId: string): Account[] {
    const staff = this.ctx.db.query<PharmacyStaff>("pharmacyStaff", (s) => s.pharmacy === pharmacyId);
    return staff.map((s) => this.ctx.db.get<Account>("accounts", s.account)).filter((a): a is Account => !!a && a.isActive);
  }
}
