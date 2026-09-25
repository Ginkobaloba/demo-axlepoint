# 2026-09-25 06:06 CDT - Postgres demo reset, and retire the SQLite path
- **Who:** Claude (Opus 5), AxlePoint port step 3b. Reset design proposed by the Orchestrator; I probed it, found a gap, and closed it.
- **Change:** `pristine` schema (no RLS, no tenant_id, built `LIKE ... INCLUDING
  DEFAULTS` from the live tables); a `demo_reset` role confined by a
  RESTRICTIVE policy; `src/lib/demo-reset.ts` with a refuse-if-RLS-inert guard;
  `npm run db:reset`; seeding now runs through the reset. Deleted
  `src/lib/db.ts`, `db.test.ts`, the SQLite fixture and `better-sqlite3`. D-026.
- **Why:** D-012 promises visitor text cannot outlive one interval. The
  replacement had to exist before the SQLite path could go, which is why 3a
  deliberately kept it.
- **The gap I found in the proposed design, and closed:** `app.tenant_id` is set
  BY the connecting role, so a reset role that can set it can name a paying
  customer and RLS scopes to that instead. **Measured on a scratch table: with
  only the permissive policy, demo_reset scoped to a second tenant read that
  tenant's row.** A RESTRICTIVE policy is AND-ed rather than OR-ed, so
  `reset_sample_only` pins the role to the sample tenant regardless of the GUC.
  Re-measured: scoped elsewhere it reads nothing, its INSERT is refused, its
  DELETE leaves the other tenant intact, and the sample tenant stays readable.
- **The hazard in my own first draft:** the reset's DELETE has no WHERE, because
  RLS scopes it. Run as a superuser -- which the seeding connection IS locally
  -- RLS is inert and it removes EVERY tenant's rows. Guarded by checking
  `rolsuper`/`rolbypassrls` and throwing. A belt-and-braces WHERE would have
  been worse: it would let the function survive a missing policy, the exact
  condition the tests must detect.
- **State after:** tsc 0, lint 0 errors, unit 114 passed, integration **60
  passed** across 3 files (12 of them new reset tests), seed+reset end to end,
  standalone reset removes and restores 545,929 rows in 2.0s.
  Mutation-checked, all five red: BYPASSRLS granted (7 failed); restrictive
  policy removed (4); policy pinned to `USING (true)` (2); superuser guard
  removed (2); pristine exposed to the app role (1).
  Two of my earlier tests needed correcting, and one was a REAL latent bug: the
  RLS-coverage test joined `pg_class` on `relname` alone -- flagged in review as
  theoretical, and actual once `pristine.*` shared names with `public.*`.
- **NOT DONE, stated loudly:** nothing schedules the reset. The old in-request
  throttle is gone on purpose (its timestamp did not survive a restart, so the
  throttle broke before the reset did). **Until cron or an equivalent runs
  `npm run db:reset`, D-012's retention promise is not kept on a deployed
  instance.** Must be wired as part of the deploy, not after it.
- **UNVERIFIED:** Dockerfile changes still unexercised -- `docker build` fails
  earlier at `npm ci` with E401 (read:packages, with Drew). The compile
  toolchain is kept rather than removed for the same reason: its failure mode
  cannot be observed here.
- **Refs:** D-026, D-025, D-023. AxlePoint still must not be redeployed until
  its Postgres exists.
