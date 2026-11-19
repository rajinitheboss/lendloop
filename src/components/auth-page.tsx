import { Suspense, type ReactNode } from "react";
import { Logo } from "./logo";
import { Skeleton } from "./ui";

/**
 * Shared frame for the sign-in and sign-up pages. Clerk's widget reads the
 * URL, so it streams in behind <Suspense> while the frame renders instantly.
 */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-10">
      <Logo />
      <p className="mt-2 mb-8 text-sm text-muted">Borrow what you need. Lend what you don&apos;t.</p>
      <Suspense fallback={<Skeleton className="h-[460px] w-full max-w-[400px]" />}>{children}</Suspense>
    </div>
  );
}
