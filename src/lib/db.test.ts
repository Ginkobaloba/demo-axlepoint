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

// Deep-verify PR #24 blocker B2: fs.copyFileSync preserves the source
// file's permission bits, so a read-only seed (Dockerfile chmod 444) made
// the copied-then-renamed live database read-only too, and a read-only
// leftover temp file (from a crash mid-copy) permanently blocked every
// later reset. POSIX file modes are not meaningful on Windows (chmod is a
// no-op there beyond toggling the DOS read-only attribute for the owner,
// and even that does not reproduce the Linux container's failure mode),
// so these run only where the mode bits actually mean something -- with a
// clear skip message rather than passing trivially and proving nothing.
const isPosix = process.platform !== "win32";

describe("resetDbIfDue: read-only seed (B2 regression)", () => {
  beforeEach(() => {
    db._resetAxlepointDbStateForTests();
    removeSidecars(LIVE);
    removeSidecars(SEED);
    writeSqliteFile(SEED, ["Seeded row"]);
    writeSqliteFile(LIVE, ["Seeded row"]);
    if (isPosix) fs.chmodSync(SEED, 0o444);
  });

  it.skipIf(!isPosix)(
    "a 0o444 seed still leaves the live database writable after a reset " +
      "(POSIX only: chmod does not reproduce the container's failure mode on win32)",
    () => {
      expect(db.resetDbIfDue(Date.now())).toBe(true);

      // The bug: fs.copyFileSync propagated the seed's read-only mode onto
      // the live file. Confirm it did not, both by checking the mode bit
      // and by actually writing through it, which is what a real request
      // does and what the deep-verify report's 500s were.
      const mode = fs.statSync(LIVE).mode & 0o777;
      expect(mode & 0o200).toBeTruthy(); // owner-writable bit set

      const conn = new Database(LIVE, { fileMustExist: true });
      expect(() =>
        conn.prepare("INSERT INTO work_orders (id, title) VALUES (?, ?)").run(
          "WO-WRITE-CHECK",
          "a write after reset must succeed",
        ),
      ).not.toThrow();
      conn.close();
    },
  );

  it.skipIf(!isPosix)(
    "a stale read-only leftover temp file does not block the next reset " +
      "(POSIX only: chmod does not reproduce the container's failure mode on win32)",
    () => {
      // Simulate a crash mid-copy: a previous reset got as far as creating
      // the temp file (inheriting the seed's read-only mode) but never
      // reached the rename. fs.copyFileSync cannot overwrite a read-only
      // destination, so without the fix every later resetDbIfDue call
      // would fail with EACCES, forever, until a redeploy.
      const tmp = `${LIVE}.reset-tmp`;
      fs.writeFileSync(tmp, "stale partial copy from a simulated crash");
      fs.chmodSync(tmp, 0o444);

      expect(db.resetDbIfDue(Date.now())).toBe(true);
      expect(ids(LIVE)).toEqual(["WO-0"]);

      const conn = new Database(LIVE, { fileMustExist: true });
      expect(() =>
        conn.prepare("INSERT INTO work_orders (id, title) VALUES (?, ?)").run(
          "WO-WRITE-CHECK-2",
          "a write after recovering from a stale tmp must succeed",
        ),
      ).not.toThrow();
      conn.close();
    },
  );
});
