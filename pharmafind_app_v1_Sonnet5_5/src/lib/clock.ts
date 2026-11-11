/**
 * Injectable clock. Every time-dependent rule (24 h freshness, token expiry, job schedules) reads it,
 * so the demo can fast-forward time and tests can pin it. With no start date it follows real time + offset.
 */
export class Clock {
  private readonly base: number | null;
  offsetMs = 0;

  constructor(start?: Date | string | number) {
    this.base = start === undefined ? null : new Date(start).getTime();
  }

  now(): Date {
    return new Date((this.base ?? Date.now()) + this.offsetMs);
  }

  iso(): string {
    return this.now().toISOString();
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}
