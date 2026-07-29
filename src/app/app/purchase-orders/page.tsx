import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PoStatusChip } from "@/components/badges";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getPurchaseOrders } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Purchase Orders" };

export default async function PurchaseOrdersPage(
  props: {
    searchParams: Promise<{ created?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const pos = getPurchaseOrders();
  const draft = pos.filter((p) => p.status === "draft");
  const ordered = pos.filter((p) => p.status === "ordered");
  const openValue = [...draft, ...ordered].reduce((s, p) => s + p.total, 0);

  const SUMMARY = [
    { label: "Open POs", value: String(draft.length + ordered.length) },
    { label: "Draft", value: String(draft.length) },
    { label: "In transit", value: String(ordered.length) },
    { label: "Open commitment", value: fmtMoney(openValue) },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Purchase orders</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Restocking parts against reorder points. Draft, order, and receive to
          bring stock back on hand.
        </p>
      </div>

      {searchParams.created && (
        <div className="flex items-center gap-2 rounded-md border border-risk-low/30 bg-risk-low/10 px-4 py-3 text-sm font-medium text-risk-low">
          <CheckCircle2 className="h-4 w-4" />
          Reorder purchase orders drafted. Review the lines, then mark each
          ordered.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SUMMARY.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {s.label}
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold text-ink">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>PO</th>
                <th>Supplier</th>
                <th>Status</th>
                <th className="text-right">Lines</th>
                <th className="text-right">Value</th>
                <th className="text-right">Created</th>
                <th className="text-right">Expected / received</th>
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
                  <td className="text-ink">{po.supplier}</td>
                  <td>
                    <PoStatusChip status={po.status} />
                  </td>
                  <td className="text-right font-mono text-ink-soft">
                    {po.line_count}
                  </td>
                  <td className="text-right font-mono">{fmtMoney(po.total)}</td>
                  <td className="text-right font-mono text-xs text-ink-soft">
                    {fmtDate(po.created_at)}
                  </td>
                  <td className="text-right font-mono text-xs text-ink-soft">
                    {po.received_at
                      ? fmtDate(po.received_at)
                      : po.expected_at
                        ? fmtDate(po.expected_at)
                        : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
