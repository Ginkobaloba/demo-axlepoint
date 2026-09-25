# 2026-09-25 02:36 CDT - Postgres schema and tenant-scoped access layer with an RLS leak suite
- **Who:** Claude (Opus 5), P1 AxlePoint port, step 1 of the sequence.
- **Change:** `db/schema.sql` (10 tables ported from the SQLite DDL, `tenant_id`
  everywhere, composite `(tenant_id, id)` primary keys, RLS applied by walking the
  catalog, plus the unprivileged `axlepoint_app` role); `src/lib/pg.ts`
  (`withTenant()`, the only handle query functions will ever see);
  `src/lib/pg.rls.itest.ts` (19 tests); `vitest.rls.config.ts` and
  `npm run test:rls`; `docker-compose.dev.yml`; a Postgres service and a named CI
  step; decision D-022. No query ported, nothing wired into the app.
- **Why:** The tenancy model has to be settled and PROVEN before ~56 query
  functions move, because every one of them inherits whatever this gets wrong.
- **State after:** 19/19 pass against Postgres 18. Mutation-checked, and two of
  the five mutations came back GREEN, which is the reason the work was worth
  doing rather than a footnote:
  - `BYPASSRLS` granted to the app role -> green. Not a test gap: roles are
    CLUSTER-level, so `DROP SCHEMA` never removes them and `CREATE ROLE IF NOT
    EXISTS` had run exactly once. The security attributes were therefore
    unenforceable. Fixed with an unconditional `ALTER ROLE`; the same mutation
    now fails 8 tests, as does `SUPERUSER`.
  - `WITH CHECK` deleted -> green, and correctly so: Postgres uses `USING` for
    new rows when `WITH CHECK` is omitted. The clause was never load-bearing,
    so the schema comment claiming it stopped cross-tenant INSERTs was FALSE and
    was corrected rather than left as a reassuring wrong explanation.
  The finding that justified the whole step: the first run connected as the
  Docker image's `POSTGRES_USER`, which is a SUPERUSER, and RLS does not apply to
  superusers at all -- `FORCE` cannot override `BYPASSRLS`. Every policy was
  inert while the schema read as correct. Had the tests used the
  `WHERE tenant_id = $1` that real query functions carry, all of them would have
  passed while RLS did nothing.
  Typecheck clean, lint 0 errors, existing unit suite 137 passed and untouched.
- **Refs:** D-022; `C:\dev\AXLEPOINT_WORKERS_FEASIBILITY_2026-09-25.md` section 3;
  `paradigm-ops/tools/neon/rls-set-local-probe.mjs` for the still-unmeasured Neon
  HTTP question. Next: port the ~56 query functions type-driven, so a missed
  `await` is a compile error.
