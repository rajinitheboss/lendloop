import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { audit } from "./lib/audit";
import { getViewer, requireAdmin } from "./lib/auth";
import { fail } from "./lib/errors";
import { roleValidator } from "./schema";

/**
 * Create or refresh the caller's user row from their verified Clerk token.
 * Called by the client right after sign-in. New users always start as
 * role "user"; nobody can make themselves an admin from the client.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("UNAUTHENTICATED", "Please sign in to continue.");

    const name =
      identity.name?.trim() ||
      [identity.givenName, identity.familyName].filter(Boolean).join(" ") ||
      identity.nickname ||
      identity.email?.split("@")[0] ||
      "Neighbour";

    const email = identity.email?.trim().toLowerCase() || undefined;
    const existing = await getViewer(ctx);
    if (existing) {
      const changed =
        existing.name !== name ||
        existing.email !== email ||
        existing.imageUrl !== identity.pictureUrl;
      if (changed) {
        await ctx.db.patch(existing._id, {
          name,
          email,
          imageUrl: identity.pictureUrl,
        });
      }
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      imageUrl: identity.pictureUrl,
      role: "user",
      trustedLender: false,
    });
    await audit(ctx, "system", "user.created", "users", userId);
    return userId;
  },
});

/** The caller's own profile (or null when signed out / not stored yet). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getViewer(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      imageUrl: user.imageUrl,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

/** Admin: everyone, with listing counts, for the Trusted Lender screen. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(200);
    return await Promise.all(
      users.map(async (u) => {
        const tools = await ctx.db
          .query("tools")
          .withIndex("by_owner_and_status", (q) =>
            q.eq("ownerId", u._id).eq("status", "active"),
          )
          .take(100);
        return {
          _id: u._id,
          _creationTime: u._creationTime,
          name: u.name,
          email: u.email,
          role: u.role,
          trustedLender: u.trustedLender,
          activeListings: tools.length,
        };
      }),
    );
  },
});

/** Admin: grant or revoke the "Trusted Lender" badge. */
export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const admin = await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) fail("NOT_FOUND", "User not found.");
    if (target.trustedLender === trusted) return;
    await ctx.db.patch(userId, { trustedLender: trusted });
    await audit(
      ctx,
      admin,
      trusted ? "user.trusted_granted" : "user.trusted_revoked",
      "users",
      userId,
    );
  },
});

/**
 * Change a user's role. Internal: it cannot be called from the browser,
 * only by someone with deploy access, e.g.
 *   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, { email, role }) => {
    const wanted = email.trim().toLowerCase();
    const target = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", wanted))
      .first();
    if (!target) {
      throw new Error(
        `No user with email ${email}. Sign in to the app once first.`,
      );
    }
    await ctx.db.patch(target._id, { role });
    await audit(ctx, "system", `user.role_set:${role}`, "users", target._id);
    return { userId: target._id, role };
  },
});
