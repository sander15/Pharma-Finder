import type { Ctx } from "../context";
import { AppError } from "../errors";
import type { AutomaticFeed } from "../types";

export const MIN_FEED_INTERVAL = 5;
export const MAX_FEED_INTERVAL = 1440;

/** AutomaticFeed entity: testConnection(), enable(), disable(), fetchLatestData(). One feed per pharmacy. */
export class AutomaticFeedService {
  /** Wired by the composition root: AutomaticFeed.enable() -> ScheduledJob.schedule(intervalMinutes). */
  scheduleHook: (intervalMinutes: number) => void = () => {};

  constructor(private ctx: Ctx) {}

  getForPharmacy(pharmacyId: string): AutomaticFeed | undefined {
    return this.ctx.db.query<AutomaticFeed>("automaticFeeds", (f) => f.pharmacy === pharmacyId)[0];
  }

  listEnabled(): AutomaticFeed[] {
    return this.ctx.db.query<AutomaticFeed>("automaticFeeds", (f) => f.isEnabled);
  }

  /** Connect: test the POS connection first; only a working connection is saved, enabled and scheduled. */
  async configure(pharmacyId: string, posEndpoint: string, intervalMinutes: number): Promise<AutomaticFeed> {
    const test = await this.ctx.adapters.posFeed.testConnection(posEndpoint);
    if (!test.ok) throw new AppError("CONNECTION_FAILED", `Could not connect to the POS system: ${test.error ?? "no response"}. Check the address and try again.`);
    const existing = this.getForPharmacy(pharmacyId);
    const feedId = existing?.feedId ?? this.ctx.db.nextId("feed");
    const feed: AutomaticFeed = { feedId, pharmacy: pharmacyId, posEndpoint, intervalMinutes, isEnabled: true, lastPulledAt: existing && existing.posEndpoint === posEndpoint ? existing.lastPulledAt : null };
    this.ctx.db.save("automaticFeeds", feedId, feed);
    this.scheduleHook(intervalMinutes);
    return feed;
  }

  disable(pharmacyId: string): AutomaticFeed {
    const feed = this.getForPharmacy(pharmacyId);
    if (!feed) throw new AppError("NOT_FOUND", "No automatic feed is configured for this pharmacy");
    return this.ctx.db.save("automaticFeeds", feed.feedId, { ...feed, isEnabled: false });
  }

  markPulled(feed: AutomaticFeed): void {
    this.ctx.db.save("automaticFeeds", feed.feedId, { ...feed, lastPulledAt: this.ctx.clock.iso() });
  }

  /** The raw, unvalidated answer of the POS system (validation is Feed Import's job). */
  fetchLatestData(feed: AutomaticFeed): Promise<unknown> {
    return this.ctx.adapters.posFeed.pullFeed(feed.posEndpoint);
  }
}
