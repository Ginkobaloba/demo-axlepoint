import Link from "next/link";
import { Plus } from "lucide-react";
import {
  PriorityChip,
  WoStatusChip,
  WoTypeChip,
} from "@/components/badges";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { getWorkOrders, getWorkOrderStatusCounts } from "@/lib/queries";
import { WO_STATUS_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Work Orders" };

const TABS = ["all", "open", "in_progress", "awaiting_parts", "closed"] as const;

export default function WorkOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const active = TABS.includes(searchParams.status as (typeof TABS)[number])
    ? (searchParams.status as (typeof TABS)[number])
    : "all";
  const orders = getWorkOrders(active === "all" ? undefined : active);
  const counts = getWorkOrderStatusCounts();
  const totalCount = Object.values(counts).reduce((s, c) => s + c, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Work orders</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Corrective, preventive, inspection, and predictive work across the
            fleet.
          </p>
        </div>
        <Link href="/app/work-orders/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          New work order
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((tab) => {
          const count =
            tab === "all" ? totalCount : (counts[tab] ?? 0);
          return (
            <Link
              key={tab}
              href={tab === "all" ? "/app/work-orders" : `/app/work-orders?status=${tab}`}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active === tab
                  ? "border-forest text-forest"
                  : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {tab === "all"
                ? "All"
                : WO_STATUS_LABELS[tab as keyof typeof WO_STATUS_LABELS]}
              <span className="ml-1.5 font-mono text-xs text-ink-faint">
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Order</th>
                <th>Title</th>
                <th>Asset</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assigned</th>
                <th className="text-right">Due</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((w) => (
                <tr key={w.id} className="hover:bg-cream/60">
                  <td>
                    <Link
                      href={`/app/work-orders/${w.id}`}
                      className="font-mono text-sm font-medium text-forest hover:underline"
                    >
                      {w.id}
                    </Link>
                  </td>
                  <td className="max-w-72">
                    <span className="block truncate text-ink">{w.title}</span>
                  </td>
                  <td>
                    <Link
                      href={`/app/assets/${w.asset_id}`}
                      className="text-ink-soft hover:text-forest hover:underline"
                    >
                      {w.asset_name}
                    </Link>
                  </td>
                  <td>
                    <WoTypeChip type={w.type} />
                  </td>
                  <td>
                    <PriorityChip priority={w.priority} />
                  </td>
                  <td>
                    <WoStatusChip status={w.status} />
                  </td>
                  <td className="text-ink-soft">
                    {w.technician_name ?? (
                      <span className="text-ink-faint">Unassigned</span>
                    )}
                  </td>
                  <td className="text-right font-mono text-xs text-ink-soft">
                    {w.due_at ? fmtDate(w.due_at) : "-"}
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
