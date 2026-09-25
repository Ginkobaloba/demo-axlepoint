import { NextResponse, type NextRequest } from "next/server";
import { getMaintenanceTask, rescheduleTask } from "@/lib/queries";
import { isValidIsoDate } from "@/lib/schedule-view";
import { withCurrentTenant } from "@/lib/tenant";

/**
 * Reschedule a preventive maintenance task. Body: { next_due: "YYYY-MM-DD" }.
 * Drives drag-to-reschedule on the schedule board.
 */
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const task = await withCurrentTenant((db) => getMaintenanceTask(db, params.id));
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { next_due?: unknown };
  try {
    body = (await request.json()) as { next_due?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const nextDue = String(body.next_due ?? "");
  if (!isValidIsoDate(nextDue)) {
    return NextResponse.json(
      { error: "next_due must be a valid YYYY-MM-DD date." },
      { status: 422 },
    );
  }

  // A SECOND transaction, deliberately. The read above could have been kept
  // open to make this atomic, but that would hold it across `request.json()`
  // and the validation below -- unbounded time under caller control. The
  // existing read-then-write race is unchanged from the SQLite version and
  // is harmless here: rescheduling a task that vanished in between is a
  // no-op UPDATE.
  await withCurrentTenant((db) => rescheduleTask(db, task.id, nextDue));
  return NextResponse.json({ id: task.id, next_due: nextDue, ok: true });
}
