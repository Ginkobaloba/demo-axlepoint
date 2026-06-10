import type { AnomalySeverity } from "./types";

/**
 * Rolling EWMA anomaly detector.
 *
 * Maintains an exponentially weighted moving average and variance per
 * series. Each new reading is scored against the state BEFORE the update
 * (z-score), then folded in. Readings with |z| above the threshold are
 * anomalies. The threshold sits at 3.5 rather than the textbook 3.0: the
 * EWMA variance estimate is itself noisy, which fattens the z tails and
 * makes 3.0 fire several false positives per asset-week across a fleet
 * of hourly sensors.
 *
 * This is the same detector used at DB build time (to persist the anomaly
 * log and risk scores) and in the browser (to recompute and explain scores
 * on the asset detail view). A production deployment would swap this for a
 * trained sequence model behind the same interface.
 */

export const Z_THRESHOLD = 3.5;
export const EWMA_ALPHA = 0.06;

export interface EwmaState {
  mean: number;
  variance: number;
  count: number;
}

export interface ScoredReading {
  ts: number;
  value: number;
  z: number;
  isAnomaly: boolean;
}

export function initState(): EwmaState {
  return { mean: 0, variance: 0, count: 0 };
}

/**
 * Score one reading against the current state, then update the state.
 * The first WARMUP readings establish a baseline and are never flagged.
 */
const WARMUP = 24;

export function scoreAndUpdate(state: EwmaState, value: number): number {
  let z = 0;
  if (state.count >= WARMUP) {
    const sd = Math.sqrt(Math.max(state.variance, 1e-9));
    z = (value - state.mean) / sd;
  }
  if (state.count === 0) {
    state.mean = value;
    state.variance = Math.abs(value * 0.02) ** 2 + 1e-6;
  } else {
    const delta = value - state.mean;
    state.mean += EWMA_ALPHA * delta;
    state.variance =
      (1 - EWMA_ALPHA) * (state.variance + EWMA_ALPHA * delta * delta);
  }
  state.count += 1;
  return z;
}

/** Run the detector over a full series (oldest first). */
export function scoreSeries(
  series: { ts: number; value: number }[],
): ScoredReading[] {
  const state = initState();
  return series.map((r) => {
    const z = scoreAndUpdate(state, r.value);
    return {
      ts: r.ts,
      value: r.value,
      z,
      isAnomaly: Math.abs(z) > Z_THRESHOLD,
    };
  });
}

export function severityForZ(z: number): AnomalySeverity {
  const a = Math.abs(z);
  if (a > 5) return "severe";
  if (a > 4) return "major";
  return "minor";
}

/** Percent change of the recent window mean vs the prior window mean. */
export function windowTrendPct(
  series: { value: number }[],
  windowLen: number,
): number {
  if (series.length < windowLen * 2) return 0;
  const recent = series.slice(-windowLen);
  const prior = series.slice(-windowLen * 2, -windowLen);
  const mean = (xs: { value: number }[]) =>
    xs.reduce((s, x) => s + x.value, 0) / xs.length;
  const m0 = mean(prior);
  const m1 = mean(recent);
  if (Math.abs(m0) < 1e-9) return 0;
  return ((m1 - m0) / Math.abs(m0)) * 100;
}
