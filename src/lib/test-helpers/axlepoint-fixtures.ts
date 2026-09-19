import Database from "better-sqlite3";
import fs from "node:fs";

/**
 * Minimal schema for tests that need a real SQLite file at a temp path
 * (db.ts and the /api/work-orders route tests, D-012). Mirrors the tables
 * scripts/generate-db.ts creates, trimmed to the columns those tests touch.
 * Not shared with the generator on purpose: this file exists to catch
 * regressions in db.ts / the route, not to be the schema's source of truth.
 */
export const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  model TEXT NOT NULL,
  serial TEXT NOT NULL,
  location TEXT NOT NULL,
  installed_on TEXT NOT NULL,
  run_hours INTEGER NOT NULL,
  status TEXT NOT NULL,
  criticality TEXT NOT NULL,
  risk_score REAL NOT NULL,
  risk_band TEXT NOT NULL,
  risk_factors TEXT NOT NULL
);

CREATE TABLE work_orders (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  type TEXT NOT NULL,
  assigned_to TEXT,
  created_at INTEGER NOT NULL,
  due_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE work_order_parts (
  work_order_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  qty INTEGER NOT NULL
);

CREATE TABLE parts (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  qty_on_hand INTEGER NOT NULL,
  reorder_point INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  lead_time_days INTEGER NOT NULL,
  supplier TEXT NOT NULL
);

CREATE TABLE technicians (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT NOT NULL,
  certifications TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  hired_on TEXT NOT NULL
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  supplier TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ordered_at INTEGER,
  expected_at INTEGER,
  received_at INTEGER,
  notes TEXT
);

CREATE TABLE purchase_order_lines (
  po_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  UNIQUE (po_id, part_id)
);
`;

function removeSidecars(dbPath: string): void {
  for (const ext of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${ext}`, { force: true });
  }
}

/**
 * Creates a fresh fixture database at dbPath with the schema above, one
 * asset, one technician, and one seed work order. Returns nothing; open it
 * with getDb() (env-pointed at dbPath) or a direct better-sqlite3 handle.
 */
export function seedFixtureDb(dbPath: string): void {
  removeSidecars(dbPath);
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  db.exec(`
    INSERT INTO meta (key, value) VALUES ('wo_seq', '150'), ('po_seq', '13');
    INSERT INTO assets (
      id, name, type, model, serial, location, installed_on, run_hours,
      status, criticality, risk_score, risk_band, risk_factors
    ) VALUES (
      'AST-01', 'Meridian V12T #04', 'engine', 'Meridian V12T', 'SN-0001',
      'Lake Erie Power Station', '2020-01-01', 12000, 'operational',
      'important', 22.5, 'low',
      '[{"sensor":"oil_pressure","label":"Oil pressure","contribution":30,"anomalies7d":4,"trendPct7d":12}]'
    );
    INSERT INTO technicians (
      id, name, role, location, certifications, phone, email, hired_on
    ) VALUES (
      'TCH-01', 'Sam Rivera', 'Senior Technician', 'Lake Erie Power Station',
      '[]', '555-0100', 'srivera@example.test', '2019-03-01'
    );
    INSERT INTO work_orders (
      id, asset_id, title, description, status, priority, type,
      assigned_to, created_at, due_at, completed_at
    ) VALUES (
      'WO-1', 'AST-01', 'Seeded quarterly inspection', 'Seed description text',
      'open', 'medium', 'inspection', NULL, 1700000000, NULL, NULL
    );
  `);
  db.close();
}
