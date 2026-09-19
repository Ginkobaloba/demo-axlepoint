/**
 * Tests for the D-012 seed-reset scheduler (docs/demos/axlepoint/decisions.md).
 *
 * Env vars must be set before the module under test is imported (it reads
 * them at module-evaluation time), so this file sets AXLEPOINT_DB_PATH /
 * AXLEPOINT_SEED_DB_PATH at top-of-file scope and dynamically imports
 * "./db" in beforeAll, mirroring demo-harborbistro/src/lib/retention.test.ts.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "axlepoint-db-test-"));
const LIVE = path.join(TMP_DIR, "axlepoint.db");
const SEED = path.join(TMP_DIR, "axlepoint.seed.db");

process.env.AXLEPOINT_DB_PATH = LIVE;
process.env.AXLEPOINT_SEED_DB_PATH = SEED;
delete process.env.AXLEPOINT_RESET_DISABLED;

type DbModule = typeof import("./db");
let db: DbModule;

function removeSidecars(dbPath: string): void {
  for (const ext of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${ext}`, { force: true });
  }
}

function writeSqliteFile(dbPath: string, rows: string[]): void {
  removeSidecars(dbPath);
  const conn = new Database(dbPath);
  conn.exec("CREATE TABLE work_orders (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
  const insert = conn.prepare("INSERT INTO work_orders (id, title) VALUES (?, ?)");
  for (const [i, title] of rows.entries()) insert.run(`WO-${i}`, title);
  conn.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  conn.close();
}

function ids(dbPath: string): string[] {
  const conn = new Database(dbPath, { fileMustExist: true });
  const rows = conn
    .prepare("SELECT id FROM work_orders ORDER BY id")
    .all() as { id: string }[];
  conn.close();
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  db = await import("./db");
});

describe("resetDbIfDue: no seed snapshot present", () => {
  beforeEach(() => {
    // Close any connection a previous test left open first -- on Windows,
    // rewriting/deleting the file while better-sqlite3 still holds it open
    // fails with EBUSY.
    db._resetAxlepointDbStateForTests();
    removeSidecars(LIVE);
    removeSidecars(SEED);
    writeSqliteFile(LIVE, ["Seeded row"]);
  });

  it("skips the reset and leaves the live file untouched", () => {
    const ran = db.resetDbIfDue(Date.now());
    expect(ran).toBe(false);
    expect(fs.existsSync(SEED)).toBe(false);
    expect(ids(LIVE)).toEqual(["WO-0"]);
  });
});

describe("resetDbIfDue: seed snapshot present", () => {
  beforeEach(() => {
    db._resetAxlepointDbStateForTests();
    removeSidecars(LIVE);
    removeSidecars(SEED);
    writeSqliteFile(SEED, ["Seeded row"]);
    writeSqliteFile(LIVE, ["Seeded row"]);
  });

  it("runs on the first call after boot", () => {
    const t0 = Date.now();
    expect(db.resetDbIfDue(t0)).toBe(true);
  });

  it("does not run again inside the interval", () => {
    const t0 = Date.now();
    expect(db.resetDbIfDue(t0)).toBe(true);
    expect(db.resetDbIfDue(t0 + 60_000)).toBe(false);
  });

  it("runs again once the interval elapses", () => {
    const t0 = Date.now();
    expect(db.resetDbIfDue(t0)).toBe(true);
    expect(db.resetDbIfDue(t0 + db.RESET_INTERVAL_MS)).toBe(true);
  });

  it("drops writes made after the snapshot once due, via getDb()", () => {
    // First call: bootstraps the reset clock (no-op copy, seed == live).
    const opened = db.getDb();
    expect(ids(LIVE)).toEqual(["WO-0"]);

    // A "visitor" writes a row directly through the live connection.
    opened
      .prepare("INSERT INTO work_orders (id, title) VALUES (?, ?)")
      .run("WO-VISITOR", "visitor typed this");
    expect(ids(LIVE)).toEqual(["WO-0", "WO-VISITOR"]);

    // Not due yet: the visitor row survives a getDb() call moments later.
    expect(ids(LIVE)).toEqual(["WO-0", "WO-VISITOR"]);

    // Force a due reset directly (avoids depending on real elapsed time).
    expect(db.resetDbIfDue(Date.now() + db.RESET_INTERVAL_MS + 1)).toBe(true);

    // getDb() must reopen against the now-reset file.
    const rows = db
      .getDb()
      .prepare("SELECT id FROM work_orders ORDER BY id")
      .all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["WO-0"]);
  });

  it("is a no-op when AXLEPOINT_RESET_DISABLED is set", () => {
    process.env.AXLEPOINT_RESET_DISABLED = "1";
    try {
      expect(db.resetDbIfDue(Date.now())).toBe(false);
      expect(db.resetDbIfDue(Date.now() + db.RESET_INTERVAL_MS + 1)).toBe(false);
    } finally {
      delete process.env.AXLEPOINT_RESET_DISABLED;
    }
  });
});
