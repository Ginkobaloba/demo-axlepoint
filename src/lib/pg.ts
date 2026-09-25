import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Tenant-scoped Postgres access for AxlePoint.
 *
 * WHY A TRANSACTION IS MANDATORY HERE, not a style choice: per-tenant
 * isolation is enforced by RLS reading `app.tenant_id`, and that setting is
 * TRANSACTION-SCOPED. Outside a transaction Postgres discards it (with only a
 * warning), so the policy compares against NULL and the query silently returns
 * nothing -- or, if the policy were ever relaxed, silently returns everything.
 * Every tenant-scoped statement therefore runs inside withTenant(), on ONE
 * client, inside ONE transaction. There is deliberately no way to get a raw
 * client out of this module.
 *
 * WHY set_config AND NOT `SET LOCAL`: `SET LOCAL app.tenant_id = $1` is a
 * syntax error -- SET does not accept bind parameters, so the only way to
 * write it as SET LOCAL is to interpolate the tenant id into SQL text. That
 * would put a string concatenation in the one function whose entire job is
 * keeping two customers apart. `set_config(name, value, is_local => true)` is
 * the function form of SET LOCAL, is identical in scope, and takes a bound
 * parameter.
 *
 * DRIVER CHOICE. This uses node-postgres against a local Postgres for
 * development. Production targets Neon's WebSocket `Pool`, which is
 * API-compatible with this one, so the swap is confined to makePool() below.
 * The Neon HTTP driver is deliberately NOT an option for anything
 * tenant-scoped: it is one-shot per request, so a transaction cannot span
 * statements and the guarantee above evaporates. Whether its batched
 * transaction() form preserves the setting is still unmeasured; see
 * paradigm-ops/tools/neon/rls-set-local-probe.mjs, which runs when a scratch
 * Neon project exists.
 *
 * RLS IS THE SECOND LAYER, NOT THE FIRST. Query functions still filter by
 * tenant in their WHERE clauses. That control is testable without a database
 * and does not depend on driver transaction semantics; this one catches the
 * query that forgets.
 */

declare global {
  var __axlepointPgPool: Pool | undefined;
}

/** A tenant id must be a non-empty, non-whitespace string. */
const TENANT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export class TenantScopeError extends Error {}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new TenantScopeError(
      "DATABASE_URL is not set. AxlePoint's Postgres layer has no default: " +
        "a fallback here would silently point development, tests or production " +
        "at whichever database happened to be reachable.",
    );
  }
  return new Pool({ connectionString, max: 10 });
}

export function getPool(): Pool {
  if (!global.__axlepointPgPool) global.__axlepointPgPool = makePool();
  return global.__axlepointPgPool;
}

/** Test/shutdown helper: closes and forgets the pool. */
export async function closePool(): Promise<void> {
  const pool = global.__axlepointPgPool;
  global.__axlepointPgPool = undefined;
  if (pool) await pool.end();
}

/**
 * The only database handle query functions ever see. Narrow on purpose: it
 * exposes no way to COMMIT, ROLLBACK, release the client or reach the pool, so
 * a query function cannot accidentally escape the tenant-scoped transaction it
 * was handed.
 */
export interface TenantDb {
  readonly tenantId: string;
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<R[]>;
}

/**
 * Runs `fn` inside one transaction with `app.tenant_id` set to `tenantId`.
 *
 * Commits on return, rolls back on throw, and always releases the client. The
 * rollback path matters for more than tidiness: a client returned to the pool
 * mid-transaction would carry that tenant's setting into whatever borrowed it
 * next.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  if (!TENANT_ID_RE.test(tenantId)) {
    // Refusing here rather than passing it through is deliberate. An empty or
    // malformed tenant id would set the GUC to something no row matches, and
    // the caller would see an empty result set that looks exactly like "this
    // tenant has no data" instead of "the tenant id was broken".
    throw new TenantScopeError(`Invalid tenant id: ${JSON.stringify(tenantId)}`);
  }

  const client: PoolClient = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const db: TenantDb = {
      tenantId,
      async query<R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
      ): Promise<R[]> {
        const result = await client.query<R>(text, values);
        return result.rows;
      },
    };

    const out = await fn(db);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction is already dead (connection lost, server restarted).
      // Surfacing this would replace the real error with a less useful one.
    }
    throw err;
  } finally {
    client.release();
  }
}
