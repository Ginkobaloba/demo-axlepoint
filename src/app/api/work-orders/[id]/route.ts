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
import { withCurrentTenant } from "@/lib/tenant";

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
  const wo = await withCurrentTenant((db) => getWorkOrder(db, params.id));
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

  // The whole switch runs in ONE transaction, opened only after the body has
  // been parsed and validated. That is a real improvement on the SQLite
  // version, not just a syntax change: "check the technician exists, then
  // assign it" and "check the part exists, then attach it" were two separate
  // statements with a gap between them, so a concurrent delete between the
  // check and the write would store a reference to something gone. Inside one
  // transaction the check and the write see the same snapshot.
  const failure = await withCurrentTenant(async (db) => {
    switch (action.kind) {
      case "assign": {
        if (
          action.assigned_to !== null &&
          !(await getTechnician(db, action.assigned_to))
        ) {
          return "Unknown technician.";
        }
        await assignWorkOrder(db, wo.id, action.assigned_to);
        return null;
      }
      case "status":
        await setWorkOrderStatus(db, wo.id, action.status);
        return null;
      case "due":
        await setWorkOrderDueDate(db, wo.id, action.due_at);
        return null;
      case "add_part": {
        if (!(await getPart(db, action.part_id))) {
          return "Unknown part.";
        }
        await addWorkOrderPart(db, wo.id, action.part_id, action.qty);
        return null;
      }
      case "remove_part":
        await removeWorkOrderPart(db, wo.id, action.part_id);
        return null;
    }
  });

  if (failure) {
    return NextResponse.json({ error: failure }, { status: 422 });
  }
  return NextResponse.json({ id: wo.id, ok: true });
}
