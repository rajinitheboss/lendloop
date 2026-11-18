"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS } from "@convex/lib/constants";
import { addDaysIso, errorMessage, formatRange, todayIso } from "@/lib/format";
import { Dialog } from "./dialog";
import { Button, Field, inputClass } from "./ui";

export function RequestDialog({
  tool,
  onClose,
}: {
  tool: { _id: Id<"tools">; name: string; ownerFirstName: string; bookedRanges: { startDate: string; endDate: string }[] } | null;
  onClose: () => void;
}) {
  const request = useMutation(api.loans.request);
  const today = todayIso();
  const [start, setStart] = useState(addDaysIso(today, 1));
  const [end, setEnd] = useState(addDaysIso(today, 3));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const maxEnd = addDaysIso(start, LIMITS.maxLoanDays - 1);
  const invalid = !start || !end || end < start || end > maxEnd || start < today;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tool) return;
    setBusy(true);
    try {
      await request({ toolId: tool._id, startDate: start, endDate: end, message: message || undefined });
      toast.success(`Request sent to ${tool.ownerFirstName}`, {
        description: `${tool.name} · ${formatRange(start, end)}`,
      });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={tool !== null}
      onClose={onClose}
      title={tool ? `Borrow ${tool.name}` : ""}
      description={tool ? `${tool.ownerFirstName} will get an email and can approve or decline.` : undefined}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="start">
            <input
              id="start"
              type="date"
              required
              min={today}
              max={addDaysIso(today, LIMITS.maxDaysAhead)}
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Until (inclusive)" htmlFor="end">
            <input
              id="end"
              type="date"
              required
              min={start}
              max={maxEnd}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        {tool && tool.bookedRanges.length > 0 && (
          <p className="rounded-xl bg-amber-soft px-3 py-2 text-xs text-amber">
            Already booked: {tool.bookedRanges.map((r) => formatRange(r.startDate, r.endDate)).join(", ")}
          </p>
        )}
        <Field label="Message (optional)" htmlFor="message" hint={`Only ${tool?.ownerFirstName ?? "the owner"} sees this. ${message.length}/${LIMITS.message.max}`}>
          <textarea
            id="message"
            rows={3}
            maxLength={LIMITS.message.max}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Hi! I'd like it for putting up shelves this weekend."
            className={inputClass}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={invalid}>
            Send request
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
