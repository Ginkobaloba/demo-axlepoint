# 2026-10-01 08:47 CDT - The smoke gate reddened at random: grep -q plus pipefail
- **Who:** Claude (AxlePoint session)
- **Change:** `verify/ci/quick_smoke.sh` no longer pipes `yq` into `grep -q` to decide
  whether a surface declares `redirects_to`. It captures the types and matches them in
  bash with a newline-wrapped substring test, which spawns nothing. Added
  `scripts/pipefail-shortcircuit.test.mjs`, a repo-wide check that no shell script
  setting `pipefail` pipes a producer into `grep -q`.
- **Why:** The `Live smoke` job failed on PR #55 with
  `undeclared redirect: requested /app, landed on /?signin=required` for the
  `dashboard-gated` surface, which **does** declare `redirects_to`
  (`verify/smoke.yml:39`). It then passed on a re-run of the same commit, and the
  commit before it had passed. The site was fine: `/app` probed 12 times returned
  `307 -> /?signin=required` 12/12, and the script passed locally.
  Root cause. The script sets `set -uo pipefail` (line 22) and had
  `if yq -r "...assertions[].type" "$SMOKE" | grep -qx redirects_to`. **`grep -q`
  exits on the first match**, so `yq` takes EPIPE while still writing the remaining
  types and exits non-zero; pipefail makes the pipeline's status that failure, the
  `if` takes the else branch, and `redirect_declared=0`. A surface that declares the
  assertion is then reported as not declaring it.
  It is a race on whether `yq` flushed and exited before `grep` matched, so it
  reddens at random and the failure points at the thing being tested rather than at
  the test. Reproduced deterministically with a producer that sleeps between writes:
  `producer() { echo redirects_to; sleep 0.3; echo http_status; }` piped into
  `grep -qx redirects_to` reports NOT declared under pipefail, while the pipe-free
  form reports declared.
  The window is the number of lines left unread, which is exactly why
  `dashboard-gated` (four assertions) flaked while `assets-gated` and
  `work-orders-gated` (two each) did not, and why `redirects_to` being the FIRST
  type on that surface made it worst: grep matches immediately with three lines
  still to come.
  Hard call recorded: the first fix captured `yq` into a variable and kept
  `printf ... | grep -q`. **That is not sufficient** -- the pipe is still there and
  `printf` can take EPIPE too, so it only narrows the window. The committed fix
  removes the pipe entirely with a bash `[[ ]]` test, which also lets the new lint
  stay strict (flag ANY `| grep -*q` under pipefail) rather than needing a carve-out
  whose safety has to be re-argued. The lint has an explicit opt-out token for a
  case that is genuinely fine, so the strictness is escapable on purpose.
  A gate that reddens at random is worse than no gate: it teaches people to re-run
  instead of read, and that is how a real failure gets waved through.
- **State after:** `bash -n` clean. The real smoke against production:
  **exit 0, 14 ok assertions, 0 FAIL** across all five surfaces. `npm test`
  **184 passed / 19 files** (was 178/18). The bash matcher was checked behaviourally
  in seven cases, including whole-line matching: `redirects_to` first of four, last,
  alone, absent, empty input, and the two substring traps `redirects` and
  `xredirects_to` both correctly NOT matched, so it is equivalent to `grep -qx`
  rather than `grep -q`.
  Mutation-checked: restoring the piped form makes the new lint report
  `verify/ci/quick_smoke.sh:85  if yq ... | grep -qx redirects_to`, and the file was
  restored byte-identical (`cmp`). The lint also carries a positive control, an
  accept case for the pipe-free form, and a case proving it ignores scripts that do
  not set pipefail (without pipefail the pipeline takes grep's status and the race is
  harmless).
  Swept the repo: this was the ONLY instance across `verify/`, `scripts/` and `ops/`.
- **Refs:** verify/ci/quick_smoke.sh, scripts/pipefail-shortcircuit.test.mjs,
  verify/smoke.yml (the dashboard-gated surface at line 39), PR #55 (where it was
  first seen), demo-axlepoint PR for this change
