import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import {
  PoStatusChip,
  WoStatusChip,
  WoTypeChip,
} from "@/components/badges";
import { ReorderPartButton } from "@/components/reorder-part-button";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  getPart,
  getPartConsumingWorkOrders,
  getPartPurchaseOrders,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function PartDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const part = getPart(params.id);
  if (!part) notFound();
  const low = part.qty_on_hand < part.reorder_point;
  const workOrders = getPartConsumingWorkOrders(part.id);
  const pos = getPartPurchaseOrders(part.id);

  const FACTS: [string, string][] = [
    ["Supplier", part.supplier],
    ["On hand", String(part.qty_on_hand)],
    ["Reorder point", String(part.reorder_point)],
    ["Lead time", `${part.lead_time_days} days`],
    ["Unit cost", fmtMoney(part.unit_cost)],
    ["On-hand value", fmtMoney(part.qty_on_hand * part.unit_cost)],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/app/parts"
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-faint hover:text-forest"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All parts
      </Link>

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink-faint">
                {part.sku}
              </span>
              {low ? (
                <span className="chip bg-risk-high/10 text-risk-high">
                  <AlertTriangle className="h-3 w-3" />
                  Reorder needed
                </span>
              ) : (
                <span className="chip bg-risk-low/10 text-risk-low">
                  In stock
                </span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-bold tracking-tight">
              {part.name}
            </h1>
            <p className="mt-0.5 text-sm text-ink-faint">{part.category}</p>
          </div>
          {low && <ReorderPartButton partId={part.id} />}
        </div>

        <div className="grid gap-x-8 gap-y-3 px-5 py-4 sm:grid-cols-3">
          {FACTS.map(([label, value]) => (
            <div key={label}>
              <p className="label">{label}</p>
              <p
                className={
                  label === "On hand" && low
                    ? "font-mono text-sm font-semibold text-risk-high"
                    : "text-sm text-ink-soft"
                }
              >
                {value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">
            Consuming work orders
            <span className="ml-1.5 font-mono text-xs text-ink-faint">
              {workOrders.length}
            </span>
          </h2>
        </div>
        <div className="px-5 py-4">
          {workOrders.length === 0 ? (
            <p className="text-sm text-ink-faint">
              No work orders currently use this part.
            </p>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Title</th>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map((w) => (
                  <tr key={w.id} className="hover:bg-cream/60">
                    <td>
                      <Link
                        href={`/app/work-orders/${w.id}`}
                        className="font-mono text-sm font-medium text-forest hover:underline"
                      >
                        {w.id}
                      </Link>
                    </td>
                    <td className="max-w-56">
                      <span className="block truncate text-ink">{w.title}</span>
                    </td>
                    <td className="text-ink-soft">{w.asset_name}</td>
                    <td>
                      <WoTypeChip type={w.type} />
                    </td>
                    <td>
                      <WoStatusChip status={w.status} />
                    </td>
                    <td className="text-right font-mono">{w.line_qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">
            Purchase orders
            <span className="ml-1.5 font-mono text-xs text-ink-faint">
              {pos.length}
            </span>
          </h2>
        </div>
        <div className="px-5 py-4">
          {pos.length === 0 ? (
            <p className="text-sm text-ink-faint">
              No purchase orders include this part yet.
            </p>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th className="text-right">Value</th>
                  <th className="text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((po) => (
                  <tr key={po.id} className="hover:bg-cream/60">
                    <td>
                      <Link
                        href={`/app/purchase-orders/${po.id}`}
                        className="font-mono text-sm font-medium text-forest hover:underline"
                      >
                        {po.id}
                      </Link>
                    </td>
                    <td className="text-ink-soft">{po.supplier}</td>
                    <td>
                      <PoStatusChip status={po.status} />
                    </td>
                    <td className="text-right font-mono">
                      {fmtMoney(po.total)}
                    </td>
                    <td className="text-right font-mono text-xs text-ink-soft">
                      {fmtDate(po.received_at ?? po.ordered_at ?? po.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
