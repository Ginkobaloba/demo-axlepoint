import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

/**
 * Postgres counterpart to seedFixtureDb() in axlepoint-fixtures.ts.
 *
 * Same three rows, same reasoning. In particular the seed work order stays
 * PRE-ASSIGNED to TCH-01 rather than NULL: deep-verify PR #24 blocker B1
 * attacked an existing row's assigned_to, and a test that only asserts "the
 * marker did not land" is trivially true against a column that started empty.
 * Starting from a real value is what lets those tests assert the rejected
 * write left the original value untouched.
 *
 * Takes an ADMIN pool. Applying the schema and seeding are setup, not
 * application behaviour; the tests themselves go through withTenant() as the
 * app does, which is the only way they exercise the tenant scoping.
 */
export const FIXTURE_TENANT = "fixture";

export async function seedFixturePg(
  admin: Pool,
  tenantId: string = FIXTURE_TENANT,
): Promise<void> {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "db", "schema.sql"),
    "utf8",
  );
  await admin.query("DROP SCHEMA IF EXISTS pristine CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await admin.query(schema);
  // schema.sql deliberately ships no password; set one for local connections.
  await admin.query("ALTER ROLE axlepoint_app PASSWORD 'axlepoint_app'");

  await admin.query(
    `INSERT INTO meta (tenant_id, key, value)
     VALUES ($1, 'wo_seq', '150'), ($1, 'po_seq', '13'),
            ($1, 'generated_at', '1700000000')`,
    [tenantId],
  );
  await admin.query(
    `INSERT INTO assets (
       tenant_id, id, name, type, model, serial, location, installed_on,
       run_hours, status, criticality, risk_score, risk_band, risk_factors
     ) VALUES (
       $1, 'AST-01', 'Meridian V12T #04', 'engine', 'Meridian V12T', 'SN-0001',
       'Lake Erie Power Station', '2020-01-01', 12000, 'operational',
       'important', 22.5, 'low',
       '[{"sensor":"oil_pressure","label":"Oil pressure","contribution":30,"anomalies7d":4,"trendPct7d":12}]'
     )`,
    [tenantId],
  );
  await admin.query(
    `INSERT INTO technicians (
       tenant_id, id, name, role, location, certifications, phone, email, hired_on
     ) VALUES (
       $1, 'TCH-01', 'Sam Rivera', 'Senior Technician', 'Lake Erie Power Station',
       '[]', '555-0100', 'srivera@example.test', '2019-03-01'
     )`,
    [tenantId],
  );
  await admin.query(
    `INSERT INTO work_orders (
       tenant_id, id, asset_id, title, description, status, priority, type,
       assigned_to, created_at, due_at, completed_at
     ) VALUES (
       $1, 'WO-1', 'AST-01', 'Seeded quarterly inspection', 'Seed description text',
       'open', 'medium', 'inspection', 'TCH-01', 1700000000, NULL, NULL
     )`,
    [tenantId],
  );
}
