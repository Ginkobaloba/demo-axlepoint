"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { RiskFactor } from "@/lib/types";
import { ACTION_BY_SENSOR } from "@/lib/predictive-action";

/**
 * Drafts a predictive work order pre-populated from the asset's current
 * anomaly pattern, then navigates to the draft for review.
 *
 * The title/description this button sends are a preview only: POST
 * /api/work-orders re-derives both from the asset's own risk_factors on
 * the server (src/lib/predictive-action.ts) and ignores what is submitted
 * here, same as every other visitor-typed field (D-012). Kept in sync by
 * sharing the ACTION_BY_SENSOR table rather than duplicating it.
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
