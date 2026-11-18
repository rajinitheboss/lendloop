"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Inbox, Undo2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LoanCard, LoanSection } from "@/components/loan-card";
import { Button, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { errorMessage } from "@/lib/format";

type Action = "approve" | "decline" | "return";

export function IncomingView() {
  const loans = useQuery(api.loans.incoming);
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);
  const [busy, setBusy] = useState<{ id: string; action: Action } | null>(null);

  async function run(loanId: Id<"loans">, action: Action, borrower: string) {
    setBusy({ id: loanId, action });
    try {
      if (action === "approve") await approve({ loanId });
      if (action === "decline") await decline({ loanId });
      if (action === "return") await markReturned({ loanId });
      toast.success(
        action === "approve"
          ? `Approved. ${borrower} will get an email.`
          : action === "decline"
            ? `Declined. ${borrower} will be told.`
            : "Marked as returned. Thanks for lending!",
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  const isBusy = (id: string, action: Action) => busy?.id === id && busy.action === action;

  const pending = (loans ?? []).filter((l) => l.status === "requested");
  const out = (loans ?? [])
    .filter((l) => l.status === "approved")
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.endDate.localeCompare(b.endDate));
  const past = (loans ?? []).filter((l) => !["approved", "requested"].includes(l.status));

  return (
    <div className="max-w-3xl">
      <PageHeader title="Incoming requests" description="Neighbours asking to borrow your tools." />
      {loans === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : loans.length === 0 ? (
        <EmptyState icon={<Inbox className="size-5" />} title="No requests yet">
          When someone asks to borrow one of your tools, it shows up here and you get an email.
        </EmptyState>
      ) : (
        <>
          <LoanSection title="Needs your answer" count={pending.length}>
            {pending.map((l) => (
              <li key={l._id} className="animate-rise">
                <LoanCard
                  loan={l}
                  viewer="lender"
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        loading={isBusy(l._id, "decline")}
                        onClick={() => run(l._id, "decline", l.borrower.firstName)}
                      >
                        <X className="size-3.5" /> Decline
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        loading={isBusy(l._id, "approve")}
                        onClick={() => run(l._id, "approve", l.borrower.firstName)}
                      >
                        <Check className="size-3.5" /> Approve
                      </Button>
                    </>
                  }
                />
              </li>
            ))}
          </LoanSection>
          <LoanSection title="Lent out" count={out.length}>
            {out.map((l) => (
              <li key={l._id} className="animate-rise">
                <LoanCard
                  loan={l}
                  viewer="lender"
                  actions={
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      loading={isBusy(l._id, "return")}
                      onClick={() => run(l._id, "return", l.borrower.firstName)}
                    >
                      <Undo2 className="size-3.5" /> Mark returned
                    </Button>
                  }
                />
              </li>
            ))}
          </LoanSection>
          <LoanSection title="History" count={past.length}>
            {past.map((l) => (
              <li key={l._id}>
                <LoanCard loan={l} viewer="lender" />
              </li>
            ))}
          </LoanSection>
        </>
      )}
    </div>
  );
}
