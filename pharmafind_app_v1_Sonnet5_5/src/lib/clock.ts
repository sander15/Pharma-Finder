/**
 * Injectable clock. Production uses real time (plus an optional demo offset so the Demo Panel
 * can "fast-forward" to show stale-sync alerts); tests pass a fixed start instant.
 */
export class Clock {
  private fixed: number | null;
  private offsetMs = 0;

  constructor(start?: Date) {
    this.fixed = start ? start.getTime() : null;
  }

  now(): Date {
    return new Date((this.fixed ?? Date.now()) + this.offsetMs);
  }

  iso(): string {
    return this.now().toISOString();
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }

  /** Demo helper: how far the clock has been moved from real/start time. */
  get offset(): number {
    return this.offsetMs;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}
