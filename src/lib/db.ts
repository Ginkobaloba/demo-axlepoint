import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/**
 * SQLite access for the demo. The database file is generated at build time
 * by scripts/generate-db.ts and shipped inside the container image, along
 * with a pristine seed snapshot (axlepoint.seed.db) written by that same
 * script.
 *
 * Anonymous by design (council item 1.2, docs/demos/axlepoint/decisions.md
 * D-012): the API layer never persists what a visitor types (see
 * work-order-validation.ts and api/work-orders/route.ts), and getDb() also
 * resets the live database file back to the seed snapshot on the first
 * call after boot and at most once every RESET_INTERVAL_MS after that, so
 * visitor writes can never outlive one interval even if something upstream
 * regresses. This mirrors demo-harborbistro/src/lib/retention.ts's
 * runRetentionIfDue, which is triggered from getDb() the same way.
 *
 * Every read/write in queries.ts calls getDb() and uses the returned
 * handle synchronously, with no `await` in between -- resetDbIfDue relies
 * on that invariant: it may close and swap the shared connection object
 * out from under a caller that held onto it across an await. Keep query
 * functions synchronous, or re-call getDb() after any await.
 */

const DB_PATH =
  process.env.AXLEPOINT_DB_PATH ??
  path.join(process.cwd(), "data", "axlepoint.db");

const SEED_DB_PATH =
  process.env.AXLEPOINT_SEED_DB_PATH ??
  path.join(process.cwd(), "data", "axlepoint.seed.db");

const DEFAULT_RESET_INTERVAL_MS = 6 * 60 * 60 * 1000;

function parseResetInterval(raw: string | undefined): number {
  const n = Number(raw);
  // A bad override (unset, non-numeric, zero, negative) must not silently
  // become NaN: `nowMs - last < NaN` is always false, which would make
  // every getDb() call think a reset is due and re-copy the ~40 MB
  // database on every request.
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RESET_INTERVAL_MS;
}

export const RESET_INTERVAL_MS = parseResetInterval(
  process.env.AXLEPOINT_RESET_INTERVAL_MS,
);

declare global {
  // eslint-disable-next-line no-var
  var __axlepointDb: Database.Database | undefined;
  // eslint-disable-next-line no-var
  var __axlepointResetLastRun: number | undefined;
  // eslint-disable-next-line no-var
  var __axlepointSeedMissingWarned: boolean | undefined;
}

function removeSidecars(dbPath: string): void {
  for (const ext of ["-wal", "-shm"]) {
    const p = dbPath + ext;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

/**
 * Resets the live database to its build-time seed snapshot. Runs at most
 * once per RESET_INTERVAL_MS per process; the first call after boot always
 * runs (global.__axlepointResetLastRun starts undefined), so a long-lived
 * container without a redeploy still gets reset promptly, not just on the
 * next interval boundary.
 *
 * If no seed snapshot exists -- a dev checkout where `npm run db:generate`
 * predates this feature, or a test fixture that intentionally omits one --
 * the reset is skipped (logged once) rather than bootstrapped from
 * whatever is currently at DB_PATH. Bootstrapping from the live file would
 * silently freeze a developer's freshly regenerated database as "the seed"
 * the next time this runs, which fights CLAUDE.md's instruction to
 * regenerate after touching anomaly.ts/risk.ts.
 *
 * Never throws: a failed reset is logged and retried on the next interval
 * rather than breaking the request that triggered it.
 */
export function resetDbIfDue(nowMs = Date.now()): boolean {
  if (process.env.AXLEPOINT_RESET_DISABLED === "1") return false;
  const last = global.__axlepointResetLastRun;
  if (last !== undefined && nowMs - last < RESET_INTERVAL_MS) return false;
  global.__axlepointResetLastRun = nowMs;

  if (!fs.existsSync(SEED_DB_PATH)) {
    if (!global.__axlepointSeedMissingWarned) {
      global.__axlepointSeedMissingWarned = true;
      console.warn(
        `[reset] no seed snapshot at ${SEED_DB_PATH}; skipping the visitor-data reset. Run "npm run db:generate" to create one.`,
      );
    }
    return false;
  }

  try {
    if (global.__axlepointDb) {
      global.__axlepointDb.close();
      global.__axlepointDb = undefined;
    }
    removeSidecars(DB_PATH);
    // Copy to a temp file first and rename over the live path, rather than
    // copying directly onto DB_PATH: a mid-copy failure (disk full, an
    // interrupted process) would otherwise leave a truncated, unopenable
    // live database with no connection left to serve requests until the
    // next redeploy. Rename is atomic once the copy has fully landed.
    const tmp = `${DB_PATH}.reset-tmp`;
    fs.copyFileSync(SEED_DB_PATH, tmp);
    fs.renameSync(tmp, DB_PATH);
    return true;
  } catch (err) {
    // One line, not a full stack: this runs on every due interval, and a
    // misconfigured short interval (see AXLEPOINT_RESET_INTERVAL_MS above)
    // would otherwise spam the log with a repeated stack trace for the
    // same underlying condition (deep-verify PR #24, minor finding).
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[reset] axlepoint seed reset failed: ${message}`);
    return false;
  }
}

function open(): Database.Database {
  const db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  return db;
}

export function getDb(): Database.Database {
  resetDbIfDue();
  if (!global.__axlepointDb) {
    global.__axlepointDb = open();
  }
  return global.__axlepointDb;
}

/** Test-only: clears the cached connection and reset timers between tests. */
export function _resetAxlepointDbStateForTests(): void {
  if (global.__axlepointDb) {
    try {
      global.__axlepointDb.close();
    } catch {
      // already closed
    }
  }
  global.__axlepointDb = undefined;
  global.__axlepointResetLastRun = undefined;
  global.__axlepointSeedMissingWarned = undefined;
}

export { DB_PATH, SEED_DB_PATH };
