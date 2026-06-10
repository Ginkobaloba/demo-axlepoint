"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SENSOR_LABELS, type SensorType } from "@/lib/types";

const FOREST = "#1f5a44";
const FOREST_LIGHT = "#2d7a5d";
const GOLD = "#c89c47";
const INK_FAINT = "#8a877e";
const LINE = "#e4e0d6";
const PALETTE = [
  "#1f5a44",
  "#c89c47",
  "#2d7a5d",
  "#b65d3e",
  "#4a4a45",
  "#8c2e1f",
];

const tooltipStyle = {
  borderRadius: 8,
  border: `1px solid ${LINE}`,
  fontSize: 12,
  background: "#ffffff",
};

const axisTick = { fontSize: 11, fill: INK_FAINT };

export function WoThroughputChart({
  data,
}: {
  data: { month: string; opened: number; closed: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={LINE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={axisTick} stroke={LINE} />
        <YAxis tick={axisTick} stroke={LINE} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f7f5f0" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="opened" name="Opened" fill={GOLD} radius={[3, 3, 0, 0]} />
        <Bar dataKey="closed" name="Closed" fill={FOREST} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AnomalyTrendChart({
  data,
}: {
  data: { day: string; c: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={LINE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tick={axisTick} stroke={LINE} minTickGap={32} />
        <YAxis tick={axisTick} stroke={LINE} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line
          dataKey="c"
          name="Anomalies"
          type="monotone"
          stroke={FOREST}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AnomalyBySensorChart({
  data,
}: {
  data: { sensor_type: string; c: number }[];
}) {
  const named = data.map((d) => ({
    name: SENSOR_LABELS[d.sensor_type as SensorType] ?? d.sensor_type,
    value: d.c,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={named}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="82%"
          paddingAngle={2}
          strokeWidth={0}
        >
          {named.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          wrapperStyle={{ fontSize: 12 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function RiskByLocationChart({
  data,
}: {
  data: { location: string; avgScore: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 16, bottom: 0, left: 36 }}
      >
        <CartesianGrid stroke={LINE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={axisTick} stroke={LINE} domain={[0, 100]} />
        <YAxis
          type="category"
          dataKey="location"
          tick={{ ...axisTick, width: 150 }}
          stroke={LINE}
          width={150}
          tickFormatter={(v: string) => v.replace(" Station", "").replace(" Maintenance", "")}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f7f5f0" }} />
        <Bar dataKey="avgScore" name="Avg risk" fill={FOREST_LIGHT} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PartsSpendChart({
  data,
}: {
  data: { category: string; spend: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 24, left: -8 }}
      >
        <CartesianGrid stroke={LINE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="category"
          tick={{ ...axisTick, fontSize: 10 }}
          stroke={LINE}
          angle={-28}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tick={axisTick}
          stroke={LINE}
          tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "#f7f5f0" }}
          formatter={(v) => [
            `$${Number(v ?? 0).toLocaleString()}`,
            "Committed spend",
          ]}
        />
        <Bar dataKey="spend" fill={GOLD} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function WoMixChart({
  data,
}: {
  data: { type: string; open: number; in_progress: number; awaiting_parts: number; closed: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={LINE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="type" tick={axisTick} stroke={LINE} className="capitalize" />
        <YAxis tick={axisTick} stroke={LINE} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f7f5f0" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="open" name="Open" stackId="s" fill={GOLD} />
        <Bar dataKey="in_progress" name="In progress" stackId="s" fill={FOREST_LIGHT} />
        <Bar dataKey="awaiting_parts" name="Awaiting parts" stackId="s" fill="#b65d3e" />
        <Bar dataKey="closed" name="Closed" stackId="s" fill="#4a4a45" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
