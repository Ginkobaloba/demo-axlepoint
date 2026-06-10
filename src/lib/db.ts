import Database from "better-sqlite3";
import path from "path";

/**
 * SQLite access for the demo. The database file is generated at build time
 * by scripts/generate-db.ts and shipped inside the container image. The
 * only runtime writes are demo work-order drafts, which intentionally live
 * in the container layer and reset on redeploy.
 */

const DB_PATH =
  process.env.AXLEPOINT_DB_PATH ??
  path.join(process.cwd(), "data", "axlepoint.db");

declare global {
  // eslint-disable-next-line no-var
  var __axlepointDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!global.__axlepointDb) {
    const db = new Database(DB_PATH, { fileMustExist: true });
    db.pragma("journal_mode = WAL");
    global.__axlepointDb = db;
  }
  return global.__axlepointDb;
}
