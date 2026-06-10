import {
  AnomalyBySensorChart,
  AnomalyTrendChart,
  PartsSpendChart,
  RiskByLocationChart,
  WoMixChart,
  WoThroughputChart,
} from "@/components/report-charts";
import {
  getAnomaliesByDay,
  getAnomaliesBySensor,
  getPartsSpendByCategory,
  getRiskByLocation,
  getWoByTypeAndStatus,
  getWoMonthlyThroughput,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reports" };

function Tile({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card flex h-80 flex-col">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-ink-faint">{detail}</p>
      </div>
      <div className="min-h-0 flex-1 p-2">{children}</div>
    </div>
  );
}

export default function ReportsPage() {
  const throughput = getWoMonthlyThroughput();
  const anomalyTrend = getAnomaliesByDay(30);
  const bySensor = getAnomaliesBySensor();
  const byLocation = getRiskByLocation();
  const spend = getPartsSpendByCategory().slice(0, 8);
  const mixRaw = getWoByTypeAndStatus();

  const mix = ["corrective", "preventive", "inspection", "predictive"].map(
    (type) => ({
      type,
      open: mixRaw.find((r) => r.type === type && r.status === "open")?.c ?? 0,
      in_progress:
        mixRaw.find((r) => r.type === type && r.status === "in_progress")?.c ?? 0,
      awaiting_parts:
        mixRaw.find((r) => r.type === type && r.status === "awaiting_parts")?.c ?? 0,
      closed:
        mixRaw.find((r) => r.type === type && r.status === "closed")?.c ?? 0,
    }),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Canned operational reports over the demo dataset. Production
          deployments add scheduled exports and per-site drill-downs.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Tile
          title="Work order throughput"
          detail="Opened vs closed, by month"
        >
          <WoThroughputChart data={throughput} />
        </Tile>
        <Tile title="Anomaly volume" detail="Detected anomalies per day, last 30 days">
          <AnomalyTrendChart data={anomalyTrend} />
        </Tile>
        <Tile title="Anomalies by sensor channel" detail="Six-month detection mix">
          <AnomalyBySensorChart data={bySensor} />
        </Tile>
        <Tile title="Average failure risk by site" detail="Current fleet posture">
          <RiskByLocationChart data={byLocation} />
        </Tile>
        <Tile title="Committed parts spend" detail="By category, across all work orders">
          <PartsSpendChart data={spend} />
        </Tile>
        <Tile title="Work order mix" detail="Status by maintenance type">
          <WoMixChart data={mix} />
        </Tile>
      </div>
    </div>
  );
}
