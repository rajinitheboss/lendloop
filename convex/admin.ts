import { type QueryCtx, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { todayUtc } from "./lib/dates";

/** Human-readable name for an audit target (tool name, person, loan's tool). */
async function targetLabel(ctx: QueryCtx, table: string, id: string): Promise<string> {
  if (table === "tools") {
    const toolId = ctx.db.normalizeId("tools", id);
    const tool = toolId ? await ctx.db.get(toolId) : null;
    return tool?.name ?? "deleted tool";
  }
  if (table === "users") {
    const userId = ctx.db.normalizeId("users", id);
    const user = userId ? await ctx.db.get(userId) : null;
    return user?.name ?? "deleted user";
  }
  if (table === "loans") {
    const loanId = ctx.db.normalizeId("loans", id);
    const loan = loanId ? await ctx.db.get(loanId) : null;
    const tool = loan ? await ctx.db.get(loan.toolId) : null;
    return tool ? `loan of ${tool.name}` : "loan";
  }
  if (table === "automationEvents") return "automation event";
  return table;
}

/** Admin: latest audit entries (who changed what, and when). */
export const auditLog = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("auditLog").order("desc").take(50);
    return await Promise.all(
      rows.map(async (r) => ({
        _id: r._id,
        at: r._creationTime,
        actor: r.actor,
        action: r.action,
        target: await targetLabel(ctx, r.targetTable, r.targetId),
        detail: r.detail,
      })),
    );
  },
});

/** Admin: headline numbers for the dashboard. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loansWith = (status: "requested" | "approved") =>
      ctx.db
        .query("loans")
        .withIndex("by_status_and_endDate", (q) => q.eq("status", status))
        .take(1000);
    const today = todayUtc();
    const [tools, users, pending, outNow, overdue] = await Promise.all([
      ctx.db
        .query("tools")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .take(1000)
        .then((r) => r.length),
      ctx.db.query("users").take(1000).then((r) => r.length),
      loansWith("requested").then((r) => r.length),
      // Approved loans that have started (future bookings are not "out" yet).
      loansWith("approved").then((r) => r.filter((l) => l.startDate <= today).length),
      ctx.db
        .query("loans")
        .withIndex("by_status_and_endDate", (q) =>
          q.eq("status", "approved").lt("endDate", today),
        )
        .take(1000)
        .then((r) => r.length),
    ]);
    return { tools, users, pending, outNow, overdue };
  },
});
