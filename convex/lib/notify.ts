import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type NotificationType =
  | "loan.requested"
  | "loan.approved"
  | "loan.declined"
  | "loan.cancelled"
  | "loan.returned";

/**
 * Transactional outbox: the notification row is written in the SAME
 * mutation as the loan change, so a status change can never commit
 * without its notification (or vice versa). Delivery to n8n happens
 * afterwards in a scheduled action that retries on failure.
 *
 * The key is deterministic (one notification per loan per transition),
 * so calling this twice for the same transition is a no-op.
 */
export async function enqueueNotification(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  type: NotificationType,
  recipient: "lender" | "borrower",
): Promise<void> {
  const key = `notification:${loanId}:${type}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing) return;

  const eventId = await ctx.db.insert("automationEvents", {
    key,
    kind: "notification",
    status: "pending",
    loanId,
    notificationType: type,
    recipient,
    attempts: 0,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.automation.deliverNotification, {
    eventId,
  });
}

export type ActivityItem = {
  _id: Id<"automationEvents">;
  kind: Doc<"automationEvents">["kind"];
  status: Doc<"automationEvents">["status"];
  notificationType?: NotificationType;
  recipient?: "lender" | "borrower";
  attempts: number;
  at: number;
};

/** Most recent automation activity for a loan, newest first. */
export async function loanActivity(
  ctx: QueryCtx,
  loanId: Id<"loans">,
  limit = 5,
): Promise<ActivityItem[]> {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .take(limit);
  return events.map((e) => ({
    _id: e._id,
    kind: e.kind,
    status: e.status,
    notificationType: e.notificationType,
    recipient: e.recipient,
    attempts: e.attempts,
    at: e.updatedAt,
  }));
}
