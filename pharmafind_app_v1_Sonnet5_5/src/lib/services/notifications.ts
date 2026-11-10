import type { Ctx } from "../context";
import { AppError } from "../errors";
import type { Account, Notification, NotificationType } from "../types";

export const MAX_EMAIL_RETRIES = 3;

/** Entity Notification: compose(), send(), markFailed(), retry() - delivered through the Email Adapter. */
export class NotificationService {
  constructor(private ctx: Ctx) {}

  get(notificationId: string): Notification | undefined {
    return this.ctx.db.get<Notification>("notifications", notificationId);
  }

  compose(recipientAccountId: string, type: NotificationType, subject: string, body: string): Notification {
    const notificationId = this.ctx.db.nextId("ntf");
    return this.ctx.db.save<Notification>("notifications", notificationId, {
      notificationId, recipient: recipientAccountId, type, subject, body, status: "pending", retryCount: 0, createdAt: this.ctx.clock.iso(),
    });
  }

  async send(notification: Notification): Promise<Notification> {
    const account = this.ctx.db.get<Account>("accounts", notification.recipient);
    if (!account) throw new AppError("NOT_FOUND", "Recipient account not found");
    let ok = false;
    try {
      ok = (await this.ctx.adapters.email.sendEmail(account.email, notification.subject, notification.body)).ok;
    } catch {
      ok = false;
    }
    return ok ? this.ctx.db.save("notifications", notification.notificationId, { ...notification, status: "sent" as const }) : this.markFailed(notification);
  }

  markFailed(notification: Notification): Notification {
    return this.ctx.db.save("notifications", notification.notificationId, { ...notification, status: "failed" as const });
  }

  /** Each retry attempt counts, whether or not it succeeds. */
  async retry(notification: Notification): Promise<Notification> {
    const counted = this.ctx.db.save("notifications", notification.notificationId, { ...notification, retryCount: notification.retryCount + 1 });
    return this.send(counted);
  }

  /** Scheduled job: retry every failed e-mail that has attempts left. */
  async retryFailed(): Promise<number> {
    const failed = this.ctx.db.query<Notification>("notifications", (n) => n.status === "failed" && n.retryCount < MAX_EMAIL_RETRIES);
    for (const n of failed) await this.retry(n);
    return failed.length;
  }

  composeAndSend(recipientAccountId: string, type: NotificationType, subject: string, body: string): Promise<Notification> {
    return this.send(this.compose(recipientAccountId, type, subject, body));
  }
}
