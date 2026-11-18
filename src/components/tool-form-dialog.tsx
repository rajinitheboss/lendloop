"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORIES, CONDITIONS, type Category, type Condition, LIMITS } from "@convex/lib/constants";
import { errorMessage } from "@/lib/format";
import { Dialog } from "./dialog";
import { Button, Field, inputClass } from "./ui";

export type ToolDraft = {
  _id?: Id<"tools">;
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

export const EMPTY_TOOL: ToolDraft = { name: "", category: "power_tools", condition: "good", description: "" };

/** Create (no _id) or edit (with _id) a listing. */
export function ToolFormDialog({ draft, onClose }: { draft: ToolDraft | null; onClose: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [form, setForm] = useState<ToolDraft>(draft ?? EMPTY_TOOL);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(draft?._id);

  const set = <K extends keyof ToolDraft>(key: K, value: ToolDraft[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const fields = {
        name: form.name,
        category: form.category,
        condition: form.condition,
        description: form.description,
      };
      if (form._id) {
        await update({ toolId: form._id, ...fields });
        toast.success("Listing updated");
      } else {
        await create(fields);
        toast.success(`${form.name.trim()} is now listed`);
      }
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const nameLen = form.name.trim().length;
  const descLen = form.description.trim().length;

  return (
    <Dialog
      open={draft !== null}
      onClose={onClose}
      title={editing ? "Edit listing" : "List a tool"}
      description={editing ? undefined : "Neighbours will see the name, category, condition and description."}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" htmlFor="name">
          <input
            id="name"
            required
            autoFocus
            minLength={LIMITS.toolName.min}
            maxLength={LIMITS.toolName.max}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Cordless drill"
            className={inputClass}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="category">
            <select
              id="category"
              value={form.category}
              onChange={(e) => set("category", e.target.value as Category)}
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Condition" htmlFor="condition">
            <select
              id="condition"
              value={form.condition}
              onChange={(e) => set("condition", e.target.value as Condition)}
              className={inputClass}
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Short description"
          htmlFor="description"
          hint={`${descLen}/${LIMITS.description.max} · at least ${LIMITS.description.min} characters`}
        >
          <textarea
            id="description"
            required
            rows={4}
            minLength={LIMITS.description.min}
            maxLength={LIMITS.description.max}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What's included, anything to know before borrowing it."
            className={inputClass}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={nameLen < LIMITS.toolName.min || descLen < LIMITS.description.min}
          >
            {editing ? "Save changes" : "List tool"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
