import { format } from "date-fns";

/**
 * X-axis tick generation for the asset sensor chart.
 *
 * WHY THIS EXISTS. Recharts was left to generate its own ticks from
 * `scale="time"` with `domain={["dataMin","dataMax"]}`. Measured against the
 * live demo on AST-0023, that produced:
 *
 *   24h  -> 9 labels, correct
 *   7d   -> ONE label ("Sep 13")      and 7d is the DEFAULT range
 *   30d  -> ONE label ("Aug 22")
 *   6mo  -> 11 labels, DUPLICATED: Mar, Apr, Apr, May, May, Jun, Jun, ...
 *
 * So the flagship asset page showed a week of telemetry under a single date,
 * and six months under repeated month names. The line, the anomaly markers and
 * the y-axis were all correct, so this was never missing data: it was tick
 * generation, and it is not something to leave to a library default that
 * changed under us (recharts is pinned ^3.8.1 and v3 reworked tick selection).
 *
 * Ticks are therefore computed here and passed to the axis explicitly. The two
 * failures above are different, so the fix has to address both:
 *
 *   - too FEW ticks is fixed by choosing the count ourselves,
 *   - duplicate LABELS are fixed by de-duplicating on the FORMATTED STRING,
 *     not on the timestamp. Two different instants three weeks apart are
 *     distinct numbers but both format to "Aug" under the 6mo format, and it
 *     is the label a viewer reads, so the label is what has to be unique.
 *
 * Pure and DOM-free, so it is tested directly rather than through a chart.
 */

export const CHART_RANGES = ["24h", "7d", "30d", "6mo"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

/** date-fns pattern per range. "6mo" is deliberately coarse. */
const TICK_FORMAT: Record<ChartRange, string> = {
  "24h": "HH:mm",
  "7d": "MMM d",
  "30d": "MMM d",
  "6mo": "MMM",
};

/**
 * How many labels to aim for. These are TARGETS, not guarantees: the
 * de-duplication below may return fewer, which is the correct outcome when the
 * format genuinely cannot tell two ticks apart.
 */
const TARGET_TICKS: Record<ChartRange, number> = {
  "24h": 7,
  "7d": 7,
  "30d": 6,
  "6mo": 6,
};

/** The label a viewer actually reads under this range. */
export function tickLabel(ts: number, range: ChartRange): string {
  return format(new Date(ts * 1000), TICK_FORMAT[range]);
}

/**
 * Evenly spaced ticks across [from, to] whose FORMATTED labels are unique.
 *
 * Returns ascending timestamps inside the domain, never more than `desired`,
 * and never two entries that render as the same string.
 */
export function uniqueTimeTicks(
  from: number,
  to: number,
  desired: number,
  label: (ts: number) => string,
): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  if (to < from) return [];
  if (to === from) return [from];

  const count = Math.max(2, Math.floor(desired));
  const seen = new Set<string>();
  const ticks: number[] = [];

  for (let i = 0; i < count; i++) {
    const ts = Math.round(from + ((to - from) * i) / (count - 1));
    const text = label(ts);
    if (seen.has(text)) continue;
    seen.add(text);
    ticks.push(ts);
  }
  return ticks;
}

/**
 * Ticks for a fetched series. Uses the series MIN and MAX rather than its first
 * and last element, so an out-of-order payload cannot invert the axis.
 */
export function sensorAxisTicks(
  series: readonly { ts: number | string }[],
  range: ChartRange,
): number[] {
  if (series.length === 0) return [];

  // ts is COERCED, because it has genuinely arrived as a string. The readings
  // endpoint reads a Postgres bigint, node-postgres hands those back as
  // strings, and the int8 parser registered in pg.ts does not take effect in
  // the built Next server (measured 2026-09-26). queries.ts now converts at
  // the boundary; this is the second line of defence, because the failure is
  // invisible from here: string timestamps make `from` and `to` strings,
  // Number.isFinite rejects them, uniqueTimeTicks returns nothing, and the
  // chart renders a line with NO x-axis labels and no error anywhere.
  //
  // Comparing before coercing would also be wrong on its own: "9..." sorts
  // after "10..." lexicographically, so min and max would be the wrong rows.
  let from = Infinity;
  let to = -Infinity;
  for (const point of series) {
    const ts = Number(point.ts);
    if (!Number.isFinite(ts)) continue;
    if (ts < from) from = ts;
    if (ts > to) to = ts;
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];

  return uniqueTimeTicks(from, to, TARGET_TICKS[range], (ts) =>
    tickLabel(ts, range),
  );
}
