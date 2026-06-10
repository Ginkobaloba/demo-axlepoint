import { NextResponse, type NextRequest } from "next/server";
import { createWorkOrder, getAsset } from "@/lib/queries";
import type { WorkOrderPriority, WorkOrderType } from "@/lib/types";

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

  if (!asset || !title || !PRIORITIES.includes(priority) || !TYPES.includes(type)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
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
