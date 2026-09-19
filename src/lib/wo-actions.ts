/**
 * Pure helpers for mutating a work order. The actual SQLite writes live in
 * queries.ts; this module holds the validation and the status/completion
 * rules so they can be unit-tested without a database and reused by the
 * PATCH route.
 */
import type { WorkOrderStatus } from "./types";
import { isValidIsoDate } from "./schedule-view";

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
      // Accept an ISO date string (YYYY-MM-DD) or null/empty/whitespace-only
      // to clear the due date. Everything else is rejected with 422. Deep-
      // verify PR #24 warning W5: this used to check `=== ""` without
      // trimming, so a whitespace-only string fell through to the Date()
      // branch and 422'd while POST /api/work-orders trimmed first and
      // treated the same input as a clear -- inconsistent for identical
      // intent. Both now trim first. Shape and calendar validity both go
      // through isValidIsoDate (schedule-view.ts), the same helper the
      // schedule board already uses, so an overflow date like 2026-02-30
      // (which Date() silently rolls to March 2) is rejected here too, not
      // just shape-checked.
      //
      // W6: a non-string, non-null due_date (for example `true` or `[]`)
      // used to fall through to asInt()'s `Number(value)` coercion, which
      // silently accepted it as an epoch-seconds timestamp --
      // Number(true) === 1 and Number([]) === 0, both storing a 1970 date,
      // while POST rejected `true` the same shape produced (asInt is never
      // called there). There is no legitimate caller that sends a numeric
      // due_date (the only caller is the date picker, which sends a string
      // or null), so the epoch-seconds branch is removed rather than
      // hardened: anything that is not null and not a string is now a 422,
      // matching POST's stricter posture instead of asInt's permissive one.
      if (body.due_date === null) {
        return { ok: true, action: { kind: "due", due_at: null } };
      }
      if (typeof body.due_date !== "string") {
        return { ok: false, error: "Invalid due date." };
      }
      const trimmed = body.due_date.trim();
      if (trimmed === "") {
        return { ok: true, action: { kind: "due", due_at: null } };
      }
      if (!isValidIsoDate(trimmed)) {
        return { ok: false, error: "Invalid due date." };
      }
      const ms = new Date(`${trimmed}T12:00:00`).getTime();
      return {
        ok: true,
        action: { kind: "due", due_at: Math.floor(ms / 1000) },
      };
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
