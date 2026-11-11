import { ageMinutes, STALE_AFTER_MS, type Ctx } from "../context";
import type { Account, Coordinates, Location, Pharmacy, PharmacyStaff } from "../types";
import type { SyncLogService } from "./syncLogs";

/** Pharmacy + Location entities (Layer 3). */
export class PharmacyService {
  constructor(private ctx: Ctx, private syncLogs: SyncLogService) {}

  get(pharmacyId: string): Pharmacy | undefined {
    return this.ctx.db.get<Pharmacy>("pharmacies", pharmacyId);
  }

  getLocation(pharmacy: Pharmacy): Location {
    const loc = this.ctx.db.get<Location>("locations", pharmacy.location);
    if (!loc) throw new Error(`Location missing for ${pharmacy.pharmacyId}`);
    return loc;
  }

  isVerified(pharmacy: Pharmacy): boolean {
    return pharmacy.verificationStatus === "verified";
  }

  /** A pharmacy appears in search only after verification (registration and verification are separate steps). */
  isVisibleInSearch(pharmacy: Pharmacy): boolean {
    return this.isVerified(pharmacy);
  }

  /** Location.distanceTo(): asks the geo-enabled database. */
  distanceTo(pharmacy: Pharmacy, origin: Coordinates): number {
    return this.ctx.db.geoQuery(this.getLocation(pharmacy), origin);
  }

  /** Pharmacy.isSyncStale(): no successful sync in the last 24 hours. */
  isSyncStale(pharmacyId: string): boolean {
    return this.syncLogs.isOlderThan(this.syncLogs.getLatestSuccessFor(pharmacyId), STALE_AFTER_MS);
  }

  syncAgeMinutes(pharmacyId: string): number | null {
    const log = this.syncLogs.getLatestSuccessFor(pharmacyId);
    return log ? ageMinutes(this.ctx, log.syncedAt) : null;
  }

  /** Records a sync attempt; a successful one also moves the pharmacy's lastSyncAt. */
  recordSync(pharmacyId: string, feedImport: string | null, success: boolean, details: string): void {
    const log = this.syncLogs.record({ pharmacy: pharmacyId, feedImport, success, details });
    const pharmacy = this.get(pharmacyId);
    if (success && pharmacy) this.ctx.db.save("pharmacies", pharmacyId, { ...pharmacy, lastSyncAt: log.syncedAt });
  }

  staffAccounts(pharmacyId: string): Account[] {
    const staff = this.ctx.db.query<PharmacyStaff>("pharmacyStaff", (s) => s.pharmacy === pharmacyId);
    return staff.map((s) => this.ctx.db.get<Account>("accounts", s.account)).filter((a): a is Account => !!a && a.isActive);
  }
}
