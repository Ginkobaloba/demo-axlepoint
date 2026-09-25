/**
 * Restore the demo tenant from the pristine dataset.
 *
 *   DATABASE_URL=postgres://demo_reset:...@host/db npm run db:reset
 *
 * THIS SCRIPT DOES NOT SCHEDULE ITSELF, and that is the deliberate half of the
 * design. On SQLite the 6-hourly reset was triggered from getDb() inside the
 * request path, throttled by a module-level timestamp. That had to go: the
 * timestamp does not survive a process restart, so *the throttle broke before
 * the reset did*, and on a serverless runtime it would break constantly.
 *
 * So the schedule is an OPERATIONS concern now -- a cron entry, a Cloudflare
 * cron trigger, or a Durable Object alarm -- and it runs OUTSIDE the app
 * process with its own credential. The app role cannot perform a reset at all:
 * only demo_reset can, and demo_reset is confined by a RESTRICTIVE policy to
 * the sample tenant.
 *
 * UNTIL SOMETHING SCHEDULES IT, D-012's retention promise is not being kept on
 * a deployed instance. That is stated in D-026 rather than left implicit,
 * because a reset that exists and never runs looks exactly like a reset that
 * works.
 */
import { Pool } from "pg";
import { resetTenantFromPristine } from "../src/lib/demo-reset";

const TENANT = process.env.AXLEPOINT_SEED_TENANT ?? "sample";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the database with the demo_reset " +
        "credential; the reset refuses to run as a role that bypasses RLS.",
    );
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const started = Date.now();
    const res = await resetTenantFromPristine(client, TENANT);
    const deleted = res.tables.reduce((n, t) => n + t.deleted, 0);
    const inserted = res.tables.reduce((n, t) => n + t.inserted, 0);
    console.log(
      `reset tenant "${TENANT}": removed ${deleted} rows, restored ${inserted}, ` +
        `in ${Date.now() - started}ms`,
    );
    // A restore that inserted nothing means the pristine dataset is empty --
    // the reset "succeeded" and left the demo blank. Fail instead.
    if (inserted === 0) {
      throw new Error(
        "Restored 0 rows: the pristine schema is empty. Run `npm run db:generate` first.",
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
