import { NextResponse, type NextRequest } from "next/server";
import { getMaintenanceTask, rescheduleTask } from "@/lib/queries";
import { isValidIsoDate } from "@/lib/schedule-view";

/**
 * Reschedule a preventive maintenance task. Body: { next_due: "YYYY-MM-DD" }.
 * Drives drag-to-reschedule on the schedule board.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const task = getMaintenanceTask(params.id);
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

  rescheduleTask(task.id, nextDue);
  return NextResponse.json({ id: task.id, next_due: nextDue, ok: true });
}
