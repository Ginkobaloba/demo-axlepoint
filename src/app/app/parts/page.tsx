import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Parts inventory</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Stock levels tracked against reorder points and supplier lead times.
        </p>
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

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Part</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Supplier</th>
                <th className="text-right">On hand</th>
                <th className="text-right">Reorder at</th>
                <th className="text-right">Lead time</th>
                <th className="text-right">Unit cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => {
                const low = p.qty_on_hand < p.reorder_point;
                return (
                  <tr
                    key={p.id}
                    className={cn("hover:bg-cream/60", low && "bg-risk-high/5")}
                  >
                    <td className="font-medium">{p.name}</td>
                    <td className="font-mono text-xs text-ink-soft">{p.sku}</td>
                    <td className="text-ink-soft">{p.category}</td>
                    <td className="text-ink-soft">{p.supplier}</td>
                    <td
                      className={cn(
                        "text-right font-mono",
                        low && "font-semibold text-risk-high",
                      )}
                    >
                      {p.qty_on_hand}
                    </td>
                    <td className="text-right font-mono text-ink-soft">
                      {p.reorder_point}
                    </td>
                    <td className="text-right font-mono text-ink-soft">
                      {p.lead_time_days}d
                    </td>
                    <td className="text-right font-mono text-ink-soft">
                      {fmtMoney(p.unit_cost)}
                    </td>
                    <td>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
