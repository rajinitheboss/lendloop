import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Signed-out visitors to app pages are redirected to sign-in here, before
 * anything renders. This is a UX guard only: the real authorization is in
 * every Convex function, so skipping this layer would not expose data.
 */
const APP_PREFIXES = ["/browse", "/listings", "/requests", "/incoming", "/admin"];

function isAppPath(pathname: string): boolean {
  return APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default clerkMiddleware(async (auth, req) => {
  if (isAppPath(req.nextUrl.pathname)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
