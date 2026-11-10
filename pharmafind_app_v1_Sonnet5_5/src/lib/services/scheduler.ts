import { MINUTE_MS, STALE_AFTER_MS, type Ctx } from "../context";
import type { AutomaticFeed, JobType, Pharmacy, ScheduledJob } from "../types";
import type { CatalogService } from "./catalog";
import type { FeedImportService } from "./feedImport";
import type { NotificationService } from "./notifications";
import type { PharmacyService } from "./pharmacies";

const JOB_ORDER: JobType[] = ["pull_pos_feeds", "check_stale_sync", "refresh_drug_reference", "retry_failed_emails"];

export interface JobRunResult {
  type: JobType;
  summary: string;
}

/**
 * Job Scheduler and Background Worker (Layer 3): isDue / execute for pullPosFeeds, checkStaleSync,
 * refreshDrugReference, retryFailedEmails.
 *
 * Serverless note: Vercel has no always-on worker, so the demo drives this with tick(), called by
 * the Demo Panel ("Run scheduler now") and by GET /api/cron (Vercel Cron). Same code a real worker would run.
 */
export class SchedulerService {
  constructor(
    private ctx: Ctx,
    private feedImport: FeedImportService,
    private pharmacies: PharmacyService,
    private notifications: NotificationService,
    private catalog: CatalogService,
  ) {}

  listJobs(): ScheduledJob[] {
    return this.ctx.db.query<ScheduledJob>("scheduledJobs").sort((a, b) => JOB_ORDER.indexOf(a.type) - JOB_ORDER.indexOf(b.type));
  }

  isDue(job: ScheduledJob): boolean {
    return new Date(job.nextRunAt).getTime() <= this.ctx.clock.now().getTime();
  }

  /** Runs every job whose time has come. */
  async tick(): Promise<{ ran: JobType[]; results: JobRunResult[] }> {
    const results: JobRunResult[] = [];
    for (const job of this.listJobs()) {
      if (this.isDue(job)) results.push(await this.execute(job));
    }
    return { ran: results.map((r) => r.type), results };
  }

  /** Forces one job to run now regardless of its schedule (demo / tests). */
  async runJob(type: JobType): Promise<JobRunResult> {
    const job = this.listJobs().find((j) => j.type === type);
    if (!job) throw new Error(`Unknown job ${type}`);
    return this.execute(job);
  }

  private async execute(job: ScheduledJob): Promise<JobRunResult> {
    let summary: string;
    switch (job.type) {
      case "pull_pos_feeds":
        summary = `${await this.pullPosFeeds()} feed(s) pulled`;
        break;
      case "check_stale_sync":
        summary = `${await this.checkStaleSync()} stale-sync alert(s) created`;
        break;
      case "refresh_drug_reference":
        summary = `${await this.catalog.refreshAllFromReference()} reference entr(ies) refreshed`;
        break;
      case "retry_failed_emails":
        summary = `${await this.notifications.retryFailed()} e-mail(s) retried`;
        break;
    }
    const now = this.ctx.clock.now();
    this.ctx.db.save("scheduledJobs", job.jobId, { ...job, lastRunAt: now.toISOString(), nextRunAt: new Date(now.getTime() + job.intervalMinutes * MINUTE_MS).toISOString() });
    return { type: job.type, summary };
  }

  /** pullPosFeeds(): every enabled feed whose own interval has elapsed goes through Feed Import. */
  async pullPosFeeds(): Promise<number> {
    const now = this.ctx.clock.now().getTime();
    const due = this.ctx.db.query<AutomaticFeed>(
      "automaticFeeds",
      (f) => f.isEnabled && (f.lastPulledAt === null || now - new Date(f.lastPulledAt).getTime() >= f.intervalMinutes * MINUTE_MS),
    );
    for (const feed of due) {
      try {
        const rows = await this.ctx.adapters.posFeed.pullFeed(feed.posEndpoint); // AutomaticFeed.fetchLatestData()
        await this.feedImport.importRows({ pharmacyId: feed.pharmacy, source: "pos", rows, feedId: feed.feedId, rawCopy: JSON.stringify(rows) });
      } catch (e) {
        await this.feedImport.rejectFeed({ pharmacyId: feed.pharmacy, source: "pos", feedId: feed.feedId, totalRows: 0, reason: `POS pull failed: ${(e as Error).message}` });
      }
      this.ctx.db.save("automaticFeeds", feed.feedId, { ...feed, lastPulledAt: this.ctx.clock.iso() });
    }
    return due.length;
  }

  /** checkStaleSync(): e-mails the pharmacy account when its last successful sync is > 24h old (once per 24h). */
  async checkStaleSync(): Promise<number> {
    const now = this.ctx.clock.now().getTime();
    let alerts = 0;
    for (const pharmacy of this.ctx.db.query<Pharmacy>("pharmacies", (p) => this.pharmacies.isVisibleInSearch(p))) {
      if (!this.feedImport.isSyncStale(pharmacy.pharmacyId)) continue;
      for (const account of this.pharmacies.staffAccounts(pharmacy.pharmacyId)) {
        const recentlyAlerted = this.ctx.db
          .query<{ recipient: string; type: string; createdAt: string }>("notifications", (n) => n.recipient === account.accountId && n.type === "stale_sync")
          .some((n) => now - new Date(n.createdAt).getTime() < STALE_AFTER_MS);
        if (recentlyAlerted) continue;
        await this.notifications.composeAndSend(
          account.accountId,
          "stale_sync",
          `Pharmafind: ${pharmacy.name} data has not synced in over 24 hours`,
          `Hello,\n\nThe stock and price data for ${pharmacy.name} has not synced within the expected 24-hour window, so searchers may see outdated information.\n\nUpload a CSV or check your automatic POS feed in the Pharmafind pharmacy portal.\n`,
        );
        alerts++;
      }
    }
    return alerts;
  }
}
