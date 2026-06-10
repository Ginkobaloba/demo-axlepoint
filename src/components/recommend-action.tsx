"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { RiskFactor } from "@/lib/types";

const ACTION_BY_SENSOR: Record<string, [string, string]> = {
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

/**
 * Drafts a predictive work order pre-populated from the asset's current
 * anomaly pattern, then navigates to the draft for review.
 */
export function RecommendActionButton({
  assetId,
  assetName,
  topFactor,
}: {
  assetId: string;
  assetName: string;
  topFactor: RiskFactor | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const factor = topFactor;
  const [action, detail] = factor
    ? ACTION_BY_SENSOR[factor.sensor]
    : ACTION_BY_SENSOR.vibration;

  const submit = async () => {
    setBusy(true);
    try {
      const evidence = factor
        ? `Driving signal: ${factor.label.toLowerCase()} with ${factor.anomalies7d} anomalies in the last 7 days` +
          (Math.abs(factor.trendPct7d) >= 2
            ? ` and a ${factor.trendPct7d > 0 ? "+" : ""}${factor.trendPct7d}% 7-day trend.`
            : ".")
        : "Driving signal: elevated composite risk score.";
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: assetId,
          title: `${action} - ${assetName} (${assetId})`,
          description: `Drafted from the predictive risk model. ${evidence}\n\nRecommended action: ${detail}`,
          priority: "high",
          type: "predictive",
        }),
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const data = (await res.json()) as { url: string };
      router.push(data.url);
    } catch {
      setBusy(false);
      alert("Could not draft the work order. Try again.");
    }
  };

  return (
    <button onClick={submit} disabled={busy} className="btn-gold w-full">
      <Sparkles className="h-4 w-4" />
      {busy ? "Drafting work order..." : "Recommend Preventive Action"}
    </button>
  );
}
