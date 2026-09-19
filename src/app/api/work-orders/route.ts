import { NextResponse, type NextRequest } from "next/server";
import { createWorkOrder, getAsset } from "@/lib/queries";
import type { WorkOrderPriority, WorkOrderType } from "@/lib/types";
import {
  DISCARDED_DESCRIPTION_NOTICE,
  deriveWorkOrderTitle,
  screenWorkOrderTitle,
} from "@/lib/work-order-validation";
import { deriveRecommendedWorkOrder } from "@/lib/predictive-action";

const PRIORITIES = ["low", "medium", "high", "urgent"];
const TYPES = ["corrective", "preventive", "inspection", "predictive"];

/**
 * Creates a work order. Accepts JSON (from the Recommend Preventive Action
 * button) or form posts (from the New Work Order page). Redirects form
 * posts to the new order; returns JSON otherwise.
 *
 * Anonymous by design (council item 1.2, docs/demos/axlepoint/decisions.md
 * D-012): this endpoint is open, and every visitor shares one demo
 * database, so the title and description a visitor types are validated
 * for shape only and then discarded -- never written to the database. See
 * deriveWorkOrderTitle / DISCARDED_DESCRIPTION_NOTICE.
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

  // Anonymous by design (D-012): the visitor's literal title and
  // description are validated above but never persisted. What is stored
  // is derived from structured, server-owned fields only -- the asset and
  // type for most requests, or (for the "Recommend Preventive Action"
  // headline flow) the asset's own risk_factors, so that flow keeps
  // telling its story instead of degrading to a generic placeholder.
  const { title: storedTitle, description: storedDescription } =
    type === "predictive"
      ? deriveRecommendedWorkOrder(asset)
      : {
          title: deriveWorkOrderTitle(asset.name, type as WorkOrderType),
          description: DISCARDED_DESCRIPTION_NOTICE,
        };

  const id = createWorkOrder({
    asset_id: asset.id,
    title: storedTitle,
    description: storedDescription,
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
