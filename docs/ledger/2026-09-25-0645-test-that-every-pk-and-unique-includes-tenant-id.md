# 2026-09-25 06:45 CDT - Test that every PK and UNIQUE includes tenant_id
- **Who:** Claude (Opus 5). Found while planning the harborbistro port.
- **Change:** One test in `src/lib/pg.rls.itest.ts` asserting every PRIMARY KEY
  and UNIQUE constraint on a public table includes `tenant_id`.
- **Why:** The independent review checked "all PK/UNIQUE include tenant_id" by
  inspection and was right at the time -- but **nothing held it**. Proved the
  gap by mutation: adding a global `sku text NOT NULL UNIQUE` to `parts`
  left all 60 tests GREEN.
  A global unique is a tenancy bug that only appears with a SECOND tenant. The
  first works perfectly; the second silently cannot insert a row whose
  slug/sku/code another tenant already used. It surfaced because
  **harborbistro has exactly that shape waiting**: `menu_items.slug TEXT NOT
  NULL UNIQUE`. Catching it now stops the pattern being copied into three more
  demos.
- **State after:** 61 tests pass. Both mutations red: a global UNIQUE, and a
  PRIMARY KEY without `tenant_id`.
- **A trap worth recording, hit while writing this:** the first version used a
  regex with `\b`, written through a NON-RAW Python string. Python turns
  `\b` into a literal BACKSPACE (0x08), so an invisible control character
  landed in the source. It corrupted SILENTLY rather than erroring, the regex
  matched nothing sensible, and the test failed against a schema that was
  entirely correct. **The baseline run caught it, not the mutation** -- had I
  only checked that the mutation went red, I would have shipped a test that
  fails on everything, which is as useless as one that never fails and noisier.
  Replaced with plain string parsing, which cannot be mangled; the file is now
  verified to contain no control characters at all.
- **Refs:** D-022 (composite primary keys), `C:\dev\DEMOS_POSTGRES_PORT_PLAN.md`.
