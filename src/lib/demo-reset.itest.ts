import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { resetTenantFromPristine } from "@/lib/demo-reset";

/**
 * The demo reset: does it restore the sample tenant, and can it do anything
 * else?
 *
 * The second question is the important one. The reset deletes rows with NO
 * WHERE CLAUSE -- RLS is the only thing scoping it -- so every claim about what
 * it cannot reach has to be measured, not reasoned about.
 *
 * THE CONTROL, as in pg.rls.itest.ts: a second tenant's rows are seeded and
 * proven visible to an admin connection. Without that, "the reset left the
 * other tenant alone" is satisfied just as well by the other tenant never
 * having existed.
 */

const SAMPLE = "sample";
const OTHER = "paying-customer";

let admin: Pool;
let resetPool: Pool;
let resetClient: PoolClient;

function roleUrl(base: string, user: string, pass: string): string {
  const u = new URL(base);
  u.username = user;
  u.password = pass;
  return u.toString();
}

async function seedPristineRow(): Promise<void> {
  await admin.query(
    `INSERT INTO pristine.assets (
       id, name, type, model, serial, location, installed_on, run_hours,
       status, criticality, risk_score, risk_band, risk_factors
     ) VALUES ('AST-P1','pristine pump','pump','M','S','bay','2098-01-01',1,
               'operational','important',10,'low','[]')`,
  );
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set; this test drops schemas.");
  for (const smell of ["neon.tech", "prod", "portal"]) {
    if (url.toLowerCase().includes(smell)) {
      throw new Error(`DATABASE_URL contains "${smell}". Refusing.`);
    }
  }
  admin = new Pool({ connectionString: url });
  await admin.query(
    "DROP SCHEMA IF EXISTS pristine CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
  );
  await admin.query(fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
  await admin.query("ALTER ROLE demo_reset PASSWORD 'demo_reset'");

  resetPool = new Pool({ connectionString: roleUrl(url, "demo_reset", "demo_reset") });
  resetClient = await resetPool.connect();
});

afterAll(async () => {
  if (resetClient) resetClient.release();
  if (resetPool) await resetPool.end();
  if (admin) await admin.end();
});

beforeEach(async () => {
  await admin.query("TRUNCATE pristine.assets");
  await admin.query("DELETE FROM public.assets");
  await seedPristineRow();
  // A second tenant, seeded directly. This is the row every isolation claim
  // below is measured against.
  await admin.query(
    `INSERT INTO public.assets (
       tenant_id, id, name, type, model, serial, location, installed_on,
       run_hours, status, criticality, risk_score, risk_band, risk_factors
     ) VALUES ($1,'AST-OTHER','paying asset','pump','M','S','bay','2098-01-01',1,
               'operational','important',10,'low','[]')`,
    [OTHER],
  );
});

describe("the control: the other tenant's row exists", () => {
  it("is visible to an admin connection", async () => {
    const { rows } = await admin.query<{ n: string }>(
      "SELECT count(*)::text n FROM public.assets WHERE tenant_id = $1",
      [OTHER],
    );
    expect(rows[0].n).toBe("1");
  });
});

describe("the reset restores the sample tenant", () => {
  it("brings back a row a visitor deleted", async () => {
    await resetTenantFromPristine(resetClient, SAMPLE);
    const after = await admin.query<{ n: string }>(
      "SELECT count(*)::text n FROM public.assets WHERE tenant_id = $1",
      [SAMPLE],
    );
    expect(after.rows[0].n).toBe("1");
  });

  it("removes a row a visitor added, which is the whole retention promise", async () => {
    await resetTenantFromPristine(resetClient, SAMPLE);
    await admin.query(
      `INSERT INTO public.assets (
         tenant_id, id, name, type, model, serial, location, installed_on,
         run_hours, status, criticality, risk_score, risk_band, risk_factors
       ) VALUES ($1,'AST-VISITOR','VISITOR-TYPED-SECRET','pump','M','S','bay',
                 '2098-01-01',1,'operational','important',10,'low','[]')`,
      [SAMPLE],
    );
    await resetTenantFromPristine(resetClient, SAMPLE);
    const { rows } = await admin.query(
      "SELECT id FROM public.assets WHERE tenant_id = $1 AND id = 'AST-VISITOR'",
      [SAMPLE],
    );
    expect(rows).toHaveLength(0);
  });

  it("LEAVES THE OTHER TENANT UNTOUCHED", async () => {
    await resetTenantFromPristine(resetClient, SAMPLE);
    const { rows } = await admin.query<{ name: string }>(
      "SELECT name FROM public.assets WHERE tenant_id = $1",
      [OTHER],
    );
    expect(rows.map((r) => r.name)).toEqual(["paying asset"]);
  });
});

