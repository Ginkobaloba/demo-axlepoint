# 2026-09-19 03:38 CDT - Ledger: one file per entry
- **Who:** Claude Opus 5 (1M context), at the Orchestrator's request, rolling out the pattern from paradigm-site.
- **Change:** this repo had no `docs/LEDGER.md`, so there was nothing to migrate. Added `docs/ledger/README.md`, `scripts/ledger.mjs` (new, check, print) and `scripts/ledger.test.mjs` (vitest), and added `scripts/**/*.test.mjs` to `vitest.config.ts`'s `test.include` so `npm test` runs the check.
- **Why:** every future entry lands in its own file under `docs/ledger/`, so parallel PRs never conflict on a single append-only file the way six open PRs did in paradigm-site.
- **State after:** the ledger is empty except for this entry. `npm test` fails if a future entry is malformed.
- **Refs:** Ginkobaloba/paradigm-site#97, scripts/ledger.mjs, docs/ledger/README.md.
