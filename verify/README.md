# verify/

This directory declares what "passing" means for **this repo**. The engine that
reads and executes these files is the `paradigm-verify` skill. No central
choke point -- each repo owns its own assertions.

## Why this exists

Central verify configs become coupling points. A per-repo `verify/` lets each
project define its own surfaces, thresholds, and risk tiers without touching
shared infrastructure. The skill is the engine; this directory is the spec.

## File layout

```
verify/
  smoke.yml              -- fast surface checks run on every PR
  tier_map.yml           -- surface risk classification (Tier 1-3)
  assertions/
    <surface>.yml        -- full assertion set per surface (deep verify)
    README.md            -- explains the assertions/ convention
  README.md              -- this file
```

## How to run

**Quick (every PR):**
```
/verify <repo-path>
```
Runs `smoke.yml` only. Fast. Safe to require in CI.

**Deep (before merge on Tier-3 surfaces):**
```
/verify deep <repo-path>
```
Runs all `assertions/<surface>.yml` files. Required before merging any PR
that touches a surface marked `tier: 3` in `tier_map.yml`.

## How to extend

- **Add a surface to smoke.yml** -- append a new entry under `surfaces:` with
  at least an `http_status` assertion.
- **Add full assertions** -- create `assertions/<surface>.yml` mirroring the
  surface name from `smoke.yml`. Use the `assertions/home.yml` file as the
  template.
- **Mark a surface Tier-3** -- add or update the entry in `tier_map.yml` with
  `tier: 3` and `deep_verify_before_merge: true`. Include a `reason`.

## Placeholders

All `<ALL_CAPS>` values in these files are project-specific and must be
replaced before the verify suite is meaningful. Search for `<` to find them.

## Deep-verify reports and the tier-3 gate

A PR labeled `tier-3` merges only with a committed deep-verify report for THAT PR,
covering THAT code. `verify/ci/deep_gate.sh <pr-number> <head-sha>` (run by the
Deep Verify job) accepts a report only if all of these hold:

- the file is `verify/reports/DEEP_VERIFY_<YYYY-MM-DD>_pr<N>-<slug>.md`, where
  `<N>` is this PR's number (`pr3` never matches `pr30`);
- it has the line `Overall: PASS` and no `Overall: FAIL`;
- it has the line `Tested-SHA: <full 40-hex sha>`, naming the commit the run
  built and tested;
- that commit is the PR head or an ancestor of it, and every change from it to
  the head is under `verify/reports/`.

Commit the report as a child of the tested commit. If the code changes after
the run, the report no longer counts and the deep run has to be repeated. The
gate's own tests are `verify/ci/test_deep_gate.sh` (run in Quick Verify).

If the PR is updated from main after the run (for example "Update branch", or
a required up-to-date check), the merge brings in files outside
`verify/reports/` and the old Tested-SHA stops counting. Then:

1. update the PR from main, which creates merge commit M;
2. confirm no app code came in:
   `git diff --name-only <old Tested-SHA> M -- . ':(exclude)verify/' ':(exclude).github/'`
   must print nothing (if it prints files, re-run the deep verify);
3. add one report-only commit that sets `Tested-SHA:` to the full sha of M;
4. merge.
