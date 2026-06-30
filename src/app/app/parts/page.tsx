import { cn } from "@/lib/cn";
import { CreateReorderPoButton } from "@/components/create-reorder-po-button";
import { PartsTable } from "@/components/parts-table";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { getParts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Parts" };

export default function PartsPage() {
  const parts = getParts();
  const lowStock = parts.filter((p) => p.qty_on_hand < p.reorder_point);
  const stockValue = parts.reduce((s, p) => s + p.qty_on_hand * p.unit_cost, 0);
  const longLead = parts.filter((p) => p.lead_time_days >= 30);

  const SUMMARY = [
    { label: "SKUs tracked", value: fmtNumber(parts.length) },
    {
      label: "Below reorder point",
      value: String(lowStock.length),
      alert: lowStock.length > 0,
    },
    { label: "Long-lead SKUs (30d+)", value: String(longLead.length) },
    { label: "On-hand value", value: fmtMoney(stockValue) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Parts inventory</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Stock levels tracked against reorder points and supplier lead times.
          </p>
        </div>
        <CreateReorderPoButton lowCount={lowStock.length} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SUMMARY.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {s.label}
            </p>
            <p
              className={cn(
                "mt-2 font-mono text-2xl font-semibold",
                s.alert ? "text-risk-high" : "text-ink",
              )}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <PartsTable parts={parts} />
    </div>
  );
}
