import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { audit } from "./lib/audit";
import { firstName, requireAdmin, requireUser } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { todayUtc } from "./lib/dates";
import { fail } from "./lib/errors";
import {
  approvedLoansForTool,
  availabilityFrom,
  cancelOpenLoansForTool,
} from "./lib/loans";
import { cleanText, cleanToolFields } from "./lib/validation";
import { categoryValidator, conditionValidator } from "./schema";

/**
 * PUBLIC (no sign-in): name and category only. No owner, no description,
 * no availability: the minimum the landing page needs.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(LIMITS.listPageSize);
    return tools.map((t) => ({ _id: t._id, name: t.name, category: t.category }));
  },
});

/** Signed-in browse view: every active tool with availability. */
export const browse = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const viewer = await requireUser(ctx);
    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_status_and_category", (q) =>
            q.eq("status", "active").eq("category", category),
          )
          .order("desc")
          .take(LIMITS.listPageSize)
      : await ctx.db
          .query("tools")
          .withIndex("by_status", (q) => q.eq("status", "active"))
          .order("desc")
          .take(LIMITS.listPageSize);

    const today = todayUtc();
    return await Promise.all(
      tools.map(async (t) => {
        const [owner, approved, myOpen] = await Promise.all([
          ctx.db.get(t.ownerId),
          approvedLoansForTool(ctx, t._id),
          ctx.db
            .query("loans")
            .withIndex("by_tool_and_status", (q) =>
              q.eq("toolId", t._id).eq("status", "requested"),
            )
            .take(100)
            .then((ls) => ls.find((l) => l.borrowerId === viewer._id)),
        ]);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          isMine: t.ownerId === viewer._id,
          // Other users see the lender's first name and badge only.
          owner: {
            firstName: firstName(owner?.name ?? ""),
            trustedLender: owner?.trustedLender ?? false,
          },
          availability: availabilityFrom(approved, today),
          bookedRanges: approved
            .filter((l) => l.endDate >= today)
            .map((l) => ({ startDate: l.startDate, endDate: l.endDate }))
            .sort((a, b) => a.startDate.localeCompare(b.startDate)),
          myPendingRequestId: myOpen?._id ?? null,
        };
      }),
    );
  },
});

/** "My listings": the caller's own active tools with request counts. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner_and_status", (q) =>
        q.eq("ownerId", viewer._id).eq("status", "active"),
      )
      .order("desc")
      .take(LIMITS.listPageSize);
    const today = todayUtc();
    return await Promise.all(
      tools.map(async (t) => {
        const [approved, pending] = await Promise.all([
          approvedLoansForTool(ctx, t._id),
          ctx.db
            .query("loans")
            .withIndex("by_tool_and_status", (q) =>
              q.eq("toolId", t._id).eq("status", "requested"),
            )
            .take(100),
        ]);
        return {
          _id: t._id,
          _creationTime: t._creationTime,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          availability: availabilityFrom(approved, today),
          pendingRequests: pending.length,
        };
      }),
    );
  },
});

const toolInput = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

export const create = mutation({
  args: toolInput,
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const { name, description } = cleanToolFields(args);
    const toolId = await ctx.db.insert("tools", {
      ownerId: viewer._id,
      name,
      description,
      category: args.category,
      condition: args.condition,
      status: "active",
      updatedAt: Date.now(),
    });
    await audit(ctx, viewer, "tool.created", "tools", toolId);
    return toolId;
  },
});

/** Owner-only check shared by update and remove. */
function loadOwnTool(
  tool: Doc<"tools"> | null,
  viewerId: Doc<"users">["_id"],
): Doc<"tools"> {
  if (!tool || tool.status !== "active") fail("NOT_FOUND", "Listing not found.");
  if (tool.ownerId !== viewerId) {
    fail("FORBIDDEN", "You can only change your own listings.");
  }
  return tool;
}

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolInput },
  handler: async (ctx, { toolId, ...args }) => {
    const viewer = await requireUser(ctx);
    loadOwnTool(await ctx.db.get(toolId), viewer._id);
    const { name, description } = cleanToolFields(args);
    await ctx.db.patch(toolId, {
      name,
      description,
      category: args.category,
      condition: args.condition,
      updatedAt: Date.now(),
    });
    await audit(ctx, viewer, "tool.updated", "tools", toolId);
  },
});

/** Owner deletes their own listing (soft delete). */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireUser(ctx);
    loadOwnTool(await ctx.db.get(toolId), viewer._id);

    const today = todayUtc();
    const approved = await approvedLoansForTool(ctx, toolId);
    if (approved.some((l) => l.startDate <= today)) {
      fail(
        "CONFLICT",
        "This tool is out on loan. Mark it as returned before deleting the listing.",
      );
    }
    const { cancelled } = await cancelOpenLoansForTool(ctx, toolId);
    await ctx.db.patch(toolId, {
      status: "removed",
      removedAt: Date.now(),
      removedBy: viewer._id,
      updatedAt: Date.now(),
    });
    await audit(ctx, viewer, "tool.deleted", "tools", toolId, `cancelled ${cancelled} open request(s)`);
  },
});

/** Admin removes any listing (moderation). A reason is required. */
export const adminRemove = mutation({
  args: { toolId: v.id("tools"), reason: v.string() },
  handler: async (ctx, { toolId, reason }) => {
    const admin = await requireAdmin(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.status !== "active") fail("NOT_FOUND", "Listing not found.");
    const cleanReason = cleanText(reason, "Reason", 3, 200);

    const { cancelled, currentlyOut } = await cancelOpenLoansForTool(ctx, toolId);
    await ctx.db.patch(toolId, {
      status: "removed",
      removedAt: Date.now(),
      removedBy: admin._id,
      removedReason: cleanReason,
      updatedAt: Date.now(),
    });
    await audit(
      ctx,
      admin,
      "tool.removed_by_admin",
      "tools",
      toolId,
      `${cleanReason} (cancelled ${cancelled}, still out ${currentlyOut})`,
    );
  },
});

/** Admin: all active listings with owner, for moderation. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(LIMITS.listPageSize);
    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          _creationTime: t._creationTime,
          name: t.name,
          category: t.category,
          ownerName: owner?.name ?? "Unknown",
          ownerTrusted: owner?.trustedLender ?? false,
        };
      }),
    );
  },
});
