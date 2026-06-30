/**
 * Pure helpers for client-side table sorting. Shared by the Work Orders and
 * Parts tables so the sort/toggle behavior is identical and testable.
 */

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

export type SortValue = string | number | null;

/**
 * Cycle the sort state when a column header is clicked. Clicking a new column
 * sorts it ascending; clicking the active column flips the direction.
 */
export function nextSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, dir: "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

/**
 * Compare two sort values. Nulls always sort last regardless of direction
 * (an unset due date or unassigned tech belongs at the bottom either way).
 * Strings compare case-insensitively; numbers compare numerically.
 */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aNull = a === null || a === "";
  const bNull = b === null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  let result: number;
  if (typeof a === "number" && typeof b === "number") {
    result = a - b;
  } else {
    result = String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }
  return dir === "asc" ? result : -result;
}

/**
 * Sort a copy of rows by the given accessor and direction. Stable: equal
 * rows keep their input order.
 */
export function sortRows<T>(
  rows: T[],
  accessor: (row: T) => SortValue,
  dir: SortDir,
): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const c = compareValues(accessor(x.row), accessor(y.row), dir);
      return c !== 0 ? c : x.i - y.i;
    })
    .map((wrapped) => wrapped.row);
}
