import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Info,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  AssetStatusChip,
  PriorityChip,
  RiskChip,
  SeverityChip,
  WoStatusChip,
  WoTypeChip,
} from "@/components/badges";
import { RecommendActionButton } from "@/components/recommend-action";
import { SensorChart } from "@/components/sensor-chart";
import { fmtAgo, fmtDate, fmtIsoDate, fmtNumber } from "@/lib/format";
import {
  getAsset,
  getAssetAnomalies,
  getAssetSchedule,
  getAssetSensors,
  getAssetWorkOrders,
  getGeneratedAt,
} from "@/lib/queries";
import { MODEL_CONFIDENCE } from "@/lib/risk";
import type { RiskBand, RiskFactor } from "@/lib/types";

export const dynamic = "force-dynamic";

const BAND_TEXT: Record<RiskBand, string> = {
  low: "text-risk-low",
  medium: "text-risk-medium",
  high: "text-risk-high",
  critical: "text-risk-critical",
};
const BAND_BAR: Record<RiskBand, string> = {
  low: "bg-risk-low",
  medium: "bg-risk-medium",
  high: "bg-risk-high",
  critical: "bg-risk-critical",
};

export default function AssetDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const asset = getAsset(params.id);
  if (!asset) notFound();

  const availableSensors = getAssetSensors(asset.id);
  const allFactors = JSON.parse(asset.risk_factors) as RiskFactor[];
  const factors = allFactors.filter((f) => f.contribution > 0);
  const topFactor = factors[0] ?? null;
  // Chart tabs in risk order: the default tab is the sensor driving the
  // score, not whatever sorts first alphabetically.
  const sensors = [
    ...allFactors.map((f) => f.sensor).filter((s) => availableSensors.includes(s)),
    ...availableSensors.filter((s) => !allFactors.some((f) => f.sensor === s)),
  ];
  const now = getGeneratedAt();
  const recentAnomalies = getAssetAnomalies(asset.id, now - 7 * 86400);
  const workOrders = getAssetWorkOrders(asset.id);
  const schedule = getAssetSchedule(asset.id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/app/assets"
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-faint hover:text-forest"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All assets
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{asset.name}</h1>
          <span className="font-mono text-sm text-ink-faint">{asset.id}</span>
          <AssetStatusChip status={asset.status} />
          <RiskChip band={asset.risk_band} />
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1.5 text-sm">
          {(
            [
              ["Model", asset.model],
              ["Serial", asset.serial],
              ["Location", asset.location],
              ["Installed", fmtIsoDate(asset.installed_on)],
              ["Run hours", fmtNumber(asset.run_hours)],
              ["Criticality", asset.criticality],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex gap-1.5">
              <dt className="text-ink-faint">{k}:</dt>
              <dd className="font-medium capitalize text-ink-soft">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Risk panel */}
        <div className="card self-start">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Failure risk score</h2>
          </div>
          <div className="p-4">
            <div className="flex items-end justify-between">
              <span
                className={`font-mono text-6xl font-semibold leading-none ${BAND_TEXT[asset.risk_band]}`}
              >
                {Math.round(asset.risk_score)}
              </span>
              <div className="text-right text-xs text-ink-faint">
                <p>
                  Model confidence{" "}
                  <span className="font-mono font-semibold text-ink-soft">
                    {MODEL_CONFIDENCE.toFixed(2)}
                  </span>
                </p>
                <p className="mt-0.5">rolling 7-day window</p>
              </div>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full ${BAND_BAR[asset.risk_band]}`}
                style={{ width: `${Math.max(3, asset.risk_score)}%` }}
              />
            </div>

            <div className="mt-4">
              <RecommendActionButton
                assetId={asset.id}
                assetName={asset.name}
                topFactor={topFactor}
              />
            </div>

            {/* Why is this score elevated? */}
            <details className="group mt-4" open={asset.risk_score >= 50}>
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-soft hover:bg-cream">
                Why is this score {asset.risk_score >= 25 ? "elevated" : "low"}?
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 space-y-3">
                {factors.length === 0 && (
                  <p className="text-sm text-ink-faint">
                    No anomaly activity in the trailing 7 days. All sensor
                    channels are tracking their baselines.
                  </p>
                )}
                {factors.map((f) => (
                  <div key={f.sensor}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{f.label}</span>
                      <span className="font-mono text-xs text-ink-soft">
                        +{f.contribution.toFixed(0)} pts
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-forest"
                        style={{
                          width: `${Math.min(100, (f.contribution / 55) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
                      {f.anomalies7d} anomalies in 7d
                      {Math.abs(f.trendPct7d) >= 2 && (
                        <span className="flex items-center gap-0.5">
                          {f.trendPct7d > 0 ? (
                            <TrendingUp className="h-3 w-3 text-risk-high" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-risk-high" />
                          )}
                          {f.trendPct7d > 0 ? "+" : ""}
                          {f.trendPct7d}% 7-day trend
                        </span>
                      )}
                    </p>
                  </div>
                ))}
                <p className="flex items-start gap-1.5 rounded-md bg-forest-tint p-2.5 text-xs leading-relaxed text-ink-soft">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" />
                  Scores aggregate severity-weighted anomaly counts and
                  sustained sensor drift over the trailing 7 days, per channel.
                </p>
              </div>
            </details>
          </div>
        </div>

        {/* Sensor telemetry */}
        <div className="space-y-6 xl:col-span-2">
          <SensorChart assetId={asset.id} sensors={sensors} />

          {/* Recent anomalies */}
          <div className="card overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">
                Anomalies, last 7 days ({recentAnomalies.length})
              </h2>
            </div>
            {recentAnomalies.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-faint">
                No anomalies detected in the last 7 days.
              </p>
            ) : (
              <ul className="max-h-64 divide-y divide-line/60 overflow-y-auto">
                {recentAnomalies.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-3 px-4 py-2.5"
                  >
                    <div>
                      <p className="text-sm text-ink-soft">{a.note}</p>
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {fmtAgo(a.ts)}
                      </p>
                    </div>
                    <SeverityChip severity={a.severity} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Service history */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Service history</h2>
            <Link
              href={`/app/work-orders/new?asset=${asset.id}`}
              className="text-xs font-medium text-forest hover:underline"
            >
              New work order
            </Link>
          </div>
          {workOrders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-faint">
              No work orders on record for this asset.
            </p>
          ) : (
            <ul className="divide-y divide-line/60">
              {workOrders.slice(0, 8).map((w) => (
                <li key={w.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/work-orders/${w.id}`}
                      className="text-sm font-medium text-forest hover:underline"
                    >
                      {w.id}
                    </Link>
                    <WoStatusChip status={w.status} />
                    <WoTypeChip type={w.type} />
                    <PriorityChip priority={w.priority} />
                  </div>
                  <p className="mt-1 truncate text-sm text-ink-soft">
                    {w.title}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Created {fmtDate(w.created_at)}
                    {w.technician_name ? ` - ${w.technician_name}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upcoming PM */}
        <div className="card self-start overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Preventive schedule</h2>
          </div>
          {schedule.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-faint">
              No scheduled preventive tasks.
            </p>
          ) : (
            <ul className="divide-y divide-line/60">
              {schedule.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{s.task}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      every {s.interval_days} days
                      {s.technician_name ? ` - ${s.technician_name}` : ""} -{" "}
                      {s.est_hours}h est
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-semibold text-ink-soft">
                    {fmtIsoDate(s.next_due)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
