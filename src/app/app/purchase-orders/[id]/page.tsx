import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PoStatusChip } from "@/components/badges";
import { PurchaseOrderActions } from "@/components/purchase-order-actions";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getPurchaseOrder, getPurchaseOrderLines } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const po = getPurchaseOrder(params.id);
  if (!po) notFound();
  const lines = getPurchaseOrderLines(po.id);
  const total = lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);

  const dates: [string, number | null][] = [
    ["Created", po.created_at],
    ["Ordered", po.ordered_at],
    [po.received_at ? "Received" : "Expected", po.received_at ?? po.expected_at],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/app/purchase-orders"
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-faint hover:text-forest"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All purchase orders
      </Link>

      <div className="card">
        <div className="border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-ink-faint">
              {po.id}
            </span>
            <PoStatusChip status={po.status} />
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight">
            {po.supplier}
          </h1>
          {po.notes && (
            <p className="mt-1 text-sm text-ink-faint">{po.notes}</p>
          )}
        </div>

        <div className="grid gap-x-8 gap-y-3 px-5 py-4 sm:grid-cols-3">
          {dates.map(([label, ts]) => (
            <div key={label}>
              <p className="label">{label}</p>
              <p className="text-sm text-ink-soft">
                {ts ? fmtDate(ts) : "Not set"}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-line px-5 py-4">
          <table className="table-base">
            <thead>
              <tr>
                <th>Part</th>
                <th>SKU</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Unit cost</th>
                <th className="text-right">Ext. cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.part_id}>
                  <td>
                    <Link
                      href={`/app/parts/${l.part_id}`}
                      className="text-ink hover:text-forest hover:underline"
                    >
                      {l.name}
                    </Link>
                  </td>
                  <td className="font-mono text-xs text-ink-soft">{l.sku}</td>
                  <td className="text-right font-mono">{l.qty}</td>
                  <td className="text-right font-mono text-ink-soft">
                    {fmtMoney(l.unit_cost)}
                  </td>
                  <td className="text-right font-mono">
                    {fmtMoney(l.qty * l.unit_cost)}
                  </td>
                </tr>
              ))}
              <tr>
                <td
                  colSpan={4}
                  className="text-right text-xs font-semibold uppercase tracking-wide text-ink-faint"
                >
                  Total
                </td>
                <td className="text-right font-mono font-semibold">
                  {fmtMoney(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">Actions</h2>
        </div>
        <div className="px-5 py-4">
          <PurchaseOrderActions poId={po.id} status={po.status} />
        </div>
      </div>
    </div>
  );
}
