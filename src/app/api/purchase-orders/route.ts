import { NextResponse, type NextRequest } from "next/server";
import { createReorderPurchaseOrders } from "@/lib/queries";

/**
 * Create draft reorder purchase orders. Body may include a part_ids array to
 * restock specific parts; with no body (or an empty array) it restocks every
 * part currently below its reorder point. Parts are grouped by supplier into
 * one draft PO each.
 */
export async function POST(request: NextRequest) {
  let partIds: string[] | undefined;
  try {
    const body = (await request.json()) as { part_ids?: unknown };
    if (Array.isArray(body?.part_ids)) {
      partIds = body.part_ids.map((id) => String(id));
    }
  } catch {
    // No body is fine: restock all below-reorder parts.
  }

  const result = createReorderPurchaseOrders(partIds);
  if (result.created === 0) {
    return NextResponse.json(
      { error: "Nothing to reorder.", ...result },
      { status: 422 },
    );
  }
  return NextResponse.json(result);
}
