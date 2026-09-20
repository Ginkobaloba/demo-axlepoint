import type { RiskFactor } from "./types";

/**
 * Recommended action copy, keyed by the sensor driving an asset's risk
 * score. Shared by the "Recommend Preventive Action" button
 * (recommend-action.tsx, for its preview) and by POST /api/work-orders
 * (route.ts, when type === "predictive") so both sides tell the same
 * story from one table instead of two copies drifting apart.
 */
export const ACTION_BY_SENSOR: Record<string, [string, string]> = {
  vibration: [
    "Inspect bearings and alignment",
    "Inspect bearing condition, mounts, and shaft alignment. Collect a full vibration spectrum for analysis before and after any correction.",
  ],
  temperature: [
    "Inspect cooling circuit",
    "Verify coolant flow and heat exchanger performance, inspect for fouling, and confirm temperature sensor calibration.",
  ],
  oil_pressure: [
    "Inspect lube oil system",
    "Inspect oil pump output, relief valve, and filter differential pressure. Pull an oil sample for wear metals analysis.",
  ],
  cylinder_pressure: [
    "Inspect cylinder heads and valves",
    "Check cylinder compression balance, inspect valve seats and rings via borescope, and verify injector timing.",
  ],
  fuel_rate: [
    "Inspect fuel injection system",
    "Inspect injectors and fuel lines for wear or leakage, verify injection timing, and compare specific fuel consumption against baseline.",
  ],
  rpm: [
    "Inspect governor and speed control",
    "Verify governor response, actuator linkage, and speed sensor signal quality under load change.",
  ],
};

/** The factor an asset's risk score is actually driven by, or null. */
export function topRiskFactor(asset: {
  risk_factors: string;
}): RiskFactor | null {
  const allFactors = JSON.parse(asset.risk_factors) as RiskFactor[];
  const factors = allFactors.filter((f) => f.contribution > 0);
  return factors[0] ?? null;
}

function evidenceFor(factor: RiskFactor | null): string {
  return factor
    ? `Driving signal: ${factor.label.toLowerCase()} with ${factor.anomalies7d} anomalies in the last 7 days` +
        (Math.abs(factor.trendPct7d) >= 2
          ? ` and a ${factor.trendPct7d > 0 ? "+" : ""}${factor.trendPct7d}% 7-day trend.`
          : ".")
    : "Driving signal: elevated composite risk score.";
}

/**
 * The predictive work order's title and description, derived entirely
 * from the asset's own server-computed risk factors -- never from visitor
 * input. Anonymous by design (council item 1.2,
 * docs/demos/axlepoint/decisions.md D-012): POST /api/work-orders calls
 * this for type "predictive" instead of the generic
 * deriveWorkOrderTitle/DISCARDED_DESCRIPTION_NOTICE pair, so the demo's
 * headline workflow (D-017, "Recommend Preventive Action") still tells its
 * story even though nothing a visitor types is ever stored. Matches the
 * copy recommend-action.tsx previews client-side, since both read the same
 * ACTION_BY_SENSOR table and the same asset.risk_factors data.
 */
export function deriveRecommendedWorkOrder(asset: {
  id: string;
  name: string;
  risk_factors: string;
}): { title: string; description: string } {
  const factor = topRiskFactor(asset);
  const [action, detail] = factor
    ? (ACTION_BY_SENSOR[factor.sensor] ?? ACTION_BY_SENSOR.vibration)
    : ACTION_BY_SENSOR.vibration;
  return {
    title: `${action} - ${asset.name} (${asset.id})`,
    description: `Drafted from the predictive risk model. ${evidenceFor(factor)}\n\nRecommended action: ${detail}`,
  };
}
