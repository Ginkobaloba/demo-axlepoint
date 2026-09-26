import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { refuseIfNotOurDatabase } from "@/lib/scratch-db-guard";
import { withTenant, closePool } from "@/lib/pg";
import { getAssetAnomalies, getReadings } from "@/lib/queries";
import { sensorAxisTicks, tickLabel } from "@/lib/chart-ticks";

/**
 * Do the chart queries return NUMBERS? Integration test: needs a real Postgres,
 * because this failure cannot be reproduced without one.
 *
 * MEASURED 2026-09-26 on the live-equivalent build. `ts` is a bigint, and
 * node-postgres hands bigints back as STRINGS to avoid silently losing
 * precision above 2^53. pg.ts registers an int8 parser to undo that, and the
 * parser DID NOT TAKE EFFECT in the built Next server: the readings endpoint
 * served { ts: "1789797600" } while TypeScript insisted `ts: number`.
 *
 * Nothing failed. The line still drew, the anomaly markers still drew, the
 * y-axis still drew. Only the x-axis labels vanished, because string bounds are
 * rejected by Number.isFinite, so the tick list came back empty and no error
 * was raised anywhere. A chart with a line and no time axis looks like a design
 * choice, not a bug.
 *
 * The unit tests could not catch it: they feed the function numbers, which is
 * precisely what the database does NOT return. Only a real Postgres shows it,
 * which is why this file exists and why it refuses to skip when one is absent.
 */

const TENANT = "bigint-check";
const ASSET = "AST-9001";
const DAY = 86400;
const BASE = 1_700_000_000;

let admin: Pool;

function requireScratchDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. This test DROPS AND RECREATES the public " +
        "schema, so it refuses to guess. Start one with: npm run db:dev",
    );
  }
  for (const smell of ["neon.tech", "prod", "portal"]) {
    if (url.toLowerCase().includes(smell)) {
      throw new Error(
        `DATABASE_URL contains "${smell}". Refusing: this test drops schemas.`,
      );
    }
  }
  return url;
}

function appUrlFrom(adminUrl: string): string {
  const u = new URL(adminUrl);
  u.username = "axlepoint_app";
  u.password = "axlepoint_app";
  return u.toString();
}

beforeAll(async () => {
  const adminUrl = requireScratchDatabase();
  admin = new Pool({ connectionString: adminUrl });

  await refuseIfNotOurDatabase((sql) => admin.query(sql));
  await admin.query(
    fs.readFileSync(path.join(process.cwd(), "db", "reset-schemas.sql"), "utf8"),
  );
  await admin.query(
    fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"),
  );
  await admin.query("ALTER ROLE axlepoint_app PASSWORD 'axlepoint_app'");

  // Everything below goes through the app role, as the app does.
  process.env.DATABASE_URL = appUrlFrom(adminUrl);

  await withTenant(TENANT, async (db) => {
    await db.query(
      `INSERT INTO assets (tenant_id, id, name, type, model, serial, location,
                           installed_on, run_hours, status, criticality,
                           risk_score, risk_band, risk_factors)
       VALUES ($1, $2, 'Engine 9001', 'engine', 'Meridian V12T', 'SN-TEST',
               'Kestrel Bay Marine Depot', '2020-01-01', 1000, 'ok', 3,
               10, 'low', '[]')`,
      [TENANT, ASSET],
    );
    // Eight days of readings, so a 7d window has a real span to label.
    for (let i = 0; i <= 8 * 24; i++) {
      await db.query(
        `INSERT INTO sensor_readings (tenant_id, asset_id, sensor_type, ts, value)
         VALUES ($1, $2, 'vibration', $3, $4)`,
        [TENANT, ASSET, BASE + i * 3600, 2 + (i % 5) * 0.1],
      );
    }
    await db.query(
      `INSERT INTO anomalies (tenant_id, asset_id, sensor_type, ts, value,
                              z_score, severity, note)
       VALUES ($1, $2, 'vibration', $3, 9.9, 4.2, 'major', 'synthetic')`,
      [TENANT, ASSET, BASE + 2 * DAY],
    );
  });
});

afterAll(async () => {
  await closePool();
  await admin?.end();
});

describe("chart queries return numbers, not bigint strings", () => {
  it("getReadings gives ts as a NUMBER", async () => {
    const rows = await withTenant(TENANT, (db) =>
      getReadings(db, ASSET, "vibration", BASE),
    );

    expect(rows.length).toBeGreaterThan(0);
    // The regression. Before the fix this was "1700000000", a string.
    expect(typeof rows[0].ts).toBe("number");
    expect(rows.every((r) => typeof r.ts === "number")).toBe(true);
    expect(rows.every((r) => Number.isFinite(r.ts))).toBe(true);
  });

  it("getAssetAnomalies gives ts as a NUMBER", async () => {
    const rows = await withTenant(TENANT, (db) =>
      getAssetAnomalies(db, ASSET, BASE),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0].ts).toBe("number");
    expect(typeof rows[0].id).toBe("number");
  });

  it("produces a LABELLED time axis from real rows, which is the visible symptom", async () => {
    const rows = await withTenant(TENANT, (db) =>
      getReadings(db, ASSET, "vibration", BASE),
    );
    const ticks = sensorAxisTicks(rows, "7d");
    const labels = ticks.map((ts) => tickLabel(ts, "7d"));

    // Before the fix this was [] and the chart drew a line with no x-axis.
    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
