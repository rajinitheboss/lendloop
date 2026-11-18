import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { addDays, todayUtc } from "./lib/dates";
import type { Category, Condition } from "./lib/constants";

/**
 * Demo data for local development and reviewers. Internal, so it can only
 * be run by someone with deploy access:
 *
 *   npx convex run seed:demo
 *   npx convex run seed:demo '{"email":"you@example.com"}'
 *
 * With `email` (an account that has signed in once), you also get an
 * incoming request on one of your tools and an overdue loan you borrowed,
 * so every screen has something on it.
 *
 * Demo neighbours use @lendloop.local addresses, which Mailpit catches.
 */
export const demo = internalMutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", "demo|maya"))
      .unique();
    if (existing) return "Demo data already exists. Nothing changed.";

    const today = todayUtc();
    const person = (slug: string, name: string, trusted = false) =>
      ctx.db.insert("users", {
        tokenIdentifier: `demo|${slug}`,
        name,
        email: `${slug}@lendloop.local`,
        role: "user",
        trustedLender: trusted,
      });
    const maya = await person("maya", "Maya Chen", true);
    const omar = await person("omar", "Omar Haddad");
    const lena = await person("lena", "Lena Fischer");

    const tool = (ownerId: Id<"users">, name: string, category: Category, condition: Condition, description: string) =>
      ctx.db.insert("tools", { ownerId, name, category, condition, description, status: "active", updatedAt: Date.now() });

    const drill = await tool(maya, "Cordless drill", "power_tools", "good", "18V with two batteries and a 30-piece bit set. Charger included.");
    await tool(maya, "Pressure washer", "cleaning", "like_new", "2000 PSI electric washer with patio cleaner attachment.");
    const tent = await tool(omar, "4-person tent", "camping", "good", "Dome tent, takes ten minutes to pitch. Footprint and pegs included.");
    await tool(omar, "Hedge trimmer", "garden", "fair", "Corded, 55 cm blade. Works great, a little noisy.");
    await tool(lena, "Stand mixer", "kitchen", "like_new", "5-litre bowl with whisk, dough hook and beater.");
    await tool(lena, "Extension ladder", "ladders", "good", "Reaches about 6 m. You'll need a car to move it.");
    await tool(lena, "Socket set", "hand_tools", "well_used", "Metric and imperial, 1/4\" and 3/8\" drive. A couple of gaps.");

    const loan = (toolId: Id<"tools">, lenderId: Id<"users">, borrowerId: Id<"users">, start: number, end: number, status: "requested" | "approved" | "returned", message?: string) =>
      ctx.db.insert("loans", {
        toolId, lenderId, borrowerId, message, status,
        startDate: addDays(today, start), endDate: addDays(today, end),
        decidedAt: status === "requested" ? undefined : Date.now(),
        returnedAt: status === "returned" ? Date.now() : undefined,
        reminderCount: 0,
      });

    // Omar borrowed Maya's drill and is 2 days late: the overdue workflow picks this up.
    await loan(drill, maya, omar, -5, -2, "approved");
    // Lena has the tent this week.
    await loan(tent, omar, lena, -1, 3, "approved");

    let extra = "";
    if (email) {
      const me = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
        .unique();
      if (!me) {
        extra = ` (no user with ${email} yet: sign in once, then run seed:demo again after clearing data)`;
      } else {
        const mine = await tool(me._id, "Circular saw", "power_tools", "good", "185 mm blade, with a spare blade and a guide rail.");
        await loan(mine, me._id, lena, 2, 4, "requested", "Building a raised garden bed this weekend. Will bring it back clean!");
        const mixer = await tool(lena, "Bread maker", "kitchen", "good", "Makes a 1 kg loaf. Recipe booklet included.");
        await loan(mixer, lena, me._id, -6, -1, "approved");
        extra = ` plus a request to you and an overdue loan for you (${me.name})`;
      }
    }
    return `Seeded 3 neighbours, their listings and loans${extra}.`;
  },
});
