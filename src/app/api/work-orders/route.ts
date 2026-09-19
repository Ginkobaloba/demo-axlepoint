import { NextResponse, type NextRequest } from "next/server";
import { createWorkOrder, getAsset, getTechnician } from "@/lib/queries";
import type { WorkOrderPriority, WorkOrderType } from "@/lib/types";
import {
  DISCARDED_DESCRIPTION_NOTICE,
  deriveWorkOrderTitle,
  screenWorkOrderTitle,
} from "@/lib/work-order-validation";
import { deriveRecommendedWorkOrder } from "@/lib/predictive-action";
import { isValidIsoDate } from "@/lib/schedule-view";

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

  // assigned_to has no FK (schema: TEXT), so it must be checked here rather
  // than trusted. Deep-verify PR #24 blocker B1: an unvalidated string here
  // let arbitrary text reach a fresh visitor's page source through the
  // work-orders list and detail RSC payload -- the exact leak this PR
  // exists to close, in a field D-012 wrongly called safe. Empty/absent
  // clears the field; anything else must be a real technician id.
  const assignedToRaw =
    raw.assigned_to !== undefined && raw.assigned_to !== null
      ? String(raw.assigned_to).trim()
      : "";
  let assignedTo: string | null = null;
  if (assignedToRaw) {
    if (!getTechnician(assignedToRaw)) {
      return reject(422, "Unknown technician.");
    }
    assignedTo = assignedToRaw;
  }

  // W4/W5 (deep-verify PR #24): PATCH already 422s on an unparseable due
  // date (wo-actions.ts); this route silently stored NULL instead (W4,
  // fixed). It also accepted an overflow date like 2026-02-30, silently
  // rolling it to March 2 (W5) -- a plain `new Date().getTime()` NaN check
  // never catches that, since JS Date normalizes overflow instead of
  // rejecting it. Both routes now go through the same isValidIsoDate
  // helper the schedule board already uses (schedule-view.ts), which does
  // a round-trip check to reject overflow, so shape AND calendar validity
  // match between POST and PATCH. Trimmed-empty/whitespace-only still
  // means "no due date" (clear), same as PATCH's trimmed-empty check.
  const dueRaw = String(raw.due_date ?? "").trim();
  let dueAt: number | null = null;
  if (dueRaw) {
    if (!isValidIsoDate(dueRaw)) {
      return reject(422, "Invalid due date.");
    }
    dueAt = Math.floor(new Date(`${dueRaw}T12:00:00`).getTime() / 1000);
  }

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
    assigned_to: assignedTo,
    due_at: dueAt,
  });

  // W2 (deep-verify PR #24, pre-existing on main): building an absolute
  // URL from request.url ships Location: http://0.0.0.0:3000/... behind
  // the demo's reverse proxy, so a real browser lands on a dead host after
  // submitting the form. api/session/route.ts already documents this trap
  // and uses a relative Location; match it here.
  const targetPath = `/app/work-orders/${id}?created=1`;
  if (isForm) {
    return new NextResponse(null, { status: 303, headers: { Location: targetPath } });
  }
  return NextResponse.json({ id, url: targetPath });
}
