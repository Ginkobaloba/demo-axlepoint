# 2026-09-25 06:18 CDT - Deploy runbook and the reset schedule as code
- **Who:** Claude (Opus 5), AxlePoint step 4, at the Orchestrator's request.
- **Change:** `docs/ops/DEPLOY_POSTGRES.md` (the runbook); `ops.reset_log` and
  the `ops` schema; `ops/reset-sidecar/compose.yml` plus a `reset` stage in the
  Dockerfile; reset logging and a mandatory alert destination in
  `scripts/reset-demo.ts`; `npm run check:reset` over a pure verdict in
  `src/lib/reset-freshness.ts`; `db/reset-schemas.sql`. D-027.
- **Why:** So the deploy is ready the moment Drew creates the Neon project, and
  so "the reset is scheduled" is a checkable fact rather than a note.
- **State after:** tsc 0, lint 0 errors, unit **121 passed** (7 new freshness
  tests), integration 60 passed, seed + gate + reset verified end to end
  locally: seeding records itself and `check:reset` passes at 0.0h; a real run
  as demo_reset removed and restored 545,929 rows; the script refuses to start
  with no `RESET_ALERT_WEBHOOK`.
  Freshness logic mutation-checked, all four red: NEVER_RAN reported as OK (2
  failed); a failed run reported as OK (3); staleness never firing (2); non-OK
  verdicts exiting zero (4).
- **Three design traps worth keeping:**
  1. The reset would have ERASED ITS OWN AUDIT TRAIL. `meta` is a public table,
     so every reset restores it from pristine and deletes the timestamp just
     written. The log has to live outside the schema the reset walks.
  2. A failed reset must still log, in its own transaction, or "no recent
     success" cannot tell "never ran" from "ran and failed".
  3. An unconfigured alert path must be a STARTUP ERROR, not a silent no-op.
     The recurring version of this defect is an alert that fires correctly into
     a channel nobody reads.
- **Also:** `db/reset-schemas.sql` exists because adding `pristine`, then `ops`,
  broke every caller carrying its own hand-written DROP line, twice, with the
  same symptom. One list, one place, and deliberately NOT inside `schema.sql`,
  which a production deploy runs and which must never carry DROP statements.
- **NOT TRUE YET:** nothing schedules the reset in any environment; the sidecar
  image has never been built (`docker build` blocked at `npm ci` with E401,
  read:packages); nothing in the runbook has been run against Neon, and the
  conditional `ALTER ROLE` path is the step most likely to differ there;
  `deploy-demo.ps1` does not yet call `check:reset` (a cloudflare-config change,
  its own PR).
- **Refs:** D-027, D-026, D-022. AxlePoint still must not be redeployed until
  its Postgres exists.
