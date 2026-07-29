import { NextResponse, type NextRequest } from "next/server";
import { getPurchaseOrder, setPurchaseOrderStatus } from "@/lib/queries";
import { parsePoStatusPatch } from "@/lib/po-actions";

/**
 * Move a purchase order along its lifecycle (draft -> ordered -> received,
 * or cancelled). Receiving restocks the parts on the order.
 */
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const po = getPurchaseOrder(params.id);
  if (!po) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const parsed = parsePoStatusPatch(body, po.status);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  setPurchaseOrderStatus(po.id, parsed.status);
  return NextResponse.json({ id: po.id, status: parsed.status, ok: true });
}
