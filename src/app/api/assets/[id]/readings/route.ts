import { NextResponse, type NextRequest } from "next/server";
import {
  getAsset,
  getAssetAnomalies,
  getGeneratedAt,
  getReadings,
} from "@/lib/queries";
import { withCurrentTenant } from "@/lib/tenant";
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

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  // Validate everything that does NOT need the database first, so a bad
  // request never opens a transaction at all.
  const sensor = request.nextUrl.searchParams.get("sensor") as SensorType;
  const range = request.nextUrl.searchParams.get("range") ?? "7d";
  if (!SENSORS.includes(sensor) || !RANGES[range]) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // One transaction for all three reads: the asset check, the series and the
  // anomalies now come from a single consistent snapshot, which the SQLite
  // version could not guarantee across separate statements.
  const result = await withCurrentTenant(async (db) => {
    const asset = await getAsset(db, params.id);
    if (!asset) return null;

    const now = await getGeneratedAt(db);
    const fromTs = now - RANGES[range] * 86400;
    const series = await getReadings(db, params.id, sensor, fromTs);
    const anomalies = (await getAssetAnomalies(db, params.id, fromTs))
      .filter((a) => a.sensor_type === sensor)
      .map((a) => ({ ts: a.ts, value: a.value, z: a.z_score, severity: a.severity }));
    return { series, anomalies };
  });

  if (!result) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
