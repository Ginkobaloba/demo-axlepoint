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
-- 2. anomalies.id was INTEGER PRIMARY KEY AUTOINCREMENT, and is now a uuid.
--    An identity column is backed by ONE sequence shared by every tenant, and
--    SELECT on sequences is granted to the app role, so any tenant could read
--    last_value and learn how many rows every OTHER tenant had inserted -- and
--    infer more from the gaps in its own ids. Measured 2026-09-25: the app role
--    read anomalies_id_seq.last_value directly. A uuid has no shared counter,
--    so there is nothing to observe. Changed before the query port rather than
--    after, while no code depends on the type.
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

-- ---------------------------------------------------------------------------
-- THE APPLICATION ROLE COMES FIRST, and why the order matters.
--
-- This file is a BOOTSTRAP for an EMPTY public schema, not a migration: the
-- CREATE TABLEs below abort on a re-apply ("relation meta already exists").
-- With the role block at the END, a re-apply therefore never reached it, so the
-- security attributes below silently stopped being re-asserted the moment the
-- schema existed. Putting it first means the role is corrected on EVERY apply,
-- successful or not.
--
-- RLS DOES NOT APPLY TO A SUPERUSER. Not with ENABLE, not with FORCE:
-- BYPASSRLS is implicit for superusers and FORCE cannot override it. The
-- postgres Docker image creates POSTGRES_USER as a superuser, so connecting as
-- it made every policy in this file silently inert -- measured 2026-09-25,
-- where an unscoped SELECT returned both tenants and tenant A successfully
-- INSERTed a row tagged tenant B, against a schema that reads as correct.
--
-- NO PASSWORD HERE. It is set out of band (docker-compose.dev.yml for local
-- work, the provider's own mechanism in production). A credential in a
-- committed schema file is a credential in every clone and every CI log.
--
-- THE ALTER IS CONDITIONAL, and that is not tidiness. Postgres requires the
-- altering role to HOLD each attribute it changes -- measured: a CREATEROLE
-- non-superuser gets "Only roles with the SUPERUSER attribute may change the
-- SUPERUSER attribute", and the same for BYPASSRLS and REPLICATION, EVEN WHEN
-- SETTING THEM TO THE VALUE THEY ALREADY HAVE. Neon's admin role is not a
-- superuser, so an unconditional ALTER would abort the whole apply on a
-- correctly-provisioned database. So: check first, only alter what is actually
-- wrong, and if it is wrong and cannot be fixed, fail LOUDLY with what to do.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axlepoint_app') THEN
    CREATE ROLE axlepoint_app LOGIN;
  END IF;

  SELECT rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    INTO r FROM pg_roles WHERE rolname = 'axlepoint_app';

  IF r.rolsuper OR r.rolbypassrls OR r.rolreplication OR r.rolcreatedb OR r.rolcreaterole THEN
    BEGIN
      ALTER ROLE axlepoint_app
        NOSUPERUSER NOBYPASSRLS NOREPLICATION NOCREATEDB NOCREATEROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION
        'axlepoint_app holds privileges that defeat RLS (super=% bypassrls=% repl=%), and this role cannot remove them. Provision it without them, out of band, then re-apply.',
        r.rolsuper, r.rolbypassrls, r.rolreplication;
    END;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- NO VIEWS, MATERIALIZED VIEWS OR FOREIGN TABLES IN THIS SCHEMA.
--
-- The RLS loop above walks pg_tables, which lists ORDINARY TABLES ONLY. A view
-- is relkind 'v' and never appears there, so it would receive no policy -- and
-- a view owned by a privileged role runs with that role's rights, handing back
-- every tenant's rows through a relation the coverage tests cannot even see.
-- Materialized views are worse: they cannot carry RLS at all.
--
-- Verified 2026-09-25: CREATE VIEW leaky AS SELECT * FROM assets; leaves
-- pg_tables with zero rows for it, and all three coverage tests still pass.
--
-- So this fails the apply rather than trusting a convention. If AxlePoint ever
-- needs a view, it must be created with security_invoker = true AND the
-- coverage tests extended in the same change.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname || ' (' || c.relkind::text || ')', ', ')
    INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'f');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'public contains relations RLS cannot cover: %. Views/matviews/foreign tables bypass the pg_tables walk.', bad;
  END IF;
END
$$;

CREATE TABLE meta (
  tenant_id text NOT NULL CHECK (tenant_id <> ''),
  key       text NOT NULL,
  value     text NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE assets (
  tenant_id    text NOT NULL CHECK (tenant_id <> ''),
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
  tenant_id   text NOT NULL CHECK (tenant_id <> ''),
  asset_id    text NOT NULL,
  sensor_type text NOT NULL,
  ts          bigint NOT NULL,
  value       double precision NOT NULL
);
CREATE INDEX idx_readings ON sensor_readings (tenant_id, asset_id, sensor_type, ts);

CREATE TABLE anomalies (
  tenant_id   text NOT NULL CHECK (tenant_id <> ''),
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
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
  tenant_id    text NOT NULL CHECK (tenant_id <> ''),
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
  tenant_id      text NOT NULL CHECK (tenant_id <> ''),
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
  tenant_id     text NOT NULL CHECK (tenant_id <> ''),
  work_order_id text NOT NULL,
  part_id       text NOT NULL,
  qty           integer NOT NULL
);
CREATE INDEX idx_wop ON work_order_parts (tenant_id, work_order_id);

CREATE TABLE technicians (
  tenant_id      text NOT NULL CHECK (tenant_id <> ''),
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
  tenant_id     text NOT NULL CHECK (tenant_id <> ''),
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
  tenant_id   text NOT NULL CHECK (tenant_id <> ''),
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
  tenant_id text NOT NULL CHECK (tenant_id <> ''),
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
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
    $f$, t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Privileges for the application role. AFTER the tables, necessarily.
--
-- NO SEQUENCE GRANT. There are no sequences any more: anomalies.id became a
-- uuid precisely because one shared sequence let any tenant read last_value and
-- learn every other tenant's insert volume. If a sequence is ever reintroduced,
-- granting SELECT on it reopens that channel -- grant USAGE alone, which allows
-- nextval without allowing the counter to be read.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO axlepoint_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO axlepoint_app;
