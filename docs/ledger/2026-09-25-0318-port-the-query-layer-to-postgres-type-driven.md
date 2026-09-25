# 2026-09-25 03:18 CDT - Port the query layer to Postgres, type-driven
- **Who:** Claude (Opus 5), AxlePoint port step 2.
- **Change:** ~44 query functions in `src/lib/queries.ts` now take a `TenantDb`
  and return `Promise<T>`; all 21 caller files updated; `src/lib/tenant.ts` is
  the single place the tenant is resolved; `queries.types.test.ts` asserts the
  contract by enumeration; the 494-line `route.test.ts` became
  `route.itest.ts` against Postgres with **every assertion unchanged**;
  `axlepoint-pg-fixtures.ts` replaces the SQLite fixture. D-024.
- **Why:** A missed `await` is not reliably loud -- a Promise in JSX renders
  nothing and a Promise in a boolean test is always truthy. Making every return
  `Promise<T>` turned that class into a compile error: `tsc` produced exactly
  300 errors across 20 files, and that list was the work plan.
- **State after:** tsc 0 errors; unit 120 passed (database-free); integration
  48 passed (27 RLS + 21 route); lint 0 errors; `npm run build` still succeeds
  with no database, as verify.yml's comment requires.
  Five dialect traps that would have failed SILENTLY are in D-024. The two
  worth repeating anywhere else: **Postgres folds unquoted identifiers to lower
  case**, so `MAX(x) maxScore` returns `maxscore` and every value reads
  `undefined` through a type that still says `maxScore`; and **int8 arrives as a
  string**, so `COUNT(*)` and every `bigint` timestamp would have been strings
  behind a `number` type.
  One trap was self-inflicted and worth noting: D-022's composite primary key
  made `SELECT po.* ... GROUP BY po.id` illegal, because Postgres allows that
  only when the grouped columns are the PK. A schema decision changed what was
  legal in a query three files away.
  Two things the port improved rather than preserved: check-then-write races in
  `PATCH /api/work-orders/[id]` are closed (validation and write now share one
  transaction), and pages render from one snapshot instead of N statements.
  Also fixed a latent flake found while verifying: both integration files
  rewrote the shared `process.env.DATABASE_URL`, so the suite's result depended
  on which file vitest ran first. Both now restore it, verified by running the
  suite in both orders.
- **Refs:** D-024, D-022, D-023. **Deployment consequence: AxlePoint cannot be
  redeployed until a Postgres exists for it.** Merging is safe -- `next build`
  never reads the database and the live demo keeps serving its existing image --
  but the next deploy needs `DATABASE_URL`. Next: port the seed generator and
  retire `src/lib/db.ts`.
