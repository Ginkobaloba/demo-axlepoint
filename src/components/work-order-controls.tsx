"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { WO_STATUS_LABELS, type WorkOrderStatus } from "@/lib/types";
import { WORK_ORDER_STATUSES } from "@/lib/wo-actions";

interface TechOption {
  id: string;
  name: string;
  role: string;
  open_orders: number;
}

/**
 * Editable controls for a single work order: move status, assign a
 * technician, and set the due date. Each change PATCHes the order and
 * refreshes the server-rendered detail, so the page always reflects truth.
 * This is what turns the "Recommend Preventive Action" draft into a closed
 * loop -- the drafted order is now actionable, not a dead end.
 */
export function WorkOrderControls({
  workOrderId,
  status,
  assignedTo,
  dueDate,
  technicians,
}: {
  workOrderId: string;
  status: WorkOrderStatus;
  assignedTo: string | null;
  dueDate: string | null; // YYYY-MM-DD or null
  technicians: TechOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = async (field: string, body: Record<string, unknown>) => {
    setBusy(field);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Update failed (${res.status})`);
      }
      setSaved(field);
      setTimeout(() => setSaved((s) => (s === field ? null : s)), 1800);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy((b) => (b === field ? null : b));
    }
  };

  const flag = (field: string) =>
    saved === field ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-risk-low">
        <Check className="h-3 w-3" />
        Saved
      </span>
    ) : busy === field ? (
      <span className="text-xs text-ink-faint">Saving...</span>
    ) : null;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="wo-status">
            Status
          </label>
          {flag("status")}
        </div>
        <select
          id="wo-status"
          className="input cursor-pointer"
          value={status}
          disabled={busy === "status"}
          onChange={(e) =>
            patch("status", { action: "status", status: e.target.value })
          }
        >
          {WORK_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {WO_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="wo-assignee">
            Assigned to
          </label>
          {flag("assign")}
        </div>
        <select
          id="wo-assignee"
          className="input cursor-pointer"
          value={assignedTo ?? ""}
          disabled={busy === "assign"}
          onChange={(e) =>
            patch("assign", {
              action: "assign",
              assigned_to: e.target.value || null,
            })
          }
        >
          <option value="">Unassigned</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} - {t.role} ({t.open_orders} open)
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="wo-due">
            Due date
          </label>
          {flag("due")}
        </div>
        <div className="flex items-center gap-2">
          <input
            id="wo-due"
            type="date"
            className="input"
            defaultValue={dueDate ?? ""}
            disabled={busy === "due"}
            onChange={(e) =>
              patch("due", { action: "due", due_date: e.target.value || null })
            }
          />
          {dueDate && (
            <button
              type="button"
              className="btn-secondary shrink-0 px-3 py-2"
              disabled={busy === "due"}
              onClick={() => patch("due", { action: "due", due_date: null })}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-risk-high/30 bg-risk-high/10 px-3 py-2 text-xs font-medium text-risk-high">
          {error}
        </p>
      )}
    </div>
  );
}
