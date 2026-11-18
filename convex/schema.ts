import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const categoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("hand_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("ladders"),
  v.literal("other"),
);

export const conditionValidator = v.union(
  v.literal("new"),
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("well_used"),
);

export const loanStatusValidator = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const roleValidator = v.union(v.literal("user"), v.literal("admin"));

/** Which party a notification is addressed to. */
export const recipientValidator = v.union(
  v.literal("lender"),
  v.literal("borrower"),
);

export const notificationTypeValidator = v.union(
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.cancelled"),
  v.literal("loan.returned"),
);

export default defineSchema({
  /**
   * One row per Clerk user. Created on first sign-in by `users.store`.
   * The role lives here (not in Clerk) so that Convex is the single
   * source of truth for authorization.
   */
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    role: roleValidator,
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  /**
   * Listings. Never hard-deleted: removal is a soft delete so that the
   * loan history and audit trail stay intact.
   */
  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    status: v.union(v.literal("active"), v.literal("removed")),
    updatedAt: v.number(),
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
    removedReason: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_status_and_category", ["status", "category"])
    .index("by_owner_and_status", ["ownerId", "status"]),

  /**
   * A borrow request and, once approved, the loan itself.
   * Dates are calendar dates ("YYYY-MM-DD"), compared in UTC.
   */
  loans: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    /** Calendar date of the last overdue reminder that was sent. */
    lastReminderOn: v.optional(v.string()),
    reminderCount: v.number(),
  })
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_tool_and_status", ["toolId", "status"])
    .index("by_status_and_endDate", ["status", "endDate"]),

  /**
   * Everything the automation layer did, in one place:
   *  - `notification`: outbox rows for Convex -> n8n webhooks
   *  - `reminder`: write-backs from the n8n overdue workflow
   *  - `workflow_error`: failures reported by the n8n error workflow
   * `key` is unique and makes every write idempotent.
   */
  automationEvents: defineTable({
    key: v.string(),
    kind: v.union(
      v.literal("notification"),
      v.literal("reminder"),
      v.literal("workflow_error"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    loanId: v.optional(v.id("loans")),
    notificationType: v.optional(notificationTypeValidator),
    recipient: v.optional(recipientValidator),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    detail: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_loan", ["loanId"])
    .index("by_kind_and_status", ["kind", "status"]),

  /** Append-only record of who changed what. Read by admins only. */
  auditLog: defineTable({
    actorId: v.optional(v.id("users")),
    actor: v.string(),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    detail: v.optional(v.string()),
  }),
});
