import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Append a row to the audit log. Called inside the same mutation as the
 * change itself, so the change and its audit entry commit together or
 * not at all.
 */
export async function audit(
  ctx: MutationCtx,
  actor: Doc<"users"> | "system" | "n8n",
  action: string,
  targetTable: string,
  targetId: string,
  detail?: string,
): Promise<void> {
  await ctx.db.insert("auditLog", {
    actorId: typeof actor === "string" ? undefined : actor._id,
    actor: typeof actor === "string" ? actor : actor.name,
    action,
    targetTable,
    targetId,
    detail,
  });
}
