"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import { ErrorBoundary } from "./error-boundary";
import { Logo } from "./logo";
import { Badge, Button, cn, Skeleton } from "./ui";

type Me = NonNullable<FunctionReturnType<typeof api.users.me>>;

const MeContext = createContext<Me | null>(null);

/** The signed-in user's profile. Only available inside the app shell. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe must be used inside <AppShell>");
  return me;
}

const NAV = [
  { href: "/browse", label: "Browse" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <ShellFrame>
          <PageSkeleton />
        </ShellFrame>
      </AuthLoading>
      <Unauthenticated>
        <ShellFrame>
          <div className="mx-auto max-w-md py-20 text-center">
            <h1 className="font-display text-3xl">Please sign in</h1>
            <p className="mt-2 text-muted">You need an account to lend or borrow.</p>
            <SignInButton mode="modal">
              <Button className="mt-6">Sign in to lend or borrow</Button>
            </SignInButton>
          </div>
        </ShellFrame>
      </Unauthenticated>
      <Authenticated>
        <EnsureUser>{children}</EnsureUser>
      </Authenticated>
    </>
  );
}

/**
 * Creates/refreshes the caller's Convex user row once per session, then
 * renders the app. Until it has run, other queries would reject the caller.
 */
function EnsureUser({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  const [stored, setStored] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    store()
      .then(() => active && setStored(true))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [isAuthenticated, store]);

  const me = useQuery(api.users.me, stored ? {} : "skip");

  if (failed) {
    return (
      <ShellFrame>
        <p className="py-20 text-center text-danger">We couldn&apos;t set up your account. Refresh to try again.</p>
      </ShellFrame>
    );
  }
  if (!stored || !me) {
    return (
      <ShellFrame>
        <PageSkeleton />
      </ShellFrame>
    );
  }
  return (
    <MeContext.Provider value={me}>
      <ShellFrame me={me}>
        {/* Keyed by path so an error on one page doesn't stick to the next. */}
        <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
      </ShellFrame>
    </MeContext.Provider>
  );
}

function ShellFrame({ me, children }: { me?: Me; children: ReactNode }) {
  const pathname = usePathname();
  const pending = useQuery(api.loans.pendingIncomingCount, me ? {} : "skip");
  const links = me?.role === "admin" ? [...NAV, { href: "/admin", label: "Admin" } as const] : NAV;

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo href="/browse" />
          {me && (
            <nav className="-mb-px hidden h-full items-stretch gap-1 md:flex" aria-label="Main">
              {links.map((l) => (
                <NavLink key={l.href} href={l.href} active={pathname.startsWith(l.href)} count={l.href === "/incoming" ? pending : undefined}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            {me?.trustedLender && (
              <Badge tone="brand" className="hidden sm:inline-flex">
                <ShieldCheck className="size-3" /> Trusted Lender
              </Badge>
            )}
            {me?.role === "admin" && <Badge tone="info" className="hidden sm:inline-flex">Admin</Badge>}
            <UserButton />
          </div>
        </div>
        {me && (
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden" aria-label="Main">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-sm",
                  pathname.startsWith(l.href) ? "bg-ink text-bg" : "text-muted",
                )}
              >
                {l.label}
                {l.href === "/incoming" && pending ? ` (${pending})` : ""}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
        active ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
      {!!count && (
        <span className="grid min-w-5 place-items-center rounded-full bg-amber px-1.5 text-[11px] font-semibold text-white">
          {count}
        </span>
      )}
    </Link>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    </div>
  );
}
