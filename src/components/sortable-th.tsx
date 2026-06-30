"use client";

import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SortState } from "@/lib/table-sort";

/**
 * A sortable table header cell. Shows a neutral glyph until active, then an
 * up/down chevron for the current direction. Used by the Work Orders and
 * Parts tables.
 */
export function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn(align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}`}
        className={cn(
          "group inline-flex items-center gap-1 font-semibold uppercase tracking-wide transition-colors hover:text-ink",
          align === "right" && "flex-row-reverse",
          active ? "text-forest" : "text-ink-faint",
        )}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
        )}
      </button>
    </th>
  );
}
