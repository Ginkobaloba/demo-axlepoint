# 2026-09-25 02:54 CDT - Harden the tenant layer after independent review
- **Who:** Claude (Opus 5), acting on Fable's and Gemini's reviews of #40, relayed by the Orchestrator.
- **Change:** Step 1.5 hardening of `db/schema.sql` and `src/lib/pg.ts`, plus 8
  new tests (19 -> 27). Handle expiry via a `done` flag; `COMMIT` command-tag
  check; pool `error` listener; `getPool` renamed `__getPoolForTests`;
  `anomalies.id` identity -> `uuid`; `CHECK (tenant_id <> '')` on all 11 tables
  and `NULLIF` in the policy; role block moved first, made conditional, password
  removed; a guard and a test refusing views/matviews/foreign tables; tests for
  exactly-one-policy and for FK column lists; walk pinned to `public`.
- **Why:** Every item was TESTED before being acted on, not taken on the
  reviewers' word -- they disagreed on one, and three turned out other than
  described. A fix for a bug that is not there costs as much as a missed one.
- **State after:** 27/27 green. Five mutations of the new guards each turn the
  suite red: expired-handle check removed (1), `COMMIT` check removed (1), a
  `CHECK` dropped from one table (1), a second permissive policy added (8), a
  view added to public (1). Typecheck clean, lint 0 errors.
  Three results worth carrying forward:
  - **Refuted:** a failed `ROLLBACK` does NOT return a dirty client to the pool.
    Measured both ways; the next borrow got a fresh pid either way. Fable right,
    Gemini wrong. Not asserted in a test, because asserting behaviour that does
    not exist is how a suite starts lying.
  - **Right conclusion, wrong mechanism:** the re-apply aborts at
    `CREATE TABLE meta`, not `CREATE POLICY`, so the suggested
    `DROP POLICY IF EXISTS` would have fixed nothing. The real defect was the
    role block sitting last; it now runs first.
  - **Found while testing the claims:** node-postgres emits `error` on the POOL
    for a client that dies while idle, and with no listener that is an uncaught
    exception. Terminating one backend crashed the probe outright -- a Neon
    scale-to-zero or failover would have taken the app down. More serious than
    the claim being investigated, and missed by both reviewers.
  Also recorded in D-023: GUC-based RLS defends against a forgotten `WHERE`, NOT
  against SQL injection, since injected SQL can `set_config(..., false)` and
  persist it on a pooled client.
- **Refs:** D-023, #40, D-022. Next: step 2, the type-driven query port.
