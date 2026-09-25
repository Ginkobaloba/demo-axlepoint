import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { withTenant, getPool, closePool, TenantScopeError } from "@/lib/pg";

/**
 * Does per-tenant isolation ACTUALLY hold? Integration test, needs a real
 * Postgres (see docker-compose.dev.yml, or the CI service in verify.yml).
 *
 * THIS FILE IS DELIBERATELY NOT IN THE DEFAULT SUITE. vitest.config.ts includes
 * `src/**\/*.test.ts`; this is `.itest.ts` and runs under `npm run test:rls`.
 * Separating it keeps `npm test` database-free, and the CI step that runs it is
 * named, so it cannot quietly stop running and still report green.
 *
 * IT DOES NOT SKIP. A leak test that skips when the database is missing is the
 * worst instrument available: it reports success having checked nothing. With
 * no DATABASE_URL it fails, loudly, here.
 *
 * TWO ROLES, ON PURPOSE. DATABASE_URL is the ADMIN connection (a superuser in
 * the Docker image) and is used only to build the schema and to read the
 * catalog. Everything that asserts isolation runs as axlepoint_app, because
 * RLS DOES NOT APPLY TO A SUPERUSER -- not with ENABLE, not with FORCE. The
 * first run of this file connected as the superuser and every policy was
 * silently inert: an unscoped SELECT returned both tenants and tenant A
 * successfully INSERTed a row tagged tenant B. Nothing in the schema was
 * wrong. If the queries below had carried the `WHERE tenant_id = $1` that
 * real query functions carry, all of them would have PASSED while RLS did
 * nothing whatsoever.
 *
 * THE CONTROL IS THE POINT. "Tenant A cannot see tenant B's rows" is satisfied
 * just as well by an empty table, a broken query, or a setup that never ran.
 * So the first tests prove the rows EXIST and ARE READABLE when correctly
 * scoped. Without that, every later assertion is unfalsifiable.
 */

const A = "tenant-aaa";
const B = "tenant-bbb";

let admin: Pool;

function requireScratchDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. This test DROPS AND RECREATES the public " +
        "schema, so it refuses to guess. Start a scratch database with:\n" +
        "  docker compose -f docker-compose.dev.yml up -d\n" +
        '  $env:DATABASE_URL = "postgres://axlepoint:axlepoint@localhost:55433/axlepoint"',
    );
  }
  // Advisory, not relied upon: it catches the obvious mistake and cannot catch
  // a renamed production database. The real control is that this only ever
  // runs against a URL someone set on purpose for it.
  for (const smell of ["neon.tech", "prod", "portal"]) {
    if (url.toLowerCase().includes(smell)) {
      throw new Error(
        `DATABASE_URL contains "${smell}". Refusing: this test drops schemas.`,
      );
    }
  }
  return url;
}

/** The same server, connected as the unprivileged application role. */
function appUrlFrom(adminUrl: string): string {
  const u = new URL(adminUrl);
  u.username = "axlepoint_app";
  u.password = "axlepoint_app";
  return u.toString();
}

beforeAll(async () => {
  const adminUrl = requireScratchDatabase();
  admin = new Pool({ connectionString: adminUrl });

  const sql = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await admin.query(sql);

  // Everything from here on goes through the app role, so getPool() must see
  // that URL before withTenant() ever builds the pool.
  process.env.DATABASE_URL = appUrlFrom(adminUrl);

  for (const [tenant, id, name] of [
    [A, "A-1001", "alpha pump"],
    [B, "B-2002", "bravo compressor"],
  ] as const) {
    await withTenant(tenant, (db) =>
      db.query(
        `INSERT INTO assets (tenant_id, id, name, type, model, serial, location,
                             installed_on, run_hours, status, criticality,
                             risk_score, risk_band, risk_factors)
         VALUES ($1, $2, $3, 'pump', 'M-1', 'SN-1', 'bay-1', '2098-01-01',
                 100, 'running', 'high', 0.5, 'medium', '[]')`,
        [tenant, id, name],
      ),
    );
  }
});

afterAll(async () => {
  await closePool();
  if (admin) await admin.end();
});

/**
 * Runs FIRST, because if this is wrong every other assertion in the file is
 * meaningless in the most convincing possible way.
 */
