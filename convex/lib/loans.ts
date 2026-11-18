import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { rangesOverlap, todayUtc } from "./dates";
import { enqueueNotification } from "./notify";

type Ctx = QueryCtx | MutationCtx;

/** Approved, not-yet-returned loans for a tool (current and future). */
export async function approvedLoansForTool(
  ctx: Ctx,
  toolId: Id<"tools">,
): Promise<Doc<"loans">[]> {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_and_status", (q) =>
      q.eq("toolId", toolId).eq("status", "approved"),
    )
    .take(100);
}

export type Availability =
  | { state: "available"; nextBooking?: { startDate: string; endDate: string } }
  | { state: "on_loan"; until: string; overdue: boolean };

export function availabilityFrom(
  approved: Doc<"loans">[],
  today: string = todayUtc(),
): Availability {
  const current = approved.find((l) => l.startDate <= today);
  if (current) {
    return {
      state: "on_loan",
      until: current.endDate,
      overdue: current.endDate < today,
    };
  }
  const next = approved
    .filter((l) => l.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return next
    ? { state: "available", nextBooking: { startDate: next.startDate, endDate: next.endDate } }
    : { state: "available" };
}

/** Does [start, end] clash with an approved loan (other than `exceptId`)? */
export function clashesWith(
  approved: Doc<"loans">[],
  startDate: string,
  endDate: string,
): Doc<"loans"> | undefined {
  return approved.find((l) => rangesOverlap(l.startDate, l.endDate, startDate, endDate));
}

export function isOverdue(loan: Doc<"loans">, today: string = todayUtc()): boolean {
  return loan.status === "approved" && loan.endDate < today;
}

/**
 * When a listing is removed: cancel open requests and approved loans that
 * have not started, and tell the borrowers. Returns the count of loans
 * that are currently out (those stay as they are; the item is physically
 * with the borrower and still has to come back).
 */
export async function cancelOpenLoansForTool(
  ctx: MutationCtx,
  toolId: Id<"tools">,
): Promise<{ cancelled: number; currentlyOut: number }> {
  const today = todayUtc();
  const requested = await ctx.db
    .query("loans")
    .withIndex("by_tool_and_status", (q) =>
      q.eq("toolId", toolId).eq("status", "requested"),
    )
    .take(200);
  const approved = await approvedLoansForTool(ctx, toolId);
  const future = approved.filter((l) => l.startDate > today);
  const currentlyOut = approved.length - future.length;

  const now = Date.now();
  for (const loan of [...requested, ...future]) {
    await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: now });
    await enqueueNotification(ctx, loan._id, "loan.cancelled", "borrower");
  }
  return { cancelled: requested.length + future.length, currentlyOut };
}

