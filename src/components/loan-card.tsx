import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { categoryLabel } from "@convex/lib/constants";
import { formatRange, timeAgo } from "@/lib/format";
import { CategoryTile } from "./category-icon";
import { type Activity, ActivityList, LoanStatusBadge } from "./status";
import { Card } from "./ui";

export type LoanView = {
  _id: string;
  _creationTime: number;
  toolName: string;
  toolCategory: string;
  toolRemoved: boolean;
  startDate: string;
  endDate: string;
  status: "requested" | "approved" | "declined" | "cancelled" | "returned";
  overdue: boolean;
  daysOverdue: number;
  lender: { firstName: string; trustedLender: boolean };
  borrower: { firstName: string };
  activity: Activity[];
  message?: string;
};

export function LoanCard({
  loan,
  viewer,
  actions,
}: {
  loan: LoanView;
  viewer: "lender" | "borrower";
  actions?: ReactNode;
}) {
  const other =
    viewer === "lender" ? (
      <>from <span className="text-ink">{loan.borrower.firstName}</span></>
    ) : (
      <>
        lent by <span className="text-ink">{loan.lender.firstName}</span>
        {loan.lender.trustedLender && <ShieldCheck className="ml-1 inline size-3.5 text-brand" aria-label="Trusted Lender" />}
      </>
    );

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <CategoryTile category={loan.toolCategory} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{loan.toolName}</h3>
            <LoanStatusBadge status={loan.status} overdue={loan.overdue} startDate={loan.startDate} />
            {loan.toolRemoved && loan.status !== "cancelled" && (
              <span className="text-xs text-muted">(listing removed)</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {formatRange(loan.startDate, loan.endDate)} · {categoryLabel(loan.toolCategory)} · {other}
          </p>
          {loan.overdue && (
            <p className="mt-1 text-sm text-danger">
              {loan.daysOverdue} {loan.daysOverdue === 1 ? "day" : "days"} late
            </p>
          )}
          {loan.message && (
            <blockquote className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink/85">
              &ldquo;{loan.message}&rdquo;
            </blockquote>
          )}
          <p className="mt-2 text-xs text-muted">Requested {timeAgo(loan._creationTime)}</p>
        </div>
        {actions && <div className="flex w-full gap-2 sm:w-auto sm:justify-end">{actions}</div>}
      </div>
      <ActivityList items={loan.activity} viewer={viewer} />
    </Card>
  );
}

export function LoanSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium tracking-wide text-muted uppercase">
        {title} <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{count}</span>
      </h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}
