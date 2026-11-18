import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { audit } from "./lib/audit";
import { firstName, requireAdmin } from "./lib/auth";
import { daysBetween, todayUtc } from "./lib/dates";
import {
  EVENT_ID_HEADER,
  SIGNATURE_HEADER,
  signPayload,
  TIMESTAMP_HEADER,
} from "./lib/signing";

/** Delays before retry 1, 2, 3, 4 (then the event is marked failed). */
export const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;

const APP_PATH_FOR: Record<"lender" | "borrower", string> = {
  lender: "/incoming",
  borrower: "/requests",
};

/* ------------------------------------------------------------------ */
/* Convex -> n8n: request notifications                                */
/* ------------------------------------------------------------------ */

/**
 * Build the webhook body for one outbox row. Data minimisation: n8n gets
 * only what it needs to write one message to one person: their first
 * name and email, the tool name, the dates and a link back into the app.
 * No last names, no other party's contact details, no free-text message.
 */
export const getNotificationPayload = internalQuery({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.kind !== "notification") return null;
    if (event.status !== "pending") return { status: event.status } as const;

    const loan = event.loanId ? await ctx.db.get(event.loanId) : null;
    const tool = loan ? await ctx.db.get(loan.toolId) : null;
    if (!loan || !tool || !event.recipient || !event.notificationType) {
      return { status: "invalid" } as const;
    }
    const person = await ctx.db.get(
      event.recipient === "lender" ? loan.lenderId : loan.borrowerId,
    );
    if (!person?.email) return { status: "no_email" } as const;

    return {
      status: "pending",
      key: event.key,
      payload: {
        id: event.key,
        type: event.notificationType,
        occurredAt: new Date(event._creationTime).toISOString(),
        recipient: {
          role: event.recipient,
          firstName: firstName(person.name),
          email: person.email,
        },
        tool: { name: tool.name },
        loan: {
          id: loan._id,
          status: loan.status,
          startDate: loan.startDate,
          endDate: loan.endDate,
        },
        appPath: APP_PATH_FOR[event.recipient],
      },
    } as const;
  },
});

export const deliverNotification = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const built = await ctx.runQuery(
      internal.automation.getNotificationPayload,
      { eventId },
    );
    if (!built || built.status !== "pending") {
      if (built?.status === "no_email" || built?.status === "invalid") {
        await ctx.runMutation(internal.automation.markNotification, {
          eventId,
          outcome: "skipped",
          detail:
            built.status === "no_email"
              ? "Recipient has no email address"
              : "Loan or tool no longer exists",
        });
      }
      return; // already delivered / failed / skipped
    }

    const url = process.env.N8N_LOAN_EVENTS_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_SECRET_CONVEX_TO_N8N;
    if (!url || !secret) {
      await ctx.runMutation(internal.automation.markNotification, {
        eventId,
        outcome: "skipped",
        detail: "n8n is not configured (N8N_LOAN_EVENTS_WEBHOOK_URL / LENDLOOP_SECRET_CONVEX_TO_N8N)",
      });
      return;
    }

    const body = JSON.stringify(built.payload);
    const { timestamp, signature } = await signPayload(secret, body);

    let error: string | undefined;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
          [EVENT_ID_HEADER]: built.key,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 200);
        error = `n8n responded ${res.status}${text ? `: ${text}` : ""}`;
      }
    } catch (e) {
      error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }

    await ctx.runMutation(internal.automation.markNotification, {
      eventId,
      outcome: error ? "attempt_failed" : "delivered",
      detail: error,
    });
  },
});

/** Record the result of one delivery attempt and schedule a retry if needed. */
export const markNotification = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    outcome: v.union(
      v.literal("delivered"),
      v.literal("attempt_failed"),
      v.literal("skipped"),
    ),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, outcome, detail }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return;
    const now = Date.now();

    if (outcome === "skipped") {
      await ctx.db.patch(eventId, { status: "skipped", detail, updatedAt: now });
      return;
    }
    const attempts = event.attempts + 1;
    if (outcome === "delivered") {
      await ctx.db.patch(eventId, {
        status: "delivered",
        attempts,
        lastError: undefined,
        updatedAt: now,
      });
      return;
    }
    if (attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(eventId, {
        status: "failed",
        attempts,
        lastError: detail,
        updatedAt: now,
      });
      await audit(ctx, "system", "notification.failed", "automationEvents", eventId, detail);
      return;
    }
    await ctx.db.patch(eventId, { attempts, lastError: detail, updatedAt: now });
    await ctx.scheduler.runAfter(
      RETRY_DELAYS_MS[attempts - 1],
      internal.automation.deliverNotification,
      { eventId },
    );
  },
});

