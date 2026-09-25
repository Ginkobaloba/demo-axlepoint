import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { withTenant, __getPoolForTests, closePool, TenantScopeError } from "@/lib/pg";

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
let adminUrlForRestore: string;

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
  adminUrlForRestore = adminUrl;
  admin = new Pool({ connectionString: adminUrl });

  const sql = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  await admin.query(fs.readFileSync(path.join(process.cwd(), "db", "reset-schemas.sql"), "utf8"));
  await admin.query(sql);
  // schema.sql deliberately carries NO password -- a credential in a committed
  // file is a credential in every clone. Dev sets it out of band, which is what
  // production does too.
  await admin.query("ALTER ROLE axlepoint_app PASSWORD 'axlepoint_app'");

  // Everything from here on goes through the app role, so the pool must see
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
  // See the matching note in route.itest.ts: this file also rewrites the
  // shared DATABASE_URL, so it puts the admin URL back.
  if (adminUrlForRestore) process.env.DATABASE_URL = adminUrlForRestore;
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
    const { rows } = await __getPoolForTests().query("SELECT id FROM assets");
    expect(rows).toHaveLength(0);
  });

  it("does not leak a tenant into the next borrower after a rollback", async () => {
    await expect(
      withTenant(B, async (db) => {
        await db.query("SELECT 1");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const { rows } = await __getPoolForTests().query<{ t: string | null }>(
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
      // JOIN ON relname ALONE WAS A REAL BUG, not a tidiness point. It was
      // raised in review as theoretical and became actual the moment
      // db/schema.sql added pristine.* tables with the SAME NAMES as public.*:
      // the join then matched the pristine copies, which correctly have no RLS,
      // and this test failed against a perfectly good schema. Qualify by
      // namespace or a catalog join will find whatever else shares a name.
      `SELECT t.tablename, t.rowsecurity, c.relforcerowsecurity
         FROM pg_tables t
         JOIN pg_namespace n ON n.nspname = t.schemaname
         JOIN pg_class c ON c.relname = t.tablename AND c.relnamespace = n.oid
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

/**
 * Hardening added in step 1.5, after independent review. Every test below
 * corresponds to a claim that was VERIFIED against this database first; the one
 * claim that did not reproduce (a failed ROLLBACK returning a dirty client to
 * the pool) is deliberately not asserted here, because asserting behaviour that
 * does not exist is how a suite starts lying.
 */
describe("the handle cannot outlive its transaction", () => {
  it("throws if a stashed handle is used after withTenant returns", async () => {
    let escaped: { query: (t: string) => Promise<unknown> } | null = null;
    await withTenant(A, async (db) => {
      escaped = db;
      await db.query("SELECT 1");
    });
    // Before the `done` flag this SUCCEEDED, on a released client that could
    // by then be serving another tenant.
    await expect(escaped!.query("SELECT 1")).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("surfaces an aborted transaction instead of reporting a successful commit", async () => {
    // Postgres answers COMMIT on an aborted transaction with the tag ROLLBACK
    // and no error. A caller that swallowed the original failure would be told
    // its writes landed when they were discarded.
    await expect(
      withTenant(A, async (db) => {
        try {
          await db.query("SELECT 1/0");
        } catch {
          // swallowed on purpose: this is the shape that hid the problem
        }
        return "looks fine";
      }),
    ).rejects.toThrow(/did not commit|ROLLBACK/i);
  });
});

describe("the empty-string tenant id cannot become a real tenant", () => {
  it("is rejected by a CHECK constraint on every table", async () => {
    const { rows } = await admin.query<{ tablename: string }>(
      `SELECT t.tablename FROM pg_tables t
        WHERE t.schemaname = 'public'
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint c
             WHERE c.conrelid = (quote_ident(t.schemaname)||'.'||quote_ident(t.tablename))::regclass
               AND c.contype = 'c'
               AND pg_get_constraintdef(c.oid) LIKE '%tenant_id%')`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("and the admin cannot plant one either", async () => {
    await expect(
      admin.query(
        `INSERT INTO meta (tenant_id, key, value) VALUES ('', 'k', 'v')`,
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("relations RLS cannot cover do not exist", () => {
  // The coverage tests walk pg_tables, which lists ORDINARY TABLES ONLY. A view
  // is relkind 'v' and is invisible to all of them; a matview cannot carry RLS
  // at all. Verified 2026-09-25: creating a view left every coverage test green.
  it("public contains no views, materialized views or foreign tables", async () => {
    const { rows } = await admin.query<{ relname: string; relkind: string }>(
      `SELECT c.relname, c.relkind::text AS relkind
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('v','m','f')`,
    );
    expect(rows.map((r) => `${r.relname} (${r.relkind})`)).toEqual([]);
  });

  it("and no sequences, whose shared counter would leak cross-tenant volume", async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});

describe("no second policy can quietly widen a table", () => {
  it("every table has exactly one permissive policy, covering ALL commands", async () => {
    // PERMISSIVE ONLY. Permissive policies are OR-ed, so a second one WIDENS a
    // table and is what this test exists to catch. Restrictive policies are
    // AND-ed and can only narrow, which is why db/schema.sql uses one to
    // confine the demo_reset role (D-026); counting it here would make this
    // test fail on a change that made the schema stricter.
    const { rows } = await admin.query<{
      tablename: string;
      n: string;
      cmds: string;
    }>(
      `SELECT tablename, count(*)::text AS n, string_agg(DISTINCT cmd, ',') AS cmds
         FROM pg_policies WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
        GROUP BY tablename ORDER BY tablename`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.n !== "1").map((r) => r.tablename)).toEqual([]);
    expect(rows.filter((r) => r.cmds !== "ALL").map((r) => r.tablename)).toEqual([]);
  });
});

describe("a future foreign key cannot be used to probe another tenant", () => {
  // None exist today. This exists so that adding one on (id) alone -- which
  // would let a row reference another tenant's row, and let existence be probed
  // through constraint violations -- fails here rather than in review.
  it("every foreign key includes tenant_id in its column list", async () => {
    const { rows } = await admin.query<{ conname: string; def: string }>(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.contype = 'f'`,
    );
    expect(rows.filter((r) => !r.def.includes("tenant_id")).map((r) => r.conname)).toEqual([]);
  });
});
