import { NextResponse, type NextRequest } from "next/server";
import {
  getAsset,
  getAssetAnomalies,
  getGeneratedAt,
  getReadings,
} from "@/lib/queries";
import type { SensorType } from "@/lib/types";

const RANGES: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "6mo": 183,
};

const SENSORS: SensorType[] = [
  "vibration",
  "temperature",
  "oil_pressure",
  "cylinder_pressure",
  "rpm",
  "fuel_rate",
];

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const asset = getAsset(params.id);
  if (!asset) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }
  const sensor = request.nextUrl.searchParams.get("sensor") as SensorType;
  const range = request.nextUrl.searchParams.get("range") ?? "7d";
  if (!SENSORS.includes(sensor) || !RANGES[range]) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const now = getGeneratedAt();
  const fromTs = now - RANGES[range] * 86400;
  const series = getReadings(params.id, sensor, fromTs);
  const anomalies = getAssetAnomalies(params.id, fromTs)
    .filter((a) => a.sensor_type === sensor)
    .map((a) => ({ ts: a.ts, value: a.value, z: a.z_score, severity: a.severity }));

  return NextResponse.json({ series, anomalies });
}