/* ------------------------------------------------------------------ */
/* n8n -> Convex: overdue reminders (called from http.ts)              */
/* ------------------------------------------------------------------ */

export function reminderKey(loanId: Id<"loans">, date: string): string {
  return `reminder:${loanId}:${date}`;
}

/**
 * Approved loans whose end date has passed and that have not had a
 * successful reminder today. "Today" is decided by Convex, not by the
 * caller, so n8n cannot be tricked into reminding early.
 */
export const listOverdueForReminders = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_and_endDate", (q) =>
        q.eq("status", "approved").lt("endDate", today),
      )
      .take(500);

    const due = [];
    for (const loan of loans) {
      if (loan.lastReminderOn === today) continue;
      const [borrower, tool] = await Promise.all([
        ctx.db.get(loan.borrowerId),
        ctx.db.get(loan.toolId),
      ]);
      if (!borrower?.email || !tool) continue;
      due.push({
        loanId: loan._id,
        reminderKey: reminderKey(loan._id, today),
        toolName: tool.name,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { firstName: firstName(borrower.name), email: borrower.email },
        appPath: "/requests",
      });
    }
    return { asOf: today, count: due.length, loans: due };
  },
});

/**
 * Idempotent write-back from the overdue workflow. The key is
 * `reminder:<loanId>:<date>`, so a retried or duplicated call is
 * recognised and does not count a second reminder.
 */
export const recordReminder = internalMutation({
  args: {
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { reminderKey: key, status, error }) => {
    const match = /^reminder:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(key);
    const loanId = match ? ctx.db.normalizeId("loans", match[1]) : null;
    if (!match || !loanId) return { ok: false, error: "invalid_key" } as const;
    const loan = await ctx.db.get(loanId);
    if (!loan) return { ok: false, error: "loan_not_found" } as const;
    const date = match[2];
    const now = Date.now();

    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (existing?.status === "sent") {
      return { ok: true, duplicate: true } as const;
    }
    if (existing) {
      // A previous attempt failed: count this attempt and upgrade on success.
      await ctx.db.patch(existing._id, {
        status,
        attempts: existing.attempts + 1,
        lastError: status === "failed" ? error : undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("automationEvents", {
        key,
        kind: "reminder",
        status,
        loanId,
        recipient: "borrower",
        attempts: 1,
        lastError: status === "failed" ? error : undefined,
        updatedAt: now,
      });
    }
    if (status === "sent") {
      await ctx.db.patch(loanId, {
        lastReminderOn: date,
        reminderCount: loan.reminderCount + 1,
      });
    }
    await audit(ctx, "n8n", `reminder.${status}`, "loans", loanId, error);
    return { ok: true, duplicate: false } as const;
  },
});

/** Failures reported by the n8n error workflow, so they show up in the app. */
export const recordWorkflowError = internalMutation({
  args: {
    executionId: v.string(),
    workflowName: v.string(),
    nodeName: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const key = `workflow_error:${args.executionId}`;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) return { ok: true, duplicate: true } as const;
    await ctx.db.insert("automationEvents", {
      key,
      kind: "workflow_error",
      status: "failed",
      attempts: 1,
      lastError: args.message,
      detail: `${args.workflowName}${args.nodeName ? ` › ${args.nodeName}` : ""} (execution ${args.executionId})`,
      updatedAt: Date.now(),
    });
    return { ok: true, duplicate: false } as const;
  },
});

/* ------------------------------------------------------------------ */
/* Admin: automation health                                            */
/* ------------------------------------------------------------------ */

export const healthForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const take = (
      kind: Doc<"automationEvents">["kind"],
      status: Doc<"automationEvents">["status"],
      n: number,
    ) =>
      ctx.db
        .query("automationEvents")
        .withIndex("by_kind_and_status", (q) =>
          q.eq("kind", kind).eq("status", status),
        )
        .order("desc")
        .take(n);

    const [failedNotifications, failedReminders, workflowErrors, pending] =
      await Promise.all([
        take("notification", "failed", 20),
        take("reminder", "failed", 20),
        take("workflow_error", "failed", 20),
        take("notification", "pending", 50),
      ]);
    const recent = await ctx.db
      .query("automationEvents")
      .order("desc")
      .take(15);

    const failures = [...failedNotifications, ...failedReminders, ...workflowErrors]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 25)
      .map((e) => ({
        _id: e._id,
        kind: e.kind,
        key: e.key,
        attempts: e.attempts,
        lastError: e.lastError,
        detail: e.detail,
        at: e.updatedAt,
      }));
    return {
      pendingCount: pending.length,
      failures,
      recent: recent.map((e) => ({
        _id: e._id,
        kind: e.kind,
        status: e.status,
        notificationType: e.notificationType,
        attempts: e.attempts,
        at: e.updatedAt,
      })),
    };
  },
});
