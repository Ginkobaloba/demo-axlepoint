import { NextResponse, type NextRequest } from "next/server";
import {
  addWorkOrderPart,
  assignWorkOrder,
  getPart,
  getTechnician,
  getWorkOrder,
  removeWorkOrderPart,
  setWorkOrderDueDate,
  setWorkOrderStatus,
} from "@/lib/queries";
import { parseWorkOrderPatch } from "@/lib/wo-actions";

/**
 * Mutates a single work order. Drives the closed-loop demo workflow:
 * after "Recommend Preventive Action" drafts an order, the detail page
 * PATCHes here to assign a technician, set a due date, move status, and
 * attach parts. Status, due date, and part id/qty are structured with no
 * free-text path. assigned_to is a TEXT column with no FK: D-012 first
 * described it as "a foreign key picklist" and this route trusted it
 * without a lookup, which deep-verify (PR #24, blocker B1) found let
 * arbitrary text reach a fresh visitor's page source -- the same leak
 * class this PR exists to close. Fixed below by checking getTechnician()
 * before the write, same as add_part already checks getPart(). Writes
 * land in the shared SQLite database and reset on the next scheduled seed
 * reset or redeploy (decisions D-005, D-012), same as createWorkOrder.
 */
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const wo = getWorkOrder(params.id);
  if (!wo) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const parsed = parseWorkOrderPatch(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  const action = parsed.action;
  switch (action.kind) {
    case "assign": {
      if (action.assigned_to !== null && !getTechnician(action.assigned_to)) {
        return NextResponse.json({ error: "Unknown technician." }, { status: 422 });
      }
      assignWorkOrder(wo.id, action.assigned_to);
      break;
    }
    case "status":
      setWorkOrderStatus(wo.id, action.status);
      break;
    case "due":
      setWorkOrderDueDate(wo.id, action.due_at);
      break;
    case "add_part": {
      if (!getPart(action.part_id)) {
        return NextResponse.json({ error: "Unknown part." }, { status: 422 });
      }
      addWorkOrderPart(wo.id, action.part_id, action.qty);
      break;
    }
    case "remove_part":
      removeWorkOrderPart(wo.id, action.part_id);
      break;
  }

  return NextResponse.json({ id: wo.id, ok: true });
}
