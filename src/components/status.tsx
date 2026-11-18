import { CircleAlert, MailCheck, MailX, Send, BellRing, Clock } from "lucide-react";
import { formatDate, timeAgo } from "@/lib/format";
import { Badge } from "./ui";

type LoanStatus = "requested" | "approved" | "declined" | "cancelled" | "returned";

export function LoanStatusBadge({
  status,
  overdue,
  startDate,
}: {
  status: LoanStatus;
  overdue?: boolean;
  startDate?: string;
}) {
  if (overdue) return <Badge tone="danger">Overdue</Badge>;
  switch (status) {
    case "requested":
      return <Badge tone="amber">Pending</Badge>;
    case "approved": {
      const today = new Date().toISOString().slice(0, 10);
      return startDate && startDate > today ? (
        <Badge tone="info">Approved · starts {formatDate(startDate)}</Badge>
      ) : (
        <Badge tone="brand">On loan</Badge>
      );
    }
    case "declined":
      return <Badge>Declined</Badge>;
    case "cancelled":
      return <Badge>Cancelled</Badge>;
    case "returned":
      return <Badge tone="brand">Returned</Badge>;
  }
}

export type Activity = {
  _id: string;
  kind: "notification" | "reminder" | "workflow_error";
  status: "pending" | "delivered" | "sent" | "failed" | "skipped";
  notificationType?: string;
  recipient?: "lender" | "borrower";
  attempts: number;
  at: number;
};

const NOTIFICATION_LABEL: Record<string, string> = {
  "loan.requested": "request",
  "loan.approved": "approval",
  "loan.declined": "decline",
  "loan.cancelled": "cancellation",
  "loan.returned": "return",
};

/** Human sentence for one automation event, e.g. "Reminder sent 2 days ago". */
export function describeActivity(a: Activity, viewer: "lender" | "borrower" | "admin") {
  const who =
    a.recipient === undefined
      ? ""
      : viewer === a.recipient
        ? "you"
        : a.recipient === "lender"
          ? "the lender"
          : "the borrower";
  const when = timeAgo(a.at);
  if (a.kind === "reminder") {
    return a.status === "sent"
      ? { icon: BellRing, tone: "text-brand", text: `Overdue reminder sent ${when}` }
      : { icon: CircleAlert, tone: "text-danger", text: `Reminder failed ${when} · will retry` };
  }
  const what = NOTIFICATION_LABEL[a.notificationType ?? ""] ?? "update";
  switch (a.status) {
    case "delivered":
      return { icon: MailCheck, tone: "text-brand", text: `Emailed ${who} about the ${what} ${when}` };
    case "pending":
      return a.attempts > 0
        ? { icon: Clock, tone: "text-amber", text: `Retrying ${what} email (attempt ${a.attempts + 1})` }
        : { icon: Send, tone: "text-muted", text: `Sending ${what} email…` };
    case "failed":
      return { icon: MailX, tone: "text-danger", text: `Couldn't email ${who} about the ${what} (${a.attempts} attempts)` };
    case "skipped":
      return { icon: MailX, tone: "text-muted", text: `No ${what} email sent (notifications off)` };
    default:
      return { icon: CircleAlert, tone: "text-danger", text: `Automation error ${when}` };
  }
}

export function ActivityList({
  items,
  viewer,
}: {
  items: Activity[];
  viewer: "lender" | "borrower" | "admin";
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
      {items.slice(0, 3).map((a) => {
        const d = describeActivity(a, viewer);
        const Icon = d.icon;
        return (
          <li key={a._id} className="flex items-center gap-2 text-xs text-muted">
            <Icon className={`size-3.5 shrink-0 ${d.tone}`} aria-hidden />
            <span>{d.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
