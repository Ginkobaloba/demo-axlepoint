# 2026-09-25 05:52 CDT - Seed generator writes to Postgres, verified row-identical
- **Who:** Claude (Opus 5), AxlePoint port step 3a.
- **Change:** `scripts/generate-db.ts` seeds a Postgres tenant via a new
  `scripts/lib/pg-sink.ts` adapter; `AXLEPOINT_NOW_TS` pins the time anchor;
  `check-kpis.ts` and `inspect-db.ts` ported; the 117-line dead SQLite DDL block
  deleted; the Dockerfile no longer generates a database at build time and ships
  no `data/`. D-025.
- **Why:** An adapter rather than a rewrite so all ~1000 lines of generation
  logic stay BYTE-IDENTICAL, which is what made the result measurable instead of
  arguable.
- **State after:** SQLite and Postgres runs against the same pinned anchor were
  compared field by field, sorted, numerically normalised: **all 11 tables,
  545,929 rows, EVERY TABLE IDENTICAL** (sensor_readings alone is 543,981).
  Counts would not have shown this -- a port that got every risk_score subtly
  wrong produces identical counts. CLAUDE.md's acceptance criteria pass:
  critical=4 (sane 3-6), distinct top scores 95/90/89, MTBF delta -19% (within
  +/-35%). tsc 0 errors, lint 0 errors, unit 120 passed, integration 48 passed,
  `npm run build` compiles with no database, seed runs in 5.5s.
  Orchestrator's five-trap checklist applied: `::int` on every COUNT and
  `value::bigint` (int8-as-string); no aliases needing quotes; no LIKE; GROUP BY
  only on non-`*` selects; no database-side read-modify-write in the generator,
  so FOR UPDATE does not apply here (it is already in queries.ts where it does).
- **NOT DONE, and deliberately:** the 6-hourly visitor-data reset has no
  Postgres implementation. On SQLite it was a file copy and D-012 depends on it
  so visitor text cannot outlive one interval. `src/lib/db.ts`, its test and the
  SQLite fixture are therefore KEPT rather than deleted -- removing a privacy
  control and its tests before the replacement exists is how "we will do it
  next" becomes permanent. They go in the same change that lands the reset.
- **UNVERIFIED:** the Dockerfile change is not exercised by a real build. The
  build fails earlier at `npm ci` with E401 on @paradigm-codes/auth, which is
  the known read:packages blocker (Drew), and a credential failure is a stop
  sign. My edits are in the runtime stage, after the failure point.
- **Refs:** D-025, D-024. AxlePoint still must not be redeployed until its
  Postgres exists.
