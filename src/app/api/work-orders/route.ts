import { NextResponse, type NextRequest } from "next/server";
import { createWorkOrder, getAsset } from "@/lib/queries";
import type { WorkOrderPriority, WorkOrderType } from "@/lib/types";
import { screenWorkOrderTitle } from "@/lib/work-order-validation";

const PRIORITIES = ["low", "medium", "high", "urgent"];
const TYPES = ["corrective", "preventive", "inspection", "predictive"];

/**
 * Creates a work order. Accepts JSON (from the Recommend Preventive Action
 * button) or form posts (from the New Work Order page). Redirects form
 * posts to the new order; returns JSON otherwise.
 */
export async function POST(request: NextRequest) {
  const isForm = (request.headers.get("content-type") ?? "").includes("form");
  const raw = isForm
    ? Object.fromEntries((await request.formData()).entries())
    : await request.json();

  const asset = getAsset(String(raw.asset_id ?? ""));
  const title = String(raw.title ?? "").trim();
  const priority = String(raw.priority ?? "medium");
  const type = String(raw.type ?? "preventive");

  // Form posts get a relative redirect back to the form with the reason;
  // JSON callers (Recommend Preventive Action) get a JSON error body.
  const reject = (status: number, reason: string) => {
    if (isForm) {
      const back = `/app/work-orders/new?error=${encodeURIComponent(reason)}`;
      return new NextResponse(null, { status: 303, headers: { Location: back } });
    }
    return NextResponse.json({ error: reason }, { status });
  };

  if (!asset || !title || !PRIORITIES.includes(priority) || !TYPES.includes(type)) {
    return reject(400, "Pick an asset and a valid title, type, and priority.");
  }

  // Reject test fixtures and junk so they cannot accumulate in the live demo.
  const screen = screenWorkOrderTitle(title);
  if (!screen.ok) {
    return reject(422, screen.reason ?? "Invalid title.");
  }

  const dueRaw = String(raw.due_date ?? "").trim();
  const dueAt = dueRaw
    ? Math.floor(new Date(`${dueRaw}T12:00:00`).getTime() / 1000)
    : null;

  const id = createWorkOrder({
    asset_id: asset.id,
    title: title.slice(0, 160),
    description: String(raw.description ?? "").slice(0, 2000),
    priority: priority as WorkOrderPriority,
    type: type as WorkOrderType,
    assigned_to: raw.assigned_to ? String(raw.assigned_to) : null,
    due_at: dueAt,
  });

  const target = new URL(`/app/work-orders/${id}?created=1`, request.url);
  if (isForm) {
    return NextResponse.redirect(target, 303);
  }
  return NextResponse.json({ id, url: target.pathname + target.search });
}
