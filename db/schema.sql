-- AxlePoint on Postgres: schema with per-tenant row isolation.
--
-- Ported from the SQLite DDL in scripts/generate-db.ts. Three things changed,
-- and each is a decision rather than a translation:
--
-- 1. EVERY TABLE CARRIES tenant_id, AND PRIMARY KEYS ARE COMPOSITE.
--    The SQLite schema uses `id TEXT PRIMARY KEY`. Kept global, asset 'A-1001'
--    could exist for exactly ONE tenant, so every tenant would need rewritten
--    ids -- which breaks the generated demo data and makes "restore tenant
--    sample" impossible without renaming rows. (tenant_id, id) lets each
--    tenant hold its own copy of the same seed, which is precisely what the
--    demo reset needs.
--
-- 2. anomalies.id was INTEGER PRIMARY KEY AUTOINCREMENT.
--    Now GENERATED ALWAYS AS IDENTITY. Identity is per-table, not per-tenant,
--    so ids are unique across tenants; that is fine because the primary key is
--    (tenant_id, id) and nothing reads meaning into the number.
--
-- 3. RLS IS APPLIED FROM THE CATALOG, NOT BY HAND.
--    The realistic failure is not getting a policy wrong, it is adding table
--    eleven a month from now and forgetting it entirely -- a silent,
--    total leak of that table with everything else looking correct. The DO
--    block at the bottom walks every table in the schema, so a new table is
--    protected by construction. tests/rls-coverage asserts the same property
--    from the other side, so the two cannot drift quietly.
--
-- RLS is defence in depth, NOT the primary control. Tenant filtering in the
-- WHERE clause stays primary, because it is testable without a database and
-- does not depend on a driver's transaction semantics. See
-- C:\dev\AXLEPOINT_WORKERS_FEASIBILITY_2026-09-25.md section 3.

