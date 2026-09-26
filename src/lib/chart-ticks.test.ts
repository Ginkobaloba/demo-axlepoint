import { describe, expect, it } from "vitest";
import {
  CHART_RANGES,
  type ChartRange,
  sensorAxisTicks,
  tickLabel,
  uniqueTimeTicks,
} from "./chart-ticks";

const DAY = 86400;
/** 2026-03-03T12:00:00Z. Fixed so the suite does not drift with the clock. */
const BASE = Math.floor(Date.UTC(2026, 2, 3, 12, 0, 0) / 1000);

/** Realistic spans, matching what /api/assets/[id]/readings returns per range. */
const SPAN: Record<ChartRange, number> = {
  "24h": 1 * DAY,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
  "6mo": 183 * DAY,
};

/** An hourly series, the shape the readings endpoint actually returns. */
function series(span: number, step = 3600) {
  const out: { ts: number }[] = [];
  for (let ts = BASE; ts <= BASE + span; ts += step) out.push({ ts });
  return out;
}

describe("sensorAxisTicks, per range", () => {
  // These four assertions are the regression. Measured live on AST-0023 before
  // the fix: 7d and 30d rendered exactly ONE label, and 6mo rendered eleven
  // labels of which only six were distinct (Mar, Apr, Apr, May, May, Jun, ...).
  it.each(CHART_RANGES)("%s gives several ticks, all labelled distinctly", (range) => {
    const ticks = sensorAxisTicks(series(SPAN[range]), range);
    const labels = ticks.map((ts) => tickLabel(ts, range));

    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each(CHART_RANGES)("%s stays inside the domain and ascends", (range) => {
    const data = series(SPAN[range]);
    const ticks = sensorAxisTicks(data, range);
    const from = data[0].ts;
    const to = data[data.length - 1].ts;

    expect(ticks[0]).toBeGreaterThanOrEqual(from);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(to);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it("uses the series min and max, not its first and last element", () => {
    // A payload that arrives out of order must not invert the axis.
    const shuffled = [{ ts: BASE + 3 * DAY }, { ts: BASE }, { ts: BASE + 7 * DAY }];
    const ticks = sensorAxisTicks(shuffled, "7d");
    expect(ticks[0]).toBe(BASE);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(BASE + 7 * DAY);
  });

  it("returns nothing for an empty series rather than inventing an axis", () => {
    expect(sensorAxisTicks([], "7d")).toEqual([]);
  });
});

describe("uniqueTimeTicks de-duplicates on the LABEL", () => {
  // The control. If de-duplication were removed, THIS is the test that fails,
  // which is what stops the suite above from passing vacuously: a domain of ten
  // days under the coarse 6mo format genuinely cannot show more than one label.
  it("collapses ticks that format identically", () => {
    const from = BASE;
    const to = BASE + 10 * DAY; // entirely within March
    const ticks = uniqueTimeTicks(from, to, 6, (ts) => tickLabel(ts, "6mo"));

    expect(ticks).toHaveLength(1);
    expect(tickLabel(ticks[0], "6mo")).toBe(tickLabel(from, "6mo"));
  });

  it("keeps every tick when all labels differ", () => {
    const ticks = uniqueTimeTicks(BASE, BASE + 6 * DAY, 7, (ts) =>
      tickLabel(ts, "7d"),
    );
    expect(ticks).toHaveLength(7);
  });

  it("never exceeds the requested count", () => {
    const ticks = uniqueTimeTicks(BASE, BASE + 30 * DAY, 5, (ts) =>
      tickLabel(ts, "30d"),
    );
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it.each([
    ["an empty domain", BASE, BASE - 1, []],
    ["a single instant", BASE, BASE, [BASE]],
  ])("handles %s", (_name, from, to, expected) => {
    expect(uniqueTimeTicks(from as number, to as number, 6, String)).toEqual(
      expected,
    );
  });

  it("refuses a non-finite domain instead of looping", () => {
    expect(uniqueTimeTicks(NaN, BASE, 6, String)).toEqual([]);
    expect(uniqueTimeTicks(BASE, Infinity, 6, String)).toEqual([]);
  });
});