describe("the role the app connects as can actually be constrained", () => {
  it("is neither a superuser nor BYPASSRLS", async () => {
    const { rows } = await admin.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'axlepoint_app'");
    expect(rows).toHaveLength(1);
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });

  it("does not own the tables, so it cannot simply disable the policies", async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = 'axlepoint_app'`,
    );
    expect(rows[0].n).toBe("0");
  });
});

describe("the control: a leak would be visible if there were one", () => {
  it("reads back its OWN row when scoped to that tenant", async () => {
    const rows = await withTenant(A, (db) =>
      db.query<{ id: string }>("SELECT id FROM assets"),
    );
    expect(rows.map((r) => r.id)).toEqual(["A-1001"]);
  });

  it("and tenant B can read ITS row, so both rows really exist", async () => {
    const rows = await withTenant(B, (db) =>
      db.query<{ id: string }>("SELECT id FROM assets"),
    );
    expect(rows.map((r) => r.id)).toEqual(["B-2002"]);
  });

  it("and the admin connection can see both, so neither insert was lost", async () => {
    const { rows } = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM assets",
    );
    expect(rows[0].n).toBe("2");
  });
});

describe("cross-tenant isolation", () => {
  it("does not return another tenant's rows on an UNFILTERED select", async () => {
    // No WHERE clause on purpose. This is the query a ported function would
    // produce if someone forgot app-level scoping; RLS is what must catch it.
    const rows = await withTenant(A, (db) =>
      db.query<{ tenant_id: string }>("SELECT tenant_id FROM assets"),
    );
    expect(rows.every((r) => r.tenant_id === A)).toBe(true);
    expect(rows.some((r) => r.tenant_id === B)).toBe(false);
  });

  it("cannot reach another tenant's row even when naming its id directly", async () => {
    const rows = await withTenant(A, (db) =>
      db.query("SELECT id FROM assets WHERE id = $1", ["B-2002"]),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot UPDATE another tenant's row", async () => {
    await withTenant(A, (db) =>
      db.query("UPDATE assets SET name = 'hijacked' WHERE id = $1", ["B-2002"]),
    );
    const rows = await withTenant(B, (db) =>
      db.query<{ name: string }>("SELECT name FROM assets WHERE id = $1", ["B-2002"]),
    );
    expect(rows[0]?.name).toBe("bravo compressor");
  });

  it("cannot DELETE another tenant's row", async () => {
    await withTenant(A, (db) =>
      db.query("DELETE FROM assets WHERE id = $1", ["B-2002"]),
    );
    const rows = await withTenant(B, (db) => db.query("SELECT id FROM assets"));
    expect(rows).toHaveLength(1);
  });

  // The half that USING alone does not cover. Without WITH CHECK, isolation
  // holds on read and leaks on write: tenant A could plant rows inside B.
  it("cannot INSERT a row tagged with another tenant", async () => {
    await expect(
      withTenant(A, (db) =>
        db.query(
          `INSERT INTO assets (tenant_id, id, name, type, model, serial, location,
                               installed_on, run_hours, status, criticality,
                               risk_score, risk_band, risk_factors)
           VALUES ($1, 'A-9999', 'planted', 'pump', 'M-1', 'SN-9', 'bay-9',
                   '2098-01-01', 1, 'running', 'low', 0.1, 'low', '[]')`,
          [B],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    // And it really did not land: check from a connection that CAN see
    // everything, so a passing rejection cannot hide a partial write.
    const { rows } = await admin.query("SELECT id FROM assets WHERE id = 'A-9999'");
    expect(rows).toHaveLength(0);
  });
});

describe("the setting does not survive its transaction", () => {
  it("returns nothing outside withTenant, because app.tenant_id is unset", async () => {
    // Straight off the pool, no transaction, no setting. RLS must deny by
    // default rather than fall open.
    const { rows } = await getPool().query("SELECT id FROM assets");
    expect(rows).toHaveLength(0);
  });

  it("does not leak a tenant into the next borrower after a rollback", async () => {
    await expect(
      withTenant(B, async (db) => {
        await db.query("SELECT 1");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const { rows } = await getPool().query<{ t: string | null }>(
      "SELECT current_setting('app.tenant_id', true) AS t",
    );
    // Postgres leaves a reset GUC as '' rather than NULL once it has been set
    // in that session, so assert on the property that matters -- the next
    // borrower is not scoped to anyone -- not on the exact empty value.
    expect(rows[0].t === A || rows[0].t === B).toBe(false);
    expect(rows[0].t ?? "").toBe("");
  });
});

describe("withTenant refuses a tenant id it cannot trust", () => {
  for (const bad of ["", "   ", "'; DROP TABLE assets; --", "a".repeat(65)]) {
    it(`rejects ${JSON.stringify(bad)}`, async () => {
      await expect(withTenant(bad, async () => "unreachable")).rejects.toBeInstanceOf(
        TenantScopeError,
      );
    });
  }
});

/**
 * The test that catches table eleven. Everything above proves ONE table is
 * protected; this proves the protection has no gaps, by asking the catalog
 * rather than trusting the schema file to have remembered.
 */
describe("RLS coverage is total", () => {
  it("every table has RLS enabled AND forced", async () => {
    const { rows } = await admin.query<{
      tablename: string;
      rowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT t.tablename, t.rowsecurity, c.relforcerowsecurity
         FROM pg_tables t
         JOIN pg_class c ON c.relname = t.tablename
        WHERE t.schemaname = 'public'
        ORDER BY t.tablename`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const unprotected = rows.filter((r) => !r.rowsecurity || !r.relforcerowsecurity);
    expect(unprotected.map((r) => r.tablename)).toEqual([]);
  });

  it("every table has a tenant_isolation policy", async () => {
    const { rows: tables } = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const { rows: policies } = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'",
    );
    const covered = new Set(policies.map((r) => r.tablename));
    expect(tables.map((t) => t.tablename).filter((t) => !covered.has(t))).toEqual([]);
  });

  it("every table actually carries a tenant_id column", async () => {
    const { rows: tables } = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const { rows: cols } = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    );
    const have = new Set(cols.map((r) => r.table_name));
    expect(tables.map((t) => t.tablename).filter((t) => !have.has(t))).toEqual([]);
  });
});
