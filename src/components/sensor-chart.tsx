"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { cn } from "@/lib/cn";
import { SENSOR_LABELS, SENSOR_UNITS, type SensorType } from "@/lib/types";

const RANGES = ["24h", "7d", "30d", "6mo"] as const;
type Range = (typeof RANGES)[number];

interface Point {
  ts: number;
  value: number;
}

interface AnomalyPoint extends Point {
  z: number;
  severity: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  minor: "#c89c47",
  major: "#b65d3e",
  severe: "#8c2e1f",
};

export function SensorChart({
  assetId,
  sensors,
}: {
  assetId: string;
  sensors: SensorType[];
}) {
  const [sensor, setSensor] = useState<SensorType>(sensors[0]);
  const [range, setRange] = useState<Range>("7d");
  const [series, setSeries] = useState<Point[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/assets/${assetId}/readings?sensor=${sensor}&range=${range}`,
      );
      const data = (await res.json()) as {
        series: Point[];
        anomalies: AnomalyPoint[];
      };
      setSeries(data.series);
      setAnomalies(data.anomalies);
    } finally {
      setLoading(false);
    }
  }, [assetId, sensor, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const tickFormat = (ts: number) =>
    format(new Date(ts * 1000), range === "24h" ? "HH:mm" : range === "6mo" ? "MMM" : "MMM d");

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {sensors.map((s) => (
            <button
              key={s}
              onClick={() => setSensor(s)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                s === sensor
                  ? "bg-forest text-cream"
                  : "text-ink-soft hover:bg-forest/10 hover:text-forest",
              )}
            >
              {SENSOR_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-md px-2.5 py-1.5 font-mono text-xs font-medium transition-colors",
                r === range
                  ? "bg-ink text-cream"
                  : "text-ink-soft hover:bg-ink/10",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-72 px-2 py-3">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-panel/60 text-xs text-ink-faint">
            Loading telemetry...
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e4e0d6" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={tickFormat}
              tick={{ fontSize: 11, fill: "#8a877e" }}
              stroke="#e4e0d6"
              minTickGap={48}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 11, fill: "#8a877e" }}
              stroke="#e4e0d6"
              width={52}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              labelFormatter={(ts) =>
                format(new Date(Number(ts) * 1000), "MMM d, yyyy HH:mm")
              }
              formatter={(value, name) => [
                `${Number(value ?? 0).toFixed(2)} ${SENSOR_UNITS[sensor]}`,
                name === "value" ? SENSOR_LABELS[sensor] : "Anomaly",
              ]}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e4e0d6",
                fontSize: 12,
                background: "#ffffff",
              }}
            />
            <Line
              dataKey="value"
              type="monotone"
              stroke="#1f5a44"
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={false}
            />
            <Scatter
              data={anomalies}
              dataKey="value"
              isAnimationActive={false}
              shape={(props: { cx?: number; cy?: number; payload?: AnomalyPoint }) => (
                <circle
                  cx={props.cx}
                  cy={props.cy}
                  r={4}
                  fill={SEVERITY_COLOR[props.payload?.severity ?? "minor"]}
                  stroke="#ffffff"
                  strokeWidth={1}
                />
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-ink-faint">
        <span>
          {SENSOR_LABELS[sensor]} ({SENSOR_UNITS[sensor]}), {series.length}{" "}
          readings
        </span>
        <span className="flex items-center gap-3">
          {Object.entries(SEVERITY_COLOR).map(([sev, color]) => (
            <span key={sev} className="flex items-center gap-1 capitalize">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: color }}
              />
              {sev}
            </span>
          ))}
          <span>{anomalies.length} anomalies in range</span>
        </span>
      </div>
    </div>
  );
}
