import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { audit } from "./lib/audit";
import { firstName, requireAdmin, requireUser } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { addDays, daysBetween, isValidIsoDate, todayUtc } from "./lib/dates";
import { fail } from "./lib/errors";
import { approvedLoansForTool, clashesWith, isOverdue } from "./lib/loans";
import { enqueueNotification, loanActivity } from "./lib/notify";
import { cleanOptionalMessage } from "./lib/validation";

/* ------------------------------------------------------------------ */
/* Mutations: each one checks WHO may act, then WHAT state allows it.  */
/* ------------------------------------------------------------------ */

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { toolId, startDate, endDate, message }) => {
    const viewer = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.status !== "active") fail("NOT_FOUND", "Listing not found.");
    if (tool.ownerId === viewer._id) {
      fail("FORBIDDEN", "You can't borrow your own tool.");
    }

    const today = todayUtc();
    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
      fail("INVALID_INPUT", "Please pick valid dates.");
    }
    if (startDate < today) fail("INVALID_INPUT", "The start date can't be in the past.");
    if (endDate < startDate) fail("INVALID_INPUT", "The end date must be on or after the start date.");
    if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
      fail("INVALID_INPUT", `Loans can be at most ${LIMITS.maxLoanDays} days.`);
    }
    if (startDate > addDays(today, LIMITS.maxDaysAhead)) {
      fail("INVALID_INPUT", `You can book at most ${LIMITS.maxDaysAhead} days ahead.`);
    }

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_and_status", (q) =>
        q.eq("toolId", toolId).eq("status", "requested"),
      )
      .take(100);
    if (pending.some((l) => l.borrowerId === viewer._id)) {
      fail("CONFLICT", "You already have a pending request for this tool.");
    }
    const clash = clashesWith(await approvedLoansForTool(ctx, toolId), startDate, endDate);
    if (clash) {
      fail(
        "CONFLICT",
        `It's already booked ${clash.startDate} to ${clash.endDate}. Try other dates.`,
      );
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      lenderId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      message: cleanOptionalMessage(message),
      status: "requested",
      reminderCount: 0,
    });
    await audit(ctx, viewer, "loan.requested", "loans", loanId);
    await enqueueNotification(ctx, loanId, "loan.requested", "lender");
    return loanId;
  },
});

/** Load a loan and check the caller is its lender (owner of the tool). */
async function loadAsLender(ctx: QueryCtx, loanId: Id<"loans">, viewer: Doc<"users">) {
  const loan = await ctx.db.get(loanId);
  if (!loan) fail("NOT_FOUND", "Request not found.");
  if (loan.lenderId !== viewer._id) {
    fail("FORBIDDEN", "Only the owner of this tool can do that.");
  }
  return loan;
}

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireUser(ctx);
    const loan = await loadAsLender(ctx, loanId, viewer);
    if (loan.status !== "requested") fail("CONFLICT", "This request is no longer pending.");
    const tool = await ctx.db.get(loan.toolId);
    if (!tool || tool.status !== "active") fail("CONFLICT", "This listing was removed.");
    if (loan.endDate < todayUtc()) {
      fail("CONFLICT", "These dates have already passed. Decline it instead.");
    }
    const clash = clashesWith(
      await approvedLoansForTool(ctx, loan.toolId),
      loan.startDate,
      loan.endDate,
    );
    if (clash) {
      fail(
        "CONFLICT",
        `You've already approved a loan for ${clash.startDate} to ${clash.endDate}, which overlaps these dates.`,
      );
    }
    await ctx.db.patch(loanId, { status: "approved", decidedAt: Date.now() });
    await audit(ctx, viewer, "loan.approved", "loans", loanId);
    await enqueueNotification(ctx, loanId, "loan.approved", "borrower");
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireUser(ctx);
    const loan = await loadAsLender(ctx, loanId, viewer);
    if (loan.status !== "requested") fail("CONFLICT", "This request is no longer pending.");
    await ctx.db.patch(loanId, { status: "declined", decidedAt: Date.now() });
    await audit(ctx, viewer, "loan.declined", "loans", loanId);
    await enqueueNotification(ctx, loanId, "loan.declined", "borrower");
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireUser(ctx);
    const loan = await loadAsLender(ctx, loanId, viewer);
    if (loan.status !== "approved") fail("CONFLICT", "Only active loans can be marked as returned.");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await audit(ctx, viewer, "loan.returned", "loans", loanId);
    await enqueueNotification(ctx, loanId, "loan.returned", "borrower");
  },
});

/** The borrower withdraws their own pending request. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) fail("NOT_FOUND", "Request not found.");
    if (loan.borrowerId !== viewer._id) {
      fail("FORBIDDEN", "You can only cancel your own requests.");
    }
    if (loan.status !== "requested") fail("CONFLICT", "This request is no longer pending.");
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await audit(ctx, viewer, "loan.cancelled", "loans", loanId);
    await enqueueNotification(ctx, loanId, "loan.cancelled", "lender");
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

async function describe(ctx: QueryCtx, loan: Doc<"loans">, today: string) {
  const [tool, lender, borrower, activity] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.lenderId),
    ctx.db.get(loan.borrowerId),
    loanActivity(ctx, loan._id),
  ]);
  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    toolId: loan.toolId,
    toolName: tool?.name ?? "Removed tool",
    toolCategory: tool?.category ?? "other",
    toolRemoved: tool?.status !== "active",
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: isOverdue(loan, today),
    daysOverdue: isOverdue(loan, today) ? daysBetween(loan.endDate, today) : 0,
    reminderCount: loan.reminderCount,
    lender: { firstName: firstName(lender?.name ?? ""), trustedLender: lender?.trustedLender ?? false },
    borrower: { firstName: firstName(borrower?.name ?? "") },
    activity,
  };
}

/** "My requests": loans where the caller is the borrower. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(LIMITS.listPageSize);
    const today = todayUtc();
    return await Promise.all(loans.map((l) => describe(ctx, l, today)));
  },
});

/**
 * "Incoming requests": loans on the caller's tools. The lender also sees
 * the borrower's optional message, because it is addressed to them.
 */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", viewer._id))
      .order("desc")
      .take(LIMITS.listPageSize);
    const today = todayUtc();
    return await Promise.all(
      loans.map(async (l) => ({ ...(await describe(ctx, l, today)), message: l.message })),
    );
  },
});

/** Admin: every loan, newest first, with full names for moderation. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(LIMITS.listPageSize);
    const today = todayUtc();
    return await Promise.all(
      loans.map(async (l) => {
        const [base, lender, borrower] = await Promise.all([
          describe(ctx, l, today),
          ctx.db.get(l.lenderId),
          ctx.db.get(l.borrowerId),
        ]);
        return { ...base, lenderName: lender?.name ?? "Unknown", borrowerName: borrower?.name ?? "Unknown" };
      }),
    );
  },
});

/** Small count for the nav badge, so the shell doesn't load whole lists. */
export const pendingIncomingCount = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", viewer._id))
      .order("desc")
      .take(LIMITS.listPageSize);
    return loans.filter((l) => l.status === "requested").length;
  },
});
