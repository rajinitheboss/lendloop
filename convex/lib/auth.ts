import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

type Ctx = QueryCtx | MutationCtx;

/**
 * Resolve the signed-in user's row from the verified Clerk JWT.
 * Identity comes only from `ctx.auth` (a token Convex has verified),
 * never from function arguments, so a client cannot claim to be
 * someone else.
 */
export async function getViewer(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

/** Any signed-in user. */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("UNAUTHENTICATED", "Please sign in to continue.");
  const user = await getViewer(ctx);
  if (!user) {
    // Signed in with Clerk but `users.store` has not run yet.
    fail("UNAUTHENTICATED", "Your account is still being set up. Try again.");
  }
  return user;
}

/** Admins only. */
export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    fail("FORBIDDEN", "Only admins can do this.");
  }
  return user;
}

export function isSameUser(a: Id<"users">, b: Id<"users">): boolean {
  return a === b;
}

/** First name only: the most we ever share with other users or n8n. */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "Neighbour";
}
