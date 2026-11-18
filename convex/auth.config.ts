import type { AuthConfig } from "convex/server";

/**
 * Convex verifies every Clerk JWT against this issuer before any function
 * sees `ctx.auth`. Set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard
 * (or `npx convex env set`), e.g. https://your-app.clerk.accounts.dev
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
