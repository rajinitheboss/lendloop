"use client";

import { useMutation, useQuery } from "convex/react";
import { Activity, CircleAlert, Lock, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { categoryLabel } from "@convex/lib/constants";
import { useMe } from "@/components/app-shell";
import { CategoryTile } from "@/components/category-icon";
import { Dialog } from "@/components/dialog";
import { LoanStatusBadge } from "@/components/status";
import { Badge, Button, Card, cn, EmptyState, Field, inputClass, PageHeader, Skeleton } from "@/components/ui";
import { errorMessage, formatRange, timeAgo } from "@/lib/format";

const TABS = ["Loans", "Listings", "People", "Automation", "Audit log"] as const;
type Tab = (typeof TABS)[number];

export function AdminView() {
  const me = useMe();
  if (me.role !== "admin") {
    return (
      <EmptyState icon={<Lock className="size-5" />} title="Admins only">
        This area is for LendLoop moderators.
      </EmptyState>
    );
  }
  return <AdminDashboard />;
}

function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("Loans");
  const stats = useQuery(api.admin.stats);

  return (
    <div>
      <PageHeader title="Admin" description="Moderate listings, review loans and keep an eye on automations." />
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["Active listings", stats?.tools],
            ["Members", stats?.users],
            ["Pending requests", stats?.pending],
            ["Out now", stats?.outNow],
            ["Overdue", stats?.overdue],
          ] as const
        ).map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className={cn("mt-1 font-display text-3xl", label === "Overdue" && value ? "text-danger" : "")}>
              {value ?? "–"}
            </p>
          </Card>
        ))}
      </div>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors cursor-pointer",
              tab === t ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Loans" && <LoansTab />}
      {tab === "Listings" && <ListingsTab />}
      {tab === "People" && <PeopleTab />}
      {tab === "Automation" && <AutomationTab />}
      {tab === "Audit log" && <AuditTab />}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">{children}</li>
  );
}

function LoansTab() {
  const loans = useQuery(api.loans.listForAdmin);
  if (loans === undefined) return <ListSkeleton />;
  if (loans.length === 0) return <p className="text-muted">No loans yet.</p>;
  return (
    <Card>
      <ul>
        {loans.map((l) => (
          <Row key={l._id}>
            <CategoryTile category={l.toolCategory} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{l.toolName}</p>
              <p className="text-xs text-muted">
                {l.borrowerName} borrowing from {l.lenderName} · {formatRange(l.startDate, l.endDate)}
              </p>
            </div>
            {l.reminderCount > 0 && <Badge tone="info">{l.reminderCount} reminder{l.reminderCount > 1 ? "s" : ""}</Badge>}
            <LoanStatusBadge status={l.status} overdue={l.overdue} startDate={l.startDate} />
          </Row>
        ))}
      </ul>
    </Card>
  );
}

