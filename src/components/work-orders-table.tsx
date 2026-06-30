"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PriorityChip, WoStatusChip, WoTypeChip } from "@/components/badges";
import { SortableTh } from "@/components/sortable-th";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import type { WorkOrderWithJoins } from "@/lib/queries";
import {
  nextSort,
  sortRows,
  type SortState,
  type SortValue,
} from "@/lib/table-sort";
import {
  WO_STATUS_LABELS,
  WO_TYPE_LABELS,
  type WorkOrderStatus,
  type WorkOrderType,
} from "@/lib/types";

const STATUS_TABS = [
  "all",
  "open",
  "in_progress",
  "awaiting_parts",
  "closed",
] as const;

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};
const STATUS_RANK: Record<string, number> = {
  open: 0,
  in_progress: 1,
  awaiting_parts: 2,
  closed: 3,
};

const ACCESSORS: Record<string, (w: WorkOrderWithJoins) => SortValue> = {
  id: (w) => w.id,
  title: (w) => w.title,
  asset: (w) => w.asset_name,
  type: (w) => w.type,
  priority: (w) => PRIORITY_RANK[w.priority] ?? 9,
  status: (w) => STATUS_RANK[w.status] ?? 9,
  assigned: (w) => w.technician_name,
  due: (w) => w.due_at,
};

const TYPES: WorkOrderType[] = [
  "corrective",
  "preventive",
  "inspection",
  "predictive",
];
const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

export function WorkOrdersTable({ orders }: { orders: WorkOrderWithJoins[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]>("all");
  const [type, setType] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [sort, setSort] = useState<SortState>({ key: "", dir: "asc" });

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const w of orders) c[w.status] = (c[w.status] ?? 0) + 1;
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = orders.filter((w) => {
      if (status !== "all" && w.status !== status) return false;
      if (type !== "all" && w.type !== type) return false;
      if (priority !== "all" && w.priority !== priority) return false;
      if (needle) {
        const hay = `${w.id} ${w.title} ${w.asset_name} ${
          w.technician_name ?? ""
        }`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return sort.key ? sortRows(rows, ACCESSORS[sort.key], sort.dir) : rows;
  }, [orders, q, status, type, priority, sort]);

  const onSort = (key: string) => setSort((s) => nextSort(s, key));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order, title, asset, tech..."
            className="input pl-8"
            aria-label="Search work orders"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter by type"
            className="input cursor-pointer sm:w-40"
          >
            <option value="all">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {WO_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            aria-label="Filter by priority"
            className="input cursor-pointer sm:w-36 capitalize"
          >
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p} className="capitalize">
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1 border-b border-line">
        {STATUS_TABS.map((tab) => {
          const count =
            tab === "all" ? orders.length : (statusCounts[tab] ?? 0);
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setStatus(tab)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                status === tab
                  ? "border-forest text-forest"
                  : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {tab === "all"
                ? "All"
                : WO_STATUS_LABELS[tab as WorkOrderStatus]}
              <span className="ml-1.5 font-mono text-xs text-ink-faint">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-ink-faint">
        Showing {filtered.length} of {orders.length} work orders
      </p>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <SortableTh label="Order" sortKey="id" sort={sort} onSort={onSort} />
                <SortableTh label="Title" sortKey="title" sort={sort} onSort={onSort} />
                <SortableTh label="Asset" sortKey="asset" sort={sort} onSort={onSort} />
                <SortableTh label="Type" sortKey="type" sort={sort} onSort={onSort} />
                <SortableTh label="Priority" sortKey="priority" sort={sort} onSort={onSort} />
                <SortableTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
                <SortableTh label="Assigned" sortKey="assigned" sort={sort} onSort={onSort} />
                <SortableTh label="Due" sortKey="due" sort={sort} onSort={onSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-ink-faint">
                    No work orders match these filters.
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
