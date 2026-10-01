/**
 * Restore the demo tenant from the pristine dataset, record the attempt, and
 * tell a human if it failed.
 *
 *   DATABASE_URL=postgres://demo_reset:...@host/db \
 *   RESET_ALERT_WEBHOOK=https://hooks.slack.com/... \
 *   npm run db:reset
 *
 * The alert destination may instead be a Slack bot token plus a channel
 * (RESET_ALERT_SLACK_TOKEN + RESET_ALERT_SLACK_CHANNEL). Both transports, and
 * the reason they are not interchangeable, live in src/lib/reset-alert.ts.
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
import {
  ALERT_OPTOUT,
  deliverAlert,
  resolveAlertTarget,
  type AlertTarget,
} from "../src/lib/reset-alert";

const TENANT = process.env.AXLEPOINT_SEED_TENANT ?? "sample";

/** Resolved once at startup, so a misconfiguration is a startup error. */
let alertTarget: AlertTarget | null = null;

async function alert(message: string): Promise<void> {
  if (!alertTarget) return; // already validated in main()
  const delivery = await deliverAlert(alertTarget, message, (url, init) => fetch(url, init));
  if (!delivery.delivered) {
    // An alert that cannot be delivered must still be visible somewhere.
    // deliverAlert's detail never contains the token.
    console.error(`alert not delivered: ${delivery.detail}`);
  }
}

async function logAttempt(
  pool: Pool,
  row: {
    /** How long the attempt took, measured as a DURATION (monotonic-ish), not
     *  as a host wall-clock instant. The database turns it into a timestamp. */
    elapsedSeconds: number;
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
      // started_at is derived from the DATABASE clock as well: the row's two
      // timestamps must be comparable to each other, and a host-stamped
      // started_at beside a now()-stamped finished_at is not.
      `INSERT INTO ops.reset_log (tenant_id, started_at, ok, rows_restored, error)
       VALUES ($1, now() - make_interval(secs => $2), $3, $4, $5)`,
      [TENANT, row.elapsedSeconds, row.ok, row.rowsRestored, row.error ?? null],
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
  const resolved = resolveAlertTarget(process.env);
  for (const warning of resolved.warnings) console.error(warning);
  if (!resolved.target) {
    console.error(resolved.error);
    return 2;
  }
  // Keep the opt-out visible in the run's own output: a reset that is
  // deliberately not alerting should say so every time, not quietly.
  if (resolved.target.kind === "optout") {
    console.error(`Running with no alert destination (RESET_ALERT_OPTOUT=${ALERT_OPTOUT}).`);
  }
  alertTarget = resolved.target;

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

    await logAttempt(pool, {
      elapsedSeconds: (Date.now() - startedAt.getTime()) / 1000,
      ok: true,
      rowsRestored: inserted,
    });
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
      elapsedSeconds: (Date.now() - startedAt.getTime()) / 1000,
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