CREATE TABLE meta (
  tenant_id text NOT NULL,
  key       text NOT NULL,
  value     text NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE assets (
  tenant_id    text NOT NULL,
  id           text NOT NULL,
  name         text NOT NULL,
  type         text NOT NULL,
  model        text NOT NULL,
  serial       text NOT NULL,
  location     text NOT NULL,
  installed_on text NOT NULL,
  run_hours    integer NOT NULL,
  status       text NOT NULL,
  criticality  text NOT NULL,
  risk_score   double precision NOT NULL,
  risk_band    text NOT NULL,
  risk_factors text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE sensor_readings (
  tenant_id   text NOT NULL,
  asset_id    text NOT NULL,
  sensor_type text NOT NULL,
  ts          bigint NOT NULL,
  value       double precision NOT NULL
);
CREATE INDEX idx_readings ON sensor_readings (tenant_id, asset_id, sensor_type, ts);

CREATE TABLE anomalies (
  tenant_id   text NOT NULL,
  id          bigint GENERATED ALWAYS AS IDENTITY,
  asset_id    text NOT NULL,
  sensor_type text NOT NULL,
  ts          bigint NOT NULL,
  value       double precision NOT NULL,
  z_score     double precision NOT NULL,
  severity    text NOT NULL,
  note        text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX idx_anomalies_asset ON anomalies (tenant_id, asset_id, ts);
CREATE INDEX idx_anomalies_ts    ON anomalies (tenant_id, ts);

CREATE TABLE work_orders (
  tenant_id    text NOT NULL,
  id           text NOT NULL,
  asset_id     text NOT NULL,
  title        text NOT NULL,
  description  text NOT NULL,
  status       text NOT NULL,
  priority     text NOT NULL,
  type         text NOT NULL,
  assigned_to  text,
  created_at   bigint NOT NULL,
  due_at       bigint,
  completed_at bigint,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX idx_wo_asset  ON work_orders (tenant_id, asset_id);
CREATE INDEX idx_wo_status ON work_orders (tenant_id, status);

CREATE TABLE parts (
  tenant_id      text NOT NULL,
  id             text NOT NULL,
  sku            text NOT NULL,
  name           text NOT NULL,
  category       text NOT NULL,
  qty_on_hand    integer NOT NULL,
  reorder_point  integer NOT NULL,
  unit_cost      double precision NOT NULL,
  lead_time_days integer NOT NULL,
  supplier       text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE work_order_parts (
  tenant_id     text NOT NULL,
  work_order_id text NOT NULL,
  part_id       text NOT NULL,
  qty           integer NOT NULL
);
CREATE INDEX idx_wop ON work_order_parts (tenant_id, work_order_id);

CREATE TABLE technicians (
  tenant_id      text NOT NULL,
  id             text NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL,
  location       text NOT NULL,
  certifications text NOT NULL,
  phone          text NOT NULL,
  email          text NOT NULL,
  hired_on       text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE maintenance_schedule (
  tenant_id     text NOT NULL,
  id            text NOT NULL,
  asset_id      text NOT NULL,
  task          text NOT NULL,
  interval_days integer NOT NULL,
  next_due      text NOT NULL,
  assigned_to   text,
  est_hours     double precision NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE purchase_orders (
  tenant_id   text NOT NULL,
  id          text NOT NULL,
  supplier    text NOT NULL,
  status      text NOT NULL,
  created_at  bigint NOT NULL,
  ordered_at  bigint,
  expected_at bigint,
  received_at bigint,
  notes       text,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE purchase_order_lines (
  tenant_id text NOT NULL,
  po_id     text NOT NULL,
  part_id   text NOT NULL,
  qty       integer NOT NULL,
  unit_cost double precision NOT NULL,
  -- One line per part per PO, per tenant. The reorder total and the
  -- receive-restock both assume this; the constraint enforces it rather than
  -- trusting convention. Carried over from the SQLite schema, now scoped.
  UNIQUE (tenant_id, po_id, part_id)
);
CREATE INDEX idx_po_lines ON purchase_order_lines (tenant_id, po_id);

-- ---------------------------------------------------------------------------
-- Row level security, applied to EVERY table in this schema.
--
-- FORCE is not optional and is the trap that silently invalidates naive RLS
-- setups: Postgres does NOT apply a policy to a table's OWNER unless the table
-- is FORCEd, and the role an app connects as is usually the owner of what it
-- created. Without FORCE every policy below is inert while looking correct.
--
-- current_setting('app.tenant_id', true) returns NULL when unset, so the
-- comparison is NULL, so no rows match. Unset means see nothing, which is the
-- right direction to fail.
--
-- WITH CHECK is stated EXPLICITLY here, and is deliberately redundant. When
-- WITH CHECK is omitted Postgres uses the USING expression for new rows as
-- well, so writes are already covered -- verified by mutation: deleting the
-- WITH CHECK line below changes no test result, because nothing changes. It is
-- kept because the read rule and the write rule being the same is a CHOICE,
-- and spelling it out means a future edit to USING cannot silently alter what
-- this tenant is allowed to write. Do not read it as the thing that stops
-- cross-tenant INSERTs; USING already does that.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema()
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING      (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    $f$, t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- THE APPLICATION ROLE, and why every policy above is worthless without it.
--
-- RLS DOES NOT APPLY TO A SUPERUSER. Not with ENABLE, not with FORCE: BYPASSRLS
-- is implicit for superusers and FORCE cannot override it. The postgres Docker
-- image creates POSTGRES_USER as a superuser, so connecting as it made every
-- policy above silently inert -- measured 2026-09-25, where an unscoped SELECT
-- returned both tenants' rows and tenant A successfully INSERTed a row tagged
-- tenant B, with a schema that reads as completely correct.
--
-- That is the most dangerous shape a security control can take: right on paper,
-- absent at runtime, and invisible to any test whose queries already filter by
-- tenant in their WHERE clause.
--
-- So the app connects as THIS role, which is neither superuser nor the owner of
-- the tables, and is explicitly NOBYPASSRLS. On Neon the default role is not a
-- superuser but IS the owner of what it creates, which is the case FORCE above
-- exists for; the two together cover both deployments.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axlepoint_app') THEN
    CREATE ROLE axlepoint_app LOGIN PASSWORD 'axlepoint_app';
  END IF;
END
$$;

-- The ALTER is UNCONDITIONAL, and that is the point. Roles are CLUSTER-level,
-- so DROP SCHEMA never removes them and a "CREATE ROLE IF NOT EXISTS" runs
-- exactly once in the life of a database. Putting the security attributes on
-- the CREATE therefore makes them UNENFORCEABLE: change them here and nothing
-- happens, forever, because the role already exists. Found by mutation on
-- 2026-09-25 -- granting BYPASSRLS in the CREATE left every test green,
-- because the CREATE never ran. Re-asserting them on every apply is what makes
-- this file the authority on what the role may do.
ALTER ROLE axlepoint_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT USAGE ON SCHEMA public TO axlepoint_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO axlepoint_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO axlepoint_app;
