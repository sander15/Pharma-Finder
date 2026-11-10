import type { Ctx } from "../context";
import type { SyncLog } from "../types";

/** Entity SyncLog: record(), getLatestFor(), isOlderThan(). */
export class SyncLogService {
  constructor(private ctx: Ctx) {}

  record(entry: { pharmacy: string; feedImport: string | null; success: boolean; details: string }): SyncLog {
    const logId = this.ctx.db.nextId("log");
    return this.ctx.db.save<SyncLog>("syncLogs", logId, { logId, ...entry, syncedAt: this.ctx.clock.iso() });
  }

  private forPharmacy(pharmacyId: string): SyncLog[] {
    return this.ctx.db.query<SyncLog>("syncLogs", (l) => l.pharmacy === pharmacyId);
  }

  private latest(logs: SyncLog[]): SyncLog | undefined {
    // ">=" keeps the most recently inserted log when two share a timestamp
    return logs.reduce<SyncLog | undefined>((best, l) => (!best || l.syncedAt >= best.syncedAt ? l : best), undefined);
  }

  /** Most recent sync attempt (successful or not). */
  getLatestFor(pharmacyId: string): SyncLog | undefined {
    return this.latest(this.forPharmacy(pharmacyId));
  }

  /** Most recent SUCCESSFUL sync - what the 24h freshness rule is measured against. */
  getLatestSuccessFor(pharmacyId: string): SyncLog | undefined {
    return this.latest(this.forPharmacy(pharmacyId).filter((l) => l.success));
  }

  /** True when there is no log or the log is older than `ms`. */
  isOlderThan(log: SyncLog | undefined, ms: number): boolean {
    if (!log) return true;
    return this.ctx.clock.now().getTime() - new Date(log.syncedAt).getTime() > ms;
  }
}
