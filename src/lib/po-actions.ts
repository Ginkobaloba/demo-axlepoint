/**
 * Pure helpers for purchase orders: status-transition rules and the
 * reorder-quantity recommendation. DB writes live in queries.ts; these are
 * here so the business rules are unit-tested without a database.
 */
import type { Part, PurchaseOrderStatus } from "./types";

export const PO_STATUSES: PurchaseOrderStatus[] = [
  "draft",
  "ordered",
  "received",
  "cancelled",
];

// Allowed forward transitions. Received and cancelled are terminal.
const TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ["ordered", "cancelled"],
  ordered: ["received", "cancelled"],
  received: [],
  cancelled: [],
};

export function canTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(
  from: PurchaseOrderStatus,
): PurchaseOrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

/**
 * Recommended reorder quantity for a part: bring stock up to twice the
 * reorder point (a simple, defensible reorder-to-target rule), never less
 * than 1. For a part already at/above target this still proposes at least 1
 * so a manual reorder is possible.
 */
export function recommendedReorderQty(
  part: Pick<Part, "qty_on_hand" | "reorder_point">,
): number {
  const target = part.reorder_point * 2;
  return Math.max(1, target - part.qty_on_hand);
}

export type PoPatchResult =
  | { ok: true; status: PurchaseOrderStatus }
  | { ok: false; error: string };

export function parsePoStatusPatch(
  raw: unknown,
  current: PurchaseOrderStatus,
): PoPatchResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Expected a JSON body." };
  }
  const body = raw as Record<string, unknown>;
  const status = String(body.status ?? "");
  if (!PO_STATUSES.includes(status as PurchaseOrderStatus)) {
    return { ok: false, error: `Unknown status "${status}".` };
  }
  const next = status as PurchaseOrderStatus;
  if (next === current) {
    return { ok: false, error: "Status is already set." };
  }
  if (!canTransition(current, next)) {
    return {
      ok: false,
      error: `Cannot move a ${current} purchase order to ${next}.`,
    };
  }
  return { ok: true, status: next };
}