function ListingsTab() {
  const tools = useQuery(api.tools.listForAdmin);
  const adminRemove = useMutation(api.tools.adminRemove);
  const [target, setTarget] = useState<{ _id: Id<"tools">; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (tools === undefined) return <ListSkeleton />;
  return (
    <>
      {tools.length === 0 ? (
        <p className="text-muted">No active listings.</p>
      ) : (
        <Card>
          <ul>
            {tools.map((t) => (
              <Row key={t._id}>
                <CategoryTile category={t.category} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted">
                    {categoryLabel(t.category)} · {t.ownerName}
                    {t.ownerTrusted && <ShieldCheck className="ml-1 inline size-3.5 text-brand" aria-label="Trusted Lender" />}
                    {" · "}listed {timeAgo(t._creationTime)}
                  </p>
                </div>
                <Button size="sm" variant="danger" onClick={() => { setReason(""); setTarget(t); }}>
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              </Row>
            ))}
          </ul>
        </Card>
      )}
      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={`Remove ${target?.name ?? ""}?`}
        description="Open requests are cancelled and borrowers are emailed. The reason is kept in the audit log."
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!target) return;
            setBusy(true);
            try {
              await adminRemove({ toolId: target._id, reason });
              toast.success("Listing removed");
              setTarget(null);
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Reason" htmlFor="reason">
            <input
              id="reason"
              required
              minLength={3}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Unsafe item, duplicate listing"
              className={inputClass}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={reason.trim().length < 3}>
              Remove listing
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function PeopleTab() {
  const users = useQuery(api.users.listForAdmin);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (users === undefined) return <ListSkeleton />;
  return (
    <Card>
      <ul>
        {users.map((u) => (
          <Row key={u._id}>
            <div className="grid size-9 place-items-center rounded-full bg-surface-2 text-sm font-medium">
              {u.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {u.name} {u.role === "admin" && <Badge tone="info" className="ml-1">Admin</Badge>}
              </p>
              <p className="text-xs text-muted">
                {u.email ?? "no email"} · {u.activeListings} listing{u.activeListings === 1 ? "" : "s"} · joined{" "}
                {timeAgo(u._creationTime)}
              </p>
            </div>
            {u.trustedLender && (
              <Badge tone="brand">
                <ShieldCheck className="size-3" /> Trusted Lender
              </Badge>
            )}
            <Button
              size="sm"
              variant={u.trustedLender ? "ghost" : "secondary"}
              loading={busyId === u._id}
              onClick={async () => {
                setBusyId(u._id);
                try {
                  await setTrusted({ userId: u._id, trusted: !u.trustedLender });
                  toast.success(u.trustedLender ? `Removed Trusted Lender from ${u.name}` : `${u.name} is now a Trusted Lender`);
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setBusyId(null);
                }
              }}
            >
              {u.trustedLender ? "Revoke" : (<><ShieldCheck className="size-3.5" /> Mark as Trusted Lender</>)}
            </Button>
          </Row>
        ))}
      </ul>
    </Card>
  );
}

const KIND_LABEL = { notification: "Notification", reminder: "Reminder", workflow_error: "n8n workflow" } as const;

function AutomationTab() {
  const health = useQuery(api.automation.healthForAdmin);
  if (health === undefined) return <ListSkeleton />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-medium">
          <CircleAlert className="size-4 text-danger" /> Failures
          {health.pendingCount > 0 && <Badge tone="amber">{health.pendingCount} pending delivery</Badge>}
        </h2>
        {health.failures.length === 0 ? (
          <Card className="p-6 text-sm text-muted">No failures. Every notification and reminder went through.</Card>
        ) : (
          <Card>
            <ul>
              {health.failures.map((f) => (
                <li key={f._id} className="border-b border-line px-4 py-3 last:border-b-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="danger">{KIND_LABEL[f.kind]}</Badge>
                    <span className="text-xs text-muted">
                      {timeAgo(f.at)} · {f.attempts} attempt{f.attempts === 1 ? "" : "s"}
                    </span>
                  </div>
                  {f.detail && <p className="mt-1.5 text-sm">{f.detail}</p>}
                  {f.lastError && <p className="mt-1 font-mono text-xs break-all text-danger">{f.lastError}</p>}
                  <p className="mt-1 font-mono text-[11px] break-all text-muted">{f.key}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-medium">
          <Activity className="size-4 text-brand" /> Recent activity
        </h2>
        <Card>
          <ul>
            {health.recent.length === 0 && <li className="p-6 text-sm text-muted">Nothing yet.</li>}
            {health.recent.map((e) => (
              <li key={e._id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 truncate">
                  {KIND_LABEL[e.kind]}
                  {e.notificationType && <span className="text-muted"> · {e.notificationType}</span>}
                </span>
                <Badge
                  tone={
                    e.status === "delivered" || e.status === "sent"
                      ? "brand"
                      : e.status === "failed"
                        ? "danger"
                        : e.status === "pending"
                          ? "amber"
                          : "neutral"
                  }
                >
                  {e.status}
                </Badge>
                <span className="w-24 text-right text-xs text-muted">{timeAgo(e.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}

function AuditTab() {
  const rows = useQuery(api.admin.auditLog);
  if (rows === undefined) return <ListSkeleton />;
  return (
    <Card>
      <ul className="font-mono text-xs">
        {rows.map((r) => (
          <li key={r._id} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 last:border-b-0">
            <span className="w-28 shrink-0 text-muted">{timeAgo(r.at)}</span>
            <span className="w-32 shrink-0 truncate">{r.actor}</span>
            <span className="text-brand">{r.action}</span>
            <span className="text-ink">{r.target}</span>
            {r.detail && <span className="basis-full text-muted sm:basis-auto">{r.detail}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
