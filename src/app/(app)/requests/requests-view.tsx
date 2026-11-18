"use client";

import { useMutation, useQuery } from "convex/react";
import { Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LoanCard, LoanSection } from "@/components/loan-card";
import { Button, buttonClass, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { errorMessage } from "@/lib/format";

export function RequestsView() {
  const loans = useQuery(api.loans.myRequests);
  const cancel = useMutation(api.loans.cancel);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onCancel(loanId: Id<"loans">) {
    setBusyId(loanId);
    try {
      await cancel({ loanId });
      toast.success("Request cancelled");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const active = (loans ?? []).filter((l) => l.status === "approved");
  const pending = (loans ?? []).filter((l) => l.status === "requested");
  const past = (loans ?? []).filter((l) => !["approved", "requested"].includes(l.status));

  return (
    <div className="max-w-3xl">
      <PageHeader title="My requests" description="Things you've asked to borrow." />
      {loans === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : loans.length === 0 ? (
        <EmptyState
          icon={<Send className="size-5" />}
          title="No requests yet"
          action={
            <Link href="/browse" className={buttonClass()}>
              Browse tools
            </Link>
          }
        >
          Find something you need and pick your dates.
        </EmptyState>
      ) : (
        <>
          <LoanSection title="Borrowing" count={active.length}>
            {active.map((l) => (
              <li key={l._id} className="animate-rise">
                <LoanCard loan={l} viewer="borrower" />
              </li>
            ))}
          </LoanSection>
          <LoanSection title="Waiting for an answer" count={pending.length}>
            {pending.map((l) => (
              <li key={l._id} className="animate-rise">
                <LoanCard
                  loan={l}
                  viewer="borrower"
                  actions={
                    <Button size="sm" variant="secondary" loading={busyId === l._id} onClick={() => onCancel(l._id)}>
                      Cancel request
                    </Button>
                  }
                />
              </li>
            ))}
          </LoanSection>
          <LoanSection title="History" count={past.length}>
            {past.map((l) => (
              <li key={l._id}>
                <LoanCard loan={l} viewer="borrower" />
              </li>
            ))}
          </LoanSection>
        </>
      )}
    </div>
  );
}
