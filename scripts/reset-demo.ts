/**
 * Restore the demo tenant from the pristine dataset, record the attempt, and
 * tell a human if it failed.
 *
 *   DATABASE_URL=postgres://demo_reset:...@host/db \
 *   RESET_ALERT_WEBHOOK=https://hooks.slack.com/... \
 *   npm run db:reset
 *
 * THIS SCRIPT DOES NOT SCHEDULE ITSELF. On SQLite the reset was triggered from
 * getDb() inside the request path, throttled by a module-level timestamp --
 * which does not survive a process restart, so *the throttle broke before the
 * reset did*. The schedule now lives in `ops/reset-sidecar/` and runs outside
 * the app process with its own credential. The app role cannot reset at all.
 *
 * IT LOGS FAILURES AS WELL AS SUCCESSES. Without a failure row, "no recent
 * success" cannot tell "never ran" from "ran and failed", and those need
 * different responses. The log write is its own transaction, outside the
 * reset's, or it would roll back with the failure it is recording.
 *
 * IT REFUSES TO RUN WITH NO ALERT DESTINATION. A reset that fails silently is
 * worse than one that does not run: the demo keeps serving visitor data past
 * its retention window while every dashboard looks fine. Setting up an alert
 * that goes nowhere a human reads is the recurring version of this mistake, so
 * the absence of a destination is a startup error rather than a warning. The
 * opt-out is deliberately awkward to type and to justify.
 */
import { Pool, type PoolClient } from "pg";
import { resetTenantFromPristine } from "../src/lib/demo-reset";

const TENANT = process.env.AXLEPOINT_SEED_TENANT ?? "sample";
const OPTOUT = "i-will-not-be-told-about-failures";

async function alert(message: string): Promise<void> {
  const hook = process.env.RESET_ALERT_WEBHOOK;
  if (!hook) return; // already validated at startup
  try {
    const res = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[axlepoint reset] ${message}` }),
    });
    if (!res.ok) {
      console.error(`alert POST returned ${res.status}; the message did not land.`);
    }
  } catch (err) {
    // An alert that cannot be delivered must still be visible somewhere.
    console.error(
      `alert POST failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function logAttempt(
  pool: Pool,
  row: {
    startedAt: Date;
    ok: boolean;
    rowsRestored: number;
    error?: string;
  },
): Promise<void> {
  // Its own connection and its own transaction, deliberately: the reset's
  // transaction may have just rolled back, and this record must survive that.
  const client: PoolClient = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ops.reset_log (tenant_id, started_at, ok, rows_restored, error)
       VALUES ($1, $2, $3, $4, $5)`,
      [TENANT, row.startedAt, row.ok, row.rowsRestored, row.error ?? null],
    );
  } finally {
    client.release();
  }
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Point it at the database with the demo_reset " +
        "credential; the reset refuses to run as a role that bypasses RLS.",
    );
    return 2;
  }
  if (!process.env.RESET_ALERT_WEBHOOK && process.env.RESET_ALERT_OPTOUT !== OPTOUT) {
    console.error(
      "RESET_ALERT_WEBHOOK is not set.\n" +
        "  A reset that fails silently is worse than one that does not run: the\n" +
        "  demo keeps serving visitor data past its retention window while every\n" +
        "  dashboard looks fine. Point it at somewhere a human actually reads.\n" +
        `  To run without alerting anyway: RESET_ALERT_OPTOUT=${OPTOUT}`,
    );
    return 2;
  }

  const pool = new Pool({ connectionString: url });
  const startedAt = new Date();
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const res = await resetTenantFromPristine(client, TENANT);
    const deleted = res.tables.reduce((n, t) => n + t.deleted, 0);
    const inserted = res.tables.reduce((n, t) => n + t.inserted, 0);

    if (inserted === 0) {
      // "Succeeded" and left the demo blank. That is a failure with a happy
      // exit code unless it is caught here.
      throw new Error(
        "Restored 0 rows: the pristine schema is empty. Run `npm run db:generate` first.",
      );
    }

    await logAttempt(pool, { startedAt, ok: true, rowsRestored: inserted });
    console.log(
      `reset tenant "${TENANT}": removed ${deleted} rows, restored ${inserted}, ` +
        `in ${Date.now() - startedAt.getTime()}ms`,
    );
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`reset FAILED: ${message}`);
    // Log first, then alert: the record is the thing a later freshness check
    // reads, and it must exist even if the alert cannot be delivered.
    await logAttempt(pool, {
      startedAt,
      ok: false,
      rowsRestored: 0,
      error: message,
    }).catch((e) =>
      console.error(`could not even record the failure: ${e?.message ?? e}`),
    );
    await alert(`reset of tenant "${TENANT}" FAILED: ${message}`);
    return 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
