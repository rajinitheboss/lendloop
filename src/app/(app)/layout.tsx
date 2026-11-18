import { AppShell } from "@/components/app-shell";

/**
 * Signed-in area. Signed-out visitors never get here: src/proxy.ts
 * redirects them to sign-in. AppShell also handles the signed-out state on
 * the client (e.g. a session that expires while the tab is open).
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