describe("the reset role cannot leave the sample tenant, whatever it sets", () => {
  // app.tenant_id is set BY the connecting role, so a role that can set it can
  // name any tenant. The RESTRICTIVE policy is what makes that harmless, and
  // these are the tests that prove it rather than assuming it.
  it("sees nothing when it scopes itself to another tenant", async () => {
    await resetClient.query("BEGIN");
    await resetClient.query("SELECT set_config('app.tenant_id', $1, true)", [OTHER]);
    const { rows } = await resetClient.query("SELECT id FROM public.assets");
    await resetClient.query("COMMIT");
    expect(rows).toHaveLength(0);
  });

  it("cannot INSERT into another tenant", async () => {
    await resetClient.query("BEGIN");
    await resetClient.query("SELECT set_config('app.tenant_id', $1, true)", [OTHER]);
    await expect(
      resetClient.query(
        `INSERT INTO public.assets (
           tenant_id, id, name, type, model, serial, location, installed_on,
           run_hours, status, criticality, risk_score, risk_band, risk_factors
         ) VALUES ($1,'AST-PLANT','planted','pump','M','S','bay','2098-01-01',1,
                   'operational','important',10,'low','[]')`,
        [OTHER],
      ),
    ).rejects.toThrow(/row-level security/i);
    await resetClient.query("ROLLBACK");
  });

  it("cannot DELETE another tenant's rows", async () => {
    await resetClient.query("BEGIN");
    await resetClient.query("SELECT set_config('app.tenant_id', $1, true)", [OTHER]);
    await resetClient.query("DELETE FROM public.assets");
    await resetClient.query("COMMIT");
    const { rows } = await admin.query<{ n: string }>(
      "SELECT count(*)::text n FROM public.assets WHERE tenant_id = $1",
      [OTHER],
    );
    expect(rows[0].n).toBe("1");
  });

  it("cannot read the pristine dataset as the app role", async () => {
    const url = process.env.DATABASE_URL as string;
    const appPool = new Pool({ connectionString: roleUrl(url, "axlepoint_app", "axlepoint_app") });
    try {
      await admin.query("ALTER ROLE axlepoint_app PASSWORD 'axlepoint_app'");
      await expect(appPool.query("SELECT * FROM pristine.assets")).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await appPool.end();
    }
  });
});

describe("the reset refuses to run where RLS would not apply", () => {
  // The DELETE has no WHERE. As a superuser, RLS is inert and it would remove
  // EVERY tenant's rows -- a demo reset silently becoming a delete-all.
  it("throws rather than running on a superuser connection", async () => {
    const su = await admin.connect();
    try {
      await expect(resetTenantFromPristine(su, SAMPLE)).rejects.toThrow(
        /superuser|BYPASSRLS/i,
      );
    } finally {
      su.release();
    }
  });

  it("and the other tenant's rows survive that refusal", async () => {
    const su = await admin.connect();
    try {
      await resetTenantFromPristine(su, SAMPLE).catch(() => {});
    } finally {
      su.release();
    }
    const { rows } = await admin.query<{ n: string }>(
      "SELECT count(*)::text n FROM public.assets WHERE tenant_id = $1",
      [OTHER],
    );
    expect(rows[0].n).toBe("1");
  });
});

describe("the confinement is total, not per-table", () => {
  it("every public table carries the restrictive reset policy", async () => {
    const { rows: tables } = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const { rows: pol } = await admin.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'reset_sample_only'
          AND permissive = 'RESTRICTIVE'`,
    );
    const covered = new Set(pol.map((r) => r.tablename));
    expect(tables.map((t) => t.tablename).filter((t) => !covered.has(t))).toEqual([]);
  });

  it("the reset role is neither superuser nor BYPASSRLS", async () => {
    const { rows } = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'demo_reset'",
    );
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });
});
