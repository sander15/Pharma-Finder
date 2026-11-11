import { MINUTE_MS, STALE_AFTER_MS, type Ctx } from "../context";
import type { JobType, Pharmacy, ScheduledJob, Notification } from "../types";
import type { AutomaticFeedService } from "./automaticFeed";
import type { CatalogService } from "./catalog";
import type { FeedImportService } from "./feedImport";
import type { NotificationService } from "./notifications";
import type { PharmacyService } from "./pharmacies";

export const JOB_TYPES: JobType[] = ["pull_pos_feeds", "check_stale_sync", "refresh_drug_reference", "retry_failed_emails"];

export interface JobRunResult { type: JobType; summary: string }

/**
 * Job Scheduler and Background Worker (Layer 3): schedule(), isDue(), execute() and the four jobs.
 *
 * Serverless note: Vercel has no always-on worker, so this demo drives tick() from the Demo panel, from
 * opportunistic ticks on API requests and from a daily Vercel Cron. A real worker would call the same code.
 */
export class SchedulerService {
  constructor(
    private ctx: Ctx,
    private feeds: AutomaticFeedService,
    private feedImport: FeedImportService,
    private pharmacies: PharmacyService,
    private notifications: NotificationService,
    private catalog: CatalogService,
  ) {}

  listJobs(): ScheduledJob[] {
    return this.ctx.db.query<ScheduledJob>("scheduledJobs").sort((a, b) => JOB_TYPES.indexOf(a.type) - JOB_TYPES.indexOf(b.type));
  }

  /** ScheduledJob.schedule(): make sure the job runs within `intervalMinutes` from now. */
  schedule(type: JobType, intervalMinutes: number): void {
    const job = this.listJobs().find((j) => j.type === type);
    if (!job) return;
    const soonest = this.ctx.clock.now().getTime() + intervalMinutes * MINUTE_MS;
    if (new Date(job.nextRunAt).getTime() > soonest) this.ctx.db.save("scheduledJobs", job.jobId, { ...job, nextRunAt: new Date(soonest).toISOString() });
  }

  isDue(job: ScheduledJob): boolean {
    return new Date(job.nextRunAt).getTime() <= this.ctx.clock.now().getTime();
  }

  /** Runs every job whose time has come, in a fixed order. */
  async tick(): Promise<{ ran: JobType[]; results: JobRunResult[] }> {
    const results: JobRunResult[] = [];
    for (const job of this.listJobs()) {
      if (this.isDue(job)) results.push(await this.execute(job));
    }
    return { ran: results.map((r) => r.type), results };
  }

  /** Forces one job to run now regardless of its schedule (demo and tests). */
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
    const fresh = this.ctx.db.get<ScheduledJob>("scheduledJobs", job.jobId) ?? job;
    this.ctx.db.save("scheduledJobs", job.jobId, { ...fresh, lastRunAt: now.toISOString(), nextRunAt: new Date(now.getTime() + job.intervalMinutes * MINUTE_MS).toISOString() });
    return { type: job.type, summary };
  }

  /** pullPosFeeds(): every enabled feed whose own interval has elapsed is fetched and handed to Feed Import. */
  async pullPosFeeds(): Promise<number> {
    const now = this.ctx.clock.now().getTime();
    const due = this.feeds.listEnabled().filter((f) => f.lastPulledAt === null || now - new Date(f.lastPulledAt).getTime() >= f.intervalMinutes * MINUTE_MS);
    for (const feed of due) {
      try {
        const rows = await this.feeds.fetchLatestData(feed);
        this.feedImport.importRows({ pharmacyId: feed.pharmacy, source: "pos", rows, feedId: feed.feedId });
      } catch (e) {
        this.feedImport.rejectFeed({ pharmacyId: feed.pharmacy, source: "pos", feedId: feed.feedId, reason: `POS pull failed: ${(e as Error).message}` });
      }
      this.feeds.markPulled(feed);
    }
    return due.length;
  }

  /** checkStaleSync(): e-mails the pharmacy account when its last successful sync is older than 24 h (at most once per 24 h). */
  async checkStaleSync(): Promise<number> {
    const now = this.ctx.clock.now().getTime();
    let alerts = 0;
    for (const pharmacy of this.ctx.db.query<Pharmacy>("pharmacies", (p) => this.pharmacies.isVisibleInSearch(p))) {
      if (!this.pharmacies.isSyncStale(pharmacy.pharmacyId)) continue;
      for (const account of this.pharmacies.staffAccounts(pharmacy.pharmacyId)) {
        const recentlyAlerted = this.ctx.db
          .query<Notification>("notifications", (n) => n.recipient === account.accountId && n.type === "stale_sync")
          .some((n) => now - new Date(n.createdAt).getTime() < STALE_AFTER_MS);
        if (recentlyAlerted) continue;
        await this.notifications.composeAndSend(
          account.accountId,
          "stale_sync",
          `Pharmafind: ${pharmacy.name} data has not synced in over 24 hours`,
          `Hello,\n\nThe stock and price data for ${pharmacy.name} has not synced within the expected 24-hour window, so searchers see it labelled "stale data".\n\nUpload a CSV or check your automatic POS feed in the Pharmafind pharmacy portal.\n`,
        );
        alerts++;
      }
    }
    return alerts;
  }
}
