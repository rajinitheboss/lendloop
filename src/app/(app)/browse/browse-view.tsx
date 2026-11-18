"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CalendarClock, Check, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { CATEGORIES, type Category, categoryLabel, conditionLabel } from "@convex/lib/constants";
import { CategoryIcon, CategoryTile } from "@/components/category-icon";
import { RequestDialog } from "@/components/request-dialog";
import { Badge, Button, buttonClass, Card, CardGridSkeleton, cn, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatRange } from "@/lib/format";

type BrowseTool = FunctionReturnType<typeof api.tools.browse>[number];

export function BrowseView() {
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const tools = useQuery(api.tools.browse, { category });
  const [selected, setSelected] = useState<BrowseTool | null>(null);

  const visible = (tools ?? []).filter((t) => !onlyAvailable || t.availability.state === "available");

  return (
    <div>
      <PageHeader title="Browse tools" description="Everything your neighbours are happy to lend." />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div
          className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>button]:shrink-0"
          role="group"
          aria-label="Filter by category"
        >
          <FilterChip active={!category} onClick={() => setCategory(undefined)}>
            All
          </FilterChip>
          {CATEGORIES.map((c) => (
            <FilterChip key={c.value} active={category === c.value} onClick={() => setCategory(c.value)}>
              <CategoryIcon category={c.value} className="size-3.5" />
              {c.label}
            </FilterChip>
          ))}
        </div>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
            className="size-4 accent-[var(--brand)]"
          />
          Available now only
        </label>
      </div>

      {tools === undefined ? (
        <CardGridSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Search className="size-5" />}
          title={category ? `No ${categoryLabel(category).toLowerCase()} yet` : "Nothing here yet"}
          action={
            <Link href="/listings" className={buttonClass({ variant: "secondary" })}>
              List one of yours
            </Link>
          }
        >
          Try another category, or be the first to share something.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((t, i) => (
            <li key={t._id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 9) * 35}ms` }}>
              <ToolCard tool={t} onRequest={() => setSelected(t)} />
            </li>
          ))}
        </ul>
      )}

      <RequestDialog
        key={selected?._id ?? "none"}
        tool={
          selected && {
            _id: selected._id,
            name: selected.name,
            ownerFirstName: selected.owner.firstName,
            bookedRanges: selected.bookedRanges,
          }
        }
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function ToolCard({ tool, onRequest }: { tool: BrowseTool; onRequest: () => void }) {
  const a = tool.availability;
  return (
    <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-lg">
      <div className="flex items-start gap-3">
        <CategoryTile category={tool.category} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">{tool.name}</h3>
          <p className="text-xs text-muted">
            {categoryLabel(tool.category)} · {conditionLabel(tool.condition)}
          </p>
        </div>
        {a.state === "available" ? (
          <Badge tone="brand">Available</Badge>
        ) : a.overdue ? (
          <Badge tone="danger">Overdue</Badge>
        ) : (
          <Badge tone="amber">Back {formatDate(a.until)}</Badge>
        )}
      </div>

      <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted">{tool.description}</p>

      {a.state === "available" && a.nextBooking && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
          <CalendarClock className="size-3.5" /> Booked {formatRange(a.nextBooking.startDate, a.nextBooking.endDate)}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate">{tool.isMine ? "You" : tool.owner.firstName}</span>
          {tool.owner.trustedLender && (
            <span className="inline-flex items-center text-brand" title="Trusted Lender">
              <ShieldCheck className="size-4" aria-label="Trusted Lender" />
            </span>
          )}
        </span>
        {tool.isMine ? (
          <Badge>Your listing</Badge>
        ) : tool.myPendingRequestId ? (
          <Link href="/requests">
            <Badge tone="amber">
              <Check className="size-3" /> Requested
            </Badge>
          </Link>
        ) : (
          <Button size="sm" onClick={onRequest}>
            Request to borrow
          </Button>
        )}
      </div>
    </Card>
  );
}

function FilterChip({
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
        active ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink hover:border-ink/30",
      )}
    >
      {children}
    </button>
  );
}
