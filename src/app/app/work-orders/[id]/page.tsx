import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  PriorityChip,
  WoStatusChip,
  WoTypeChip,
} from "@/components/badges";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  getAsset,
  getWorkOrder,
  getWorkOrderParts,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { created?: string };
}) {
  const wo = getWorkOrder(params.id);
  if (!wo) notFound();
  const parts = getWorkOrderParts(wo.id);
  const asset = getAsset(wo.asset_id);
  const partsTotal = parts.reduce((s, p) => s + p.unit_cost * p.qty, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/app/work-orders"
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-faint hover:text-forest"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All work orders
      </Link>

      {searchParams.created && (
        <div className="flex items-center gap-2 rounded-md border border-risk-low/30 bg-risk-low/10 px-4 py-3 text-sm font-medium text-risk-low">
          <CheckCircle2 className="h-4 w-4" />
          Work order drafted. Review the details below, then assign and
          schedule it.
        </div>
      )}

      <div className="card">
        <div className="border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-ink-faint">
              {wo.id}
            </span>
            <WoStatusChip status={wo.status} />
            <WoTypeChip type={wo.type} />
            <PriorityChip priority={wo.priority} />
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight">{wo.title}</h1>
        </div>

        <div className="grid gap-x-8 gap-y-3 px-5 py-4 sm:grid-cols-2">
          <div>
            <p className="label">Asset</p>
            <Link
              href={`/app/assets/${wo.asset_id}`}
              className="text-sm font-medium text-forest hover:underline"
            >
              {wo.asset_name} ({wo.asset_id})
            </Link>
            {asset && (
              <p className="mt-0.5 text-xs text-ink-faint">{asset.location}</p>
            )}
          </div>
          <div>
            <p className="label">Assigned to</p>
            <p className="text-sm font-medium text-ink-soft">
              {wo.technician_name ?? "Unassigned"}
            </p>
          </div>
          <div>
            <p className="label">Created</p>
            <p className="text-sm text-ink-soft">{fmtDate(wo.created_at)}</p>
          </div>
          <div>
            <p className="label">{wo.completed_at ? "Completed" : "Due"}</p>
            <p className="text-sm text-ink-soft">
              {wo.completed_at
                ? fmtDate(wo.completed_at)
                : wo.due_at
                  ? fmtDate(wo.due_at)
                  : "Not set"}
            </p>
          </div>
        </div>

        <div className="border-t border-line px-5 py-4">
          <p className="label">Description</p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">
            {wo.description}
          </p>
        </div>

        {parts.length > 0 && (
          <div className="border-t border-line px-5 py-4">
            <p className="label">Parts on this order</p>
            <table className="table-base mt-1">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>SKU</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Lead time</th>
                  <th className="text-right">Ext. cost</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.id}>
                    <td className="text-ink">{p.name}</td>
                    <td className="font-mono text-xs text-ink-soft">{p.sku}</td>
                    <td className="text-right font-mono">{p.qty}</td>
                    <td className="text-right text-ink-soft">
                      {p.lead_time_days}d
                    </td>
                    <td className="text-right font-mono">
                      {fmtMoney(p.unit_cost * p.qty)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} className="text-right text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    Total
                  </td>
                  <td className="text-right font-mono font-semibold">
                    {fmtMoney(partsTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
