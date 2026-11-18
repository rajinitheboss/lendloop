"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Inbox, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { categoryLabel, conditionLabel } from "@convex/lib/constants";
import { CategoryTile } from "@/components/category-icon";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EMPTY_TOOL, ToolFormDialog, type ToolDraft } from "@/components/tool-form-dialog";
import { Badge, Button, Card, CardGridSkeleton, EmptyState, PageHeader } from "@/components/ui";
import { errorMessage, formatDate, formatRange } from "@/lib/format";

type MyTool = FunctionReturnType<typeof api.tools.mine>[number];

export function ListingsView() {
  const tools = useQuery(api.tools.mine);
  const remove = useMutation(api.tools.remove);
  const [draft, setDraft] = useState<ToolDraft | null>(null);
  const [deleting, setDeleting] = useState<MyTool | null>(null);

  const addButton = (
    <Button onClick={() => setDraft({ ...EMPTY_TOOL })}>
      <Plus className="size-4" /> List a tool
    </Button>
  );

  return (
    <div>
      <PageHeader title="My listings" description="Tools you're sharing with the neighbourhood." action={addButton} />

      {tools === undefined ? (
        <CardGridSkeleton count={3} />
      ) : tools.length === 0 ? (
        <EmptyState icon={<Wrench className="size-5" />} title="You haven't listed anything yet" action={addButton}>
          A ladder, a pressure washer, a tent: whatever sits unused in your shed.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t, i) => (
            <li key={t._id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 9) * 35}ms` }}>
              <Card className="flex h-full flex-col p-5">
                <div className="flex items-start gap-3">
                  <CategoryTile category={t.category} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium">{t.name}</h3>
                    <p className="text-xs text-muted">
                      {categoryLabel(t.category)} · {conditionLabel(t.condition)}
                    </p>
                  </div>
                  {t.availability.state === "on_loan" ? (
                    <Badge tone={t.availability.overdue ? "danger" : "amber"}>
                      {t.availability.overdue ? "Overdue" : `Out until ${formatDate(t.availability.until)}`}
                    </Badge>
                  ) : (
                    <Badge tone="brand">Available</Badge>
                  )}
                </div>
                <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted">{t.description}</p>
                {t.availability.state === "available" && t.availability.nextBooking && (
                  <p className="mt-2 text-xs text-muted">
                    Next booking {formatRange(t.availability.nextBooking.startDate, t.availability.nextBooking.endDate)}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
                  {t.pendingRequests > 0 ? (
                    <Link href="/incoming" className="mr-auto">
                      <Badge tone="amber">
                        <Inbox className="size-3" /> {t.pendingRequests} pending
                      </Badge>
                    </Link>
                  ) : (
                    <span className="mr-auto text-xs text-muted">No pending requests</span>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setDraft({
                        _id: t._id,
                        name: t.name,
                        category: t.category,
                        condition: t.condition,
                        description: t.description,
                      })
                    }
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ToolFormDialog key={draft?._id ?? (draft ? "new" : "closed")} draft={draft} onClose={() => setDraft(null)} />

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? "listing"}?`}
        confirmLabel="Delete listing"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove({ toolId: deleting._id });
            toast.success("Listing deleted");
            setDeleting(null);
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      >
        <p>
          It disappears from the board straight away. Any pending requests are cancelled and the
          borrowers are told by email.
        </p>
      </ConfirmDialog>
    </div>
  );
}
