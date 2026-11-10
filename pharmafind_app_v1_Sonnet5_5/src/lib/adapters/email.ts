import type { Clock } from "../clock";

export interface SentEmail {
  to: string;
  subject: string;
  body: string;
  sentAt: string;
}

export interface EmailResult {
  ok: boolean;
  error?: string;
}

/** «interface - Layer 4» Email Adapter (external: Email service for security codes and sync alerts). */
export interface EmailAdapter {
  sendEmail(to: string, subject: string, body: string): Promise<EmailResult>;
}

/**
 * MOCK e-mail service. Nothing leaves the process: messages land in an in-memory outbox that the
 * Demo Panel shows as a mailbox. `setFailing(true)` simulates an outage (to exercise retries).
 */
export class MockEmailAdapter implements EmailAdapter {
  readonly outbox: SentEmail[] = [];
  private failing = false;

  constructor(private clock: Clock) {}

  setFailing(failing: boolean): void {
    this.failing = failing;
  }

  get isFailing(): boolean {
    return this.failing;
  }

  async sendEmail(to: string, subject: string, body: string): Promise<EmailResult> {
    if (this.failing) return { ok: false, error: "Email service unavailable (simulated outage)" };
    this.outbox.push({ to, subject, body, sentAt: this.clock.iso() });
    return { ok: true };
  }
}
