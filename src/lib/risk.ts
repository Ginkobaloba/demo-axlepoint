import { SENSOR_LABELS, riskBand } from "./types";
import type { AnomalySeverity, RiskFactor, SensorType } from "./types";

/**
 * Aggregates recent anomaly activity into a 0-100 failure risk score.
 *
 * Inputs per sensor: anomaly counts by severity over the trailing 7 days,
 * plus the 7-day trend of the sensor mean. Severities are weighted, trend
 * drift adds a bonus, each sensor's contribution is capped so one noisy
 * channel cannot saturate the score alone, and the total is capped at 100.
 */

const SEVERITY_WEIGHT: Record<AnomalySeverity, number> = {
  minor: 5,
  major: 11,
  severe: 18,
};

const SENSOR_CAP = 55;

export interface SensorActivity {
  sensor: SensorType;
  counts: Record<AnomalySeverity, number>;
  trendPct7d: number;
}

export function computeRisk(activity: SensorActivity[]): {
  score: number;
  band: ReturnType<typeof riskBand>;
  factors: RiskFactor[];
} {
  const factors: RiskFactor[] = activity.map((a) => {
    const fromAnomalies =
      a.counts.minor * SEVERITY_WEIGHT.minor +
      a.counts.major * SEVERITY_WEIGHT.major +
      a.counts.severe * SEVERITY_WEIGHT.severe;
    // Sustained drift matters even between discrete anomaly hits.
    const trendBonus = Math.min(18, Math.max(0, (Math.abs(a.trendPct7d) - 4) * 1.5));
    // Soft saturation toward the per-sensor cap: one noisy channel cannot
    // dominate, and distinct inputs keep distinct outputs (no tie pileups
    // at the cap).
    const contribution =
      SENSOR_CAP * Math.tanh((fromAnomalies + trendBonus) / SENSOR_CAP);
    return {
      sensor: a.sensor,
      label: SENSOR_LABELS[a.sensor],
      contribution: Math.round(contribution * 10) / 10,
      anomalies7d: a.counts.minor + a.counts.major + a.counts.severe,
      trendPct7d: Math.round(a.trendPct7d * 10) / 10,
    };
  });

  factors.sort((x, y) => y.contribution - x.contribution);
  // Linear up to 70, then compressed toward an asymptote just under 98.
  // A saturated 100 communicates less than a high distinct score.
  const raw = factors.reduce((s, f) => s + f.contribution, 0);
  const compressed = raw <= 70 ? raw : 70 + 28 * Math.tanh((raw - 70) / 30);
  const score = Math.round(compressed);
  return { score, band: riskBand(score), factors };
}

export const MODEL_CONFIDENCE = 0.78;

export const RISK_COLORS: Record<string, string> = {
  low: "#2d8c5a",
  medium: "#c89c47",
  high: "#b65d3e",
  critical: "#8c2e1f",
};
