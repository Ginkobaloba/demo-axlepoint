/**
 * Assert the demo reset actually ran recently. Exits non-zero if it did not.
 *
 *   DATABASE_URL=... npm run check:reset
 *   DATABASE_URL=... RESET_MAX_AGE_HOURS=6 npm run check:reset
 *
 * WHY A CHECK AND NOT A DASHBOARD. D-012 promises visitor-entered text cannot
 * outlive one interval. That promise is kept by a scheduled job, and a
 * scheduled job that silently stops is indistinguishable from one that is
 * working -- the demo looks fine, the pages render, and the data quietly ages
 * past its retention window. This is the thing that fails when that happens.
 *
 * IT DISTINGUISHES THREE FAILURES, because they need different responses:
 *   - never ran      -> the schedule was never wired up (a deploy mistake)
 *   - last run FAILED -> the schedule works, the reset is broken
 *   - stale          -> the schedule stopped, or is running too slowly
 *
 * A single "is it fresh?" boolean would collapse all three into "no", and the
 * first one is the one a deploy must refuse to proceed past.
 */
import { Pool } from "pg";
import {
  assessResetFreshness,
  describeVerdict,
  exitCodeFor,
  type ResetLogRow,
} from "../src/lib/reset-freshness";

const TENANT = process.env.AXLEPOINT_SEED_TENANT ?? "sample";
const MAX_AGE_HOURS = Number(process.env.RESET_MAX_AGE_HOURS ?? "6");

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    return 2;
  }
  if (!Number.isFinite(MAX_AGE_HOURS) || MAX_AGE_HOURS <= 0) {
    console.error(
      `RESET_MAX_AGE_HOURS is not a positive number: ${process.env.RESET_MAX_AGE_HOURS}`,
    );
    return 2;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const latest = (
      await pool.query<ResetLogRow>(
        `SELECT ok, finished_at, rows_restored, error FROM ops.reset_log
          WHERE tenant_id = $1 ORDER BY finished_at DESC LIMIT 1`,
        [TENANT],
      )
    ).rows[0];

    // The verdict logic is pure and lives in src/lib/reset-freshness.ts, so
    // its STALE and NEVER_RAN branches are testable without waiting six hours
    // or faking a clock against a live database.
    const verdict = assessResetFreshness(latest, MAX_AGE_HOURS);
    const line = describeVerdict(verdict, TENANT);
    if (verdict.kind === "OK") console.log(`${line} (limit ${MAX_AGE_HOURS}h)`);
    else console.error(line);
    return exitCodeFor(verdict);
  } finally {
    await pool.end();
  }
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
