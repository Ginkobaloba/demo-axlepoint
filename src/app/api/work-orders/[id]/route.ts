import { NextResponse, type NextRequest } from "next/server";
import {
  addWorkOrderPart,
  assignWorkOrder,
  getPart,
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
 * attach parts. Writes land in the container SQLite and reset on the next
 * redeploy (decisions D-005), same as createWorkOrder.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
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
    case "assign":
      assignWorkOrder(wo.id, action.assigned_to);
      break;
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
