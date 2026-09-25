import pgTypes from "pg-types";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

// int8 (OID 20) ARRIVES AS A STRING UNLESS TOLD OTHERWISE. node-postgres does
// that deliberately, because a 64-bit integer can exceed Number.MAX_SAFE_INTEGER
// and silently lose precision. For AxlePoint it is the wrong default and the
// failure is invisible: COUNT(*) is int8, and every timestamp column in
// db/schema.sql is bigint, so `{ ts: number }` would hold "1758758400" at
// runtime while TypeScript insisted it was a number. Charts would plot
// nothing, arithmetic would coerce silently, and === comparisons would fail.
//
// Epoch seconds (~1.7e9) and row counts are nowhere near 2^53, so parsing them
// as numbers is safe here. Queries that feed arithmetic ALSO cast ::int in SQL,
// so they do not depend on this global setting -- see queries.ts. This is
// belt and braces for the columns that are genuinely bigint.
pgTypes.setTypeParser(pgTypes.builtins.INT8, (v: string) => Number(v));

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
  const pool = new Pool({ connectionString, max: 10 });

  // WITHOUT THIS LISTENER A DEAD IDLE CONNECTION KILLS THE PROCESS. node-postgres
  // emits 'error' on the POOL when a client fails while idle in it -- a Neon
  // instance scaling to zero, a failover, an admin terminating the backend -- and
  // an EventEmitter 'error' with no listener is an uncaught exception, not a
  // logged warning. Measured 2026-09-25: terminating one backend crashed the
  // probe outright with "Unhandled 'error' event ... Emitted 'error' event on
  // BoundPool". The pool itself recovers and hands out a fresh connection
  // (verified: the next borrow got a new pid), so the ONLY damage was the
  // missing listener.
  pool.on("error", (err) => {
    console.error(`[pg] idle client error, connection discarded: ${err.message}`);
  });

  return pool;
}

/**
 * Test-only escape hatch. NOT for query code: everything tenant-scoped must go
 * through withTenant(), which is the only thing that puts app.tenant_id in
 * scope. The name is deliberately awkward so a normal import looks wrong.
 */
export function __getPoolForTests(): Pool {
  if (!global.__axlepointPgPool) global.__axlepointPgPool = makePool();
  return global.__axlepointPgPool;
}

function pool(): Pool {
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

  const client: PoolClient = await pool().connect();

  // THE HANDLE MUST EXPIRE, or it is a way out of the transaction. `db` closes
  // over `client`, so a query function that stashes it on a module global, or
  // calls db.query WITHOUT awaiting it, can run a statement after this function
  // returns and the client has been released -- by then the client may be
  // serving a DIFFERENT tenant's transaction, or none at all. Measured
  // 2026-09-25: a stashed handle executed successfully after release, with
  // app.tenant_id reading "". This flag is what makes that a loud error rather
  // than a silent cross-tenant query.
  let done = false;
  let released = false;

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const db: TenantDb = {
      tenantId,
      async query<R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
      ): Promise<R[]> {
        if (done) {
          throw new TenantScopeError(
            "This database handle has expired: its withTenant() transaction has " +
              "already finished. Do not stash the handle or leave a query " +
              "un-awaited; the client it wraps may now belong to another tenant.",
          );
        }
        const result = await client.query<R>(text, values);
        return result.rows;
      },
    };

    const out = await fn(db);

    done = true;
    const commit = await client.query("COMMIT");
    // A COMMIT on a transaction Postgres has already aborted does NOT throw: it
    // returns quietly with the command tag ROLLBACK. Measured 2026-09-25.
    // Without this check a caller that swallowed an intermediate query error
    // would be told its writes were committed when they were discarded.
    if (commit.command !== "COMMIT") {
      throw new TenantScopeError(
        `Transaction did not commit: Postgres reported "${commit.command}". ` +
          "The transaction was already aborted, so every write in it was discarded.",
      );
    }
    return out;
  } catch (err) {
    done = true;
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction is already dead (connection lost, server restarted).
      // Surfacing this would replace the real error with a less useful one.
      //
      // Passing the error to release() asks the pool to DESTROY this client
      // rather than reuse it. Measured 2026-09-25: node-postgres already
      // discards a non-queryable client either way (the next borrow got a
      // fresh pid, and Gemini's claim that a dirty client is reused did not
      // reproduce). This is belt and braces for a client that failed to roll
      // back but is still technically usable, which WOULD carry its
      // transaction state onward.
      released = true;
      client.release(err instanceof Error ? err : new Error(String(err)));
    }
    throw err;
  } finally {
    if (!released) client.release();
  }
}
