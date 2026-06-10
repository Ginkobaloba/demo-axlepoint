import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  ClipboardList,
  Timer,
} from "lucide-react";
import { RiskBar, RiskChip, SeverityChip } from "@/components/badges";
import { fmtAgo, fmtNumber } from "@/lib/format";
import {
  getKpis,
  getRecentAnomalies,
  getRiskBandCounts,
  getTopRiskAssets,
} from "@/lib/queries";
import { RISK_BAND_LABELS, type RiskBand } from "@/lib/types";

export const dynamic = "force-dynamic";

const BAND_ORDER: RiskBand[] = ["critical", "high", "medium", "low"];
const BAND_BAR: Record<RiskBand, string> = {
  low: "bg-risk-low",
  medium: "bg-risk-medium",
  high: "bg-risk-high",
  critical: "bg-risk-critical",
};

export default function DashboardPage() {
  const kpis = getKpis();
  const topAssets = getTopRiskAssets(10);
  const anomalies = getRecentAnomalies(10);
  const bandCounts = getRiskBandCounts();
  const total = bandCounts.reduce((s, b) => s + b.c, 0);
  const countFor = (band: RiskBand) =>
    bandCounts.find((b) => b.risk_band === band)?.c ?? 0;

  const mtbfUp = kpis.mtbfDeltaPct >= 0;

  const KPI_CARDS = [
    {
      label: "Assets monitored",
      value: fmtNumber(kpis.assetsMonitored),
      icon: Boxes,
      detail: "across 8 sites",
    },
    {
      label: "Critical risk",
      value: String(kpis.criticalAssets),
      icon: AlertTriangle,
      detail: "assets above risk 75",
      alert: kpis.criticalAssets > 0,
    },
    {
      label: "Open work orders",
      value: String(kpis.openWorkOrders),
      icon: ClipboardList,
      detail: "open, in progress, or on parts hold",
    },
    {
      label: "Fleet MTBF (30d)",
      value: `${fmtNumber(kpis.mtbfHours)} h`,
      icon: Timer,
      detail: `${mtbfUp ? "+" : ""}${kpis.mtbfDeltaPct}% vs prior 30d`,
      trendUp: mtbfUp,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operations dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Fleet condition, live anomaly feed, and maintenance posture at a glance.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI_CARDS.map((k) => (
          <div key={k.label} className="card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {k.label}
              </p>
              <k.icon
                className={`h-4 w-4 ${k.alert ? "text-risk-critical" : "text-ink-faint"}`}
              />
            </div>
            <p
              className={`mt-2 font-mono text-3xl font-semibold ${
                k.alert ? "text-risk-critical" : "text-ink"
              }`}
            >
              {k.value}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-faint">
              {k.trendUp !== undefined &&
                (k.trendUp ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-risk-low" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-risk-high" />
                ))}
              {k.detail}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Left column: distribution + risk table */}
        <div className="space-y-6 xl:col-span-2">
          {/* Fleet risk distribution */}
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Fleet risk distribution</h2>
              <Link
                href="/app/assets"
                className="text-xs font-medium text-forest hover:underline"
              >
                View all assets
              </Link>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-line">
              {BAND_ORDER.map((band) => {
                const c = countFor(band);
                if (!c) return null;
                return (
                  <div
                    key={band}
                    className={BAND_BAR[band]}
                    style={{ width: `${(c / total) * 100}%` }}
                    title={`${RISK_BAND_LABELS[band]}: ${c}`}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
              {BAND_ORDER.map((band) => (
                <Link
                  key={band}
                  href={`/app/assets?band=${band}`}
                  className="flex items-center gap-1.5 hover:text-ink"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${BAND_BAR[band]}`}
                  />
                  {RISK_BAND_LABELS[band]}
                  <span className="font-mono font-semibold">
                    {countFor(band)}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* Highest risk assets */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Highest failure risk</h2>
              <span className="text-xs text-ink-faint">
                rolling 7-day anomaly window
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Location</th>
                    <th>Band</th>
                    <th className="text-right">Risk score</th>
                  </tr>
                </thead>
                <tbody>
                  {topAssets.map((a) => (
                    <tr key={a.id} className="hover:bg-cream/60">
                      <td>
                        <Link
                          href={`/app/assets/${a.id}`}
                          className="font-medium text-forest hover:underline"
                        >
                          {a.name}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-ink-faint">
                          {a.id}
                        </span>
                      </td>
                      <td className="text-ink-soft">{a.location}</td>
                      <td>
                        <RiskChip band={a.risk_band} />
                      </td>
                      <td>
                        <RiskBar
                          score={a.risk_score}
                          band={a.risk_band}
                          className="justify-end"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right rail: anomaly feed */}
        <div className="card self-start overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Activity className="h-4 w-4 text-forest" />
            <h2 className="text-sm font-semibold">Recent anomalies</h2>
          </div>
          <ul className="divide-y divide-line/60">
            {anomalies.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/app/assets/${a.asset_id}`}
                    className="text-sm font-medium text-forest hover:underline"
                  >
                    {a.asset_name}
                  </Link>
                  <SeverityChip severity={a.severity} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                  {a.note}
                </p>
                <p className="mt-1 text-xs text-ink-faint">
                  {a.asset_location} - {fmtAgo(a.ts)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
