import type { Ctx } from "../context";
import type { Account, Notification, NotificationType } from "../types";

export const MAX_EMAIL_RETRIES = 5;

/** Notifications (Layer 3): compose(), send(), markFailed(), retry() on top of the Email adapter. */
export class NotificationService {
  constructor(private ctx: Ctx) {}

  compose(recipient: string, type: NotificationType, subject: string, body: string): Notification {
    const notificationId = this.ctx.db.nextId("ntf");
    const n: Notification = { notificationId, recipient, type, subject, body, status: "pending", retryCount: 0, createdAt: this.ctx.clock.iso() };
    return this.ctx.db.save("notifications", notificationId, n);
  }

  /** Sends through the Email adapter; a failure marks the notification failed so the retry job picks it up. */
  async send(n: Notification): Promise<Notification> {
    const account = this.ctx.db.get<Account>("accounts", n.recipient);
    if (!account) return this.markFailed(n);
    try {
      await this.ctx.adapters.email.sendEmail({ to: account.email, subject: n.subject, body: n.body });
      return this.ctx.db.save("notifications", n.notificationId, { ...n, status: "sent" as const });
    } catch {
      return this.markFailed(n);
    }
  }

  markFailed(n: Notification): Notification {
    return this.ctx.db.save("notifications", n.notificationId, { ...n, status: "failed" as const });
  }

  async retry(n: Notification): Promise<Notification> {
    return this.send({ ...n, retryCount: n.retryCount + 1 });
  }

  async composeAndSend(recipient: string, type: NotificationType, subject: string, body: string): Promise<Notification> {
    return this.send(this.compose(recipient, type, subject, body));
  }

  /** JOB.retryFailedEmails(): every failed notification that still has retries left. Returns the number of attempts made. */
  async retryFailed(): Promise<number> {
    const failed = this.ctx.db.query<Notification>("notifications", (n) => n.status === "failed" && n.retryCount < MAX_EMAIL_RETRIES);
    for (const n of failed) await this.retry(n);
    return failed.length;
  }
}
