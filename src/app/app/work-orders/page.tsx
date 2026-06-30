import Link from "next/link";
import { Plus } from "lucide-react";
import { WorkOrdersTable } from "@/components/work-orders-table";
import { getWorkOrders } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Work Orders" };

export default function WorkOrdersPage() {
  const orders = getWorkOrders();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Work orders</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Corrective, preventive, inspection, and predictive work across the
            fleet. Search, filter, and sort any column.
          </p>
        </div>
        <Link href="/app/work-orders/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          New work order
        </Link>
      </div>

      <WorkOrdersTable orders={orders} />
    </div>
  );
}
