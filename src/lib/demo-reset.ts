import type { PoolClient } from "pg";

/**
 * Restore a tenant from the pristine dataset, in one transaction.
 *
 * WHY THIS EXISTS. D-012 promises that visitor-entered text cannot outlive one
 * interval. On SQLite that was a file copy from a read-only snapshot. On
 * Postgres it is "delete this tenant's rows and re-insert them from pristine",
 * and the whole design problem was doing that without weakening RLS.
 *
 * WHAT MAKES IT SAFE, and it is not this file. The safety lives in the schema:
 * `pristine` is a separate schema with no tenant_id and no RLS, so reading it
 * is not a cross-tenant read; and a RESTRICTIVE policy pins the demo_reset
 * role to the sample tenant regardless of what it sets app.tenant_id to. This
 * function could be pointed at another tenant and the database would refuse
 * it. That is deliberate: a reset that is safe only because the caller passes
 * the right argument is not safe.
 *
 * ONE TRANSACTION, for a specific reason. A half-applied reset leaves the demo
 * with some tables restored and others still holding visitor rows -- which
 * looks fine and quietly breaks the retention promise for whatever did not get
 * through.
 *
 * COLUMN LISTS COME FROM THE CATALOG, never from a hand-written list here. A
 * column added to a public table and forgotten here would silently stop being
 * restored, and the reset would keep reporting success.
 */

export interface ResetResult {
  tenantId: string;
  tables: { table: string; deleted: number; inserted: number }[];
}

async function publicTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return rows.map((r) => r.tablename);
}

/** Columns shared by public.<t> and pristine.<t>, excluding tenant_id. */
async function sharedColumns(client: PoolClient, table: string): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT p.column_name
       FROM information_schema.columns p
       JOIN information_schema.columns q
         ON q.table_schema = 'pristine' AND q.table_name = p.table_name
        AND q.column_name = p.column_name
      WHERE p.table_schema = 'public' AND p.table_name = $1
        AND p.column_name <> 'tenant_id'
      ORDER BY p.ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

/**
 * Refuses to run as a role that can bypass RLS.
 *
 * THIS GUARD IS THE DIFFERENCE BETWEEN A RESET AND A WIPE. The DELETE below
 * carries no WHERE clause, because RLS is what scopes it to one tenant. Run
 * the same statement as a superuser -- and the seeding connection IS a
 * superuser on a local Docker Postgres -- and RLS is inert, so it deletes
 * EVERY tenant's rows. The demo reset would silently become a
 * delete-all-customers.
 *
 * Adding "WHERE tenant_id = $1" as belt and braces would be worse than this
 * check: it would make the function survive a missing policy, which is exactly
 * the condition the isolation tests need to be able to detect.
 */
async function refuseIfRlsIsInert(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT current_user, r.rolsuper, r.rolbypassrls
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const me = rows[0];
  if (!me) throw new Error("Could not determine the current role; refusing to reset.");
  if (me.rolsuper || me.rolbypassrls) {
    throw new Error(
      `Refusing to reset as "${me.current_user}": it is ` +
        `${me.rolsuper ? "a superuser" : "BYPASSRLS"}, so row level security does ` +
        "not apply and the unscoped DELETE would remove EVERY tenant's rows, not " +
        "just this one. Run the reset as demo_reset.",
    );
  }
}

export async function resetTenantFromPristine(
  client: PoolClient,
  tenantId: string,
): Promise<ResetResult> {
  await refuseIfRlsIsInert(client);
  const tables = await publicTables(client);
  const result: ResetResult = { tenantId, tables: [] };

  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    for (const table of tables) {
      const cols = await sharedColumns(client, table);
      if (!cols.length) {
        throw new Error(
          `pristine.${table} shares no columns with public.${table}; refusing to ` +
            "restore a table into an empty column list.",
        );
      }

      // RLS scopes this to the tenant set above. There is deliberately no
      // WHERE tenant_id = ... : if the policy were ever removed, a bare DELETE
      // would fail loudly in the isolation tests rather than being masked by a
      // belt-and-braces filter that hides the loss of the control.
      const del = await client.query(`DELETE FROM public.${table}`);

      const quoted = cols.map((c) => `"${c}"`).join(", ");
      const ins = await client.query(
        `INSERT INTO public.${table} (tenant_id, ${quoted})
         SELECT $1, ${quoted} FROM pristine.${table}`,
        [tenantId],
      );

      result.tables.push({
        table,
        deleted: del.rowCount ?? 0,
        inserted: ins.rowCount ?? 0,
      });
    }

    const commit = await client.query("COMMIT");
    if (commit.command !== "COMMIT") {
      throw new Error(
        `Reset did not commit: Postgres reported "${commit.command}". Nothing was restored.`,
      );
    }
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}
