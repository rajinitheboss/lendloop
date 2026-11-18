"use client";

import { Show, SignInButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { ArrowRight, CalendarDays, HandHeart, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import { CATEGORIES, categoryLabel } from "@convex/lib/constants";
import { CategoryIcon } from "@/components/category-icon";
import { Logo } from "@/components/logo";
import { Button, buttonClass, cn, Skeleton } from "@/components/ui";

export default function LandingPage() {
  const tools = useQuery(api.tools.listPublic);
  const [category, setCategory] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tools ?? []) map.set(t.category, (map.get(t.category) ?? 0) + 1);
    return map;
  }, [tools]);
  const visible = (tools ?? []).filter((t) => !category || t.category === category);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <Show when="signed-in">
          <Link href="/browse" className={buttonClass({ variant: "secondary" })}>
            Open LendLoop <ArrowRight className="size-4" />
          </Link>
        </Show>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button variant="secondary">Sign in</Button>
          </SignInButton>
        </Show>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pt-12 pb-16 sm:px-6 sm:pt-20">
          <div className="animate-rise max-w-3xl">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-brand" /> Your street&apos;s shared toolshed
            </p>
            <h1 className="font-display text-5xl leading-[1.05] tracking-tight sm:text-7xl">
              Borrow what you need.{" "}
              <span className="text-brand italic">Lend what you don&apos;t.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">
              That drill you use twice a year could help a neighbour tonight. List your tools, borrow
              theirs, and let LendLoop handle the reminders.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <Button className="h-12 px-6 text-base">
                    Sign in to lend or borrow <ArrowRight className="size-4" />
                  </Button>
                </SignInButton>
              </Show>
              <Show when="signed-in">
                <Link href="/browse" className={buttonClass({ className: "h-12 px-6 text-base" })}>
                  Browse tools <ArrowRight className="size-4" />
                </Link>
              </Show>
              <a href="#shelf" className="px-2 text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
                See what&apos;s on the shelf
              </a>
            </div>
          </div>

          <ul className="mt-16 grid gap-4 sm:grid-cols-3">
            {[
              { icon: HandHeart, title: "List in a minute", text: "Name, category, condition, a line about it. Done." },
              { icon: CalendarDays, title: "Request dates", text: "Pick the days you need it. The owner approves or declines." },
              { icon: ShieldCheck, title: "Reminders built in", text: "Everyone gets emailed updates, and late returns get a polite nudge." },
            ].map((f, i) => (
              <li
                key={f.title}
                className="animate-rise rounded-2xl border border-line bg-surface p-5 shadow-card"
                style={{ animationDelay: `${120 + i * 80}ms` }}
              >
                <f.icon className="mb-3 size-5 text-brand" aria-hidden />
                <h2 className="font-medium">{f.title}</h2>
                <p className="mt-1 text-sm text-muted">{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="shelf" className="border-t border-line bg-surface-2/50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-3xl tracking-tight">On the shelf</h2>
                <p className="mt-1 text-sm text-muted">
                  {tools === undefined
                    ? "Loading…"
                    : `${tools.length} ${tools.length === 1 ? "tool" : "tools"} listed by neighbours`}
                </p>
              </div>
            </div>

            <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
              <Chip active={category === null} onClick={() => setCategory(null)}>
                All
              </Chip>
              {CATEGORIES.filter((c) => counts.has(c.value)).map((c) => (
                <Chip key={c.value} active={category === c.value} onClick={() => setCategory(c.value)}>
                  <CategoryIcon category={c.value} className="size-3.5" /> {c.label}
                  <span className="text-muted">{counts.get(c.value)}</span>
                </Chip>
              ))}
            </div>

            {tools === undefined ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : tools.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line p-10 text-center text-muted">
                Nothing listed yet. Be the first to share a tool.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {visible.map((t, i) => (
                  <li
                    key={t._id}
                    className="animate-rise flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                  >
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                      <CategoryIcon category={t.category} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.name}</p>
                      <p className="text-xs text-muted">{categoryLabel(t.category)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted sm:px-6">
          <span>© LendLoop, a neighbourhood tool library</span>
          <span>Owners stay private until you sign in.</span>
        </div>
      </footer>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors cursor-pointer",
        active
          ? "border-brand bg-brand text-brand-ink [&_span]:text-brand-ink/75"
          : "border-line bg-surface hover:border-ink/25",
      )}
    >
      {children}
    </button>
  );
}
