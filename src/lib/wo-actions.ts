/**
 * Pure helpers for mutating a work order. The actual SQLite writes live in
 * queries.ts; this module holds the validation and the status/completion
 * rules so they can be unit-tested without a database and reused by the
 * PATCH route.
 */
import type { WorkOrderStatus } from "./types";

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  "open",
  "in_progress",
  "awaiting_parts",
  "closed",
];

export type WorkOrderAction =
  | { kind: "assign"; assigned_to: string | null }
  | { kind: "status"; status: WorkOrderStatus }
  | { kind: "due"; due_at: number | null }
  | { kind: "add_part"; part_id: string; qty: number }
  | { kind: "remove_part"; part_id: string };

export type ParseResult =
  | { ok: true; action: WorkOrderAction }
  | { ok: false; error: string };

/**
 * Resolve the completed_at timestamp for a status change. Closing a work
 * order stamps it complete; moving it back to any open state clears the
 * completion so the record stays honest.
 */
export function completionForStatus(
  status: WorkOrderStatus,
  nowSec: number,
  current: number | null,
): number | null {
  if (status === "closed") return current ?? nowSec;
  return null;
}

function asInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Validate and normalize a PATCH body into a typed action. Returns a
 * human-readable error rather than throwing so the route can map it to 422.
 */
export function parseWorkOrderPatch(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Expected a JSON body." };
  }
  const body = raw as Record<string, unknown>;
  const action = String(body.action ?? "");

  switch (action) {
    case "assign": {
      const id =
        body.assigned_to === null || body.assigned_to === ""
          ? null
          : String(body.assigned_to);
      return { ok: true, action: { kind: "assign", assigned_to: id } };
    }
    case "status": {
      const status = String(body.status ?? "");
      if (!WORK_ORDER_STATUSES.includes(status as WorkOrderStatus)) {
        return { ok: false, error: `Unknown status "${status}".` };
      }
      return {
        ok: true,
        action: { kind: "status", status: status as WorkOrderStatus },
      };
    }
    case "due": {
      // Accept an ISO date string (YYYY-MM-DD), an epoch-seconds number, or
      // null/"" to clear the due date.
      if (body.due_date === null || body.due_date === "") {
        return { ok: true, action: { kind: "due", due_at: null } };
      }
      if (typeof body.due_date === "string") {
        const ms = new Date(`${body.due_date}T12:00:00`).getTime();
        if (Number.isNaN(ms)) {
          return { ok: false, error: "Invalid due date." };
        }
        return {
          ok: true,
          action: { kind: "due", due_at: Math.floor(ms / 1000) },
        };
      }
      const epoch = asInt(body.due_date);
      if (epoch === null) return { ok: false, error: "Invalid due date." };
      return { ok: true, action: { kind: "due", due_at: epoch } };
    }
    case "add_part": {
      const partId = String(body.part_id ?? "");
      if (!partId) return { ok: false, error: "A part is required." };
      const qty = asInt(body.qty) ?? 1;
      if (qty < 1 || qty > 999) {
        return { ok: false, error: "Quantity must be between 1 and 999." };
      }
      return { ok: true, action: { kind: "add_part", part_id: partId, qty } };
    }
    case "remove_part": {
      const partId = String(body.part_id ?? "");
      if (!partId) return { ok: false, error: "A part is required." };
      return { ok: true, action: { kind: "remove_part", part_id: partId } };
    }
    default:
      return { ok: false, error: `Unknown action "${action}".` };
  }
}
