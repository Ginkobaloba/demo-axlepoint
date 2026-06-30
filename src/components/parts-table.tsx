"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { SortableTh } from "@/components/sortable-th";
import { cn } from "@/lib/cn";
import { fmtMoney } from "@/lib/format";
import type { Part } from "@/lib/types";
import {
  nextSort,
  sortRows,
  type SortState,
  type SortValue,
} from "@/lib/table-sort";

const ACCESSORS: Record<string, (p: Part) => SortValue> = {
  name: (p) => p.name,
  sku: (p) => p.sku,
  category: (p) => p.category,
  supplier: (p) => p.supplier,
  qty: (p) => p.qty_on_hand,
  reorder: (p) => p.reorder_point,
  lead: (p) => p.lead_time_days,
  cost: (p) => p.unit_cost,
  // Below-reorder first when ascending.
  status: (p) => (p.qty_on_hand < p.reorder_point ? 0 : 1),
};

export function PartsTable({ parts }: { parts: Part[] }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [stock, setStock] = useState("all");
  const [sort, setSort] = useState<SortState>({ key: "", dir: "asc" });

  const categories = useMemo(
    () => [...new Set(parts.map((p) => p.category))].sort(),
    [parts],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = parts.filter((p) => {
      const low = p.qty_on_hand < p.reorder_point;
      if (category !== "all" && p.category !== category) return false;
      if (stock === "low" && !low) return false;
      if (stock === "ok" && low) return false;
      if (needle) {
        const hay =
          `${p.name} ${p.sku} ${p.category} ${p.supplier}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return sort.key ? sortRows(rows, ACCESSORS[sort.key], sort.dir) : rows;
  }, [parts, q, category, stock, sort]);

  const onSort = (key: string) => setSort((s) => nextSort(s, key));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search part, SKU, supplier..."
            className="input pl-8"
            aria-label="Search parts"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by category"
            className="input cursor-pointer sm:w-48"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            aria-label="Filter by stock status"
            className="input cursor-pointer sm:w-44"
          >
            <option value="all">All stock</option>
            <option value="low">Below reorder</option>
            <option value="ok">In stock</option>
          </select>
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        Showing {filtered.length} of {parts.length} SKUs
      </p>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <SortableTh label="Part" sortKey="name" sort={sort} onSort={onSort} />
                <SortableTh label="SKU" sortKey="sku" sort={sort} onSort={onSort} />
                <SortableTh label="Category" sortKey="category" sort={sort} onSort={onSort} />
                <SortableTh label="Supplier" sortKey="supplier" sort={sort} onSort={onSort} />
                <SortableTh label="On hand" sortKey="qty" sort={sort} onSort={onSort} align="right" />
                <SortableTh label="Reorder at" sortKey="reorder" sort={sort} onSort={onSort} align="right" />
                <SortableTh label="Lead time" sortKey="lead" sort={sort} onSort={onSort} align="right" />
                <SortableTh label="Unit cost" sortKey="cost" sort={sort} onSort={onSort} align="right" />
                <SortableTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-ink-faint">
                    No parts match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
