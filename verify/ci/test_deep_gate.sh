#!/usr/bin/env bash
# Offline tests for verify/ci/deep_gate.sh. Each case builds a throwaway git
# repo and checks that the gate passes or fails as expected. No network.
# Run: bash verify/ci/test_deep_gate.sh   (exits non-zero on any failure)
set -uo pipefail

gate="$(cd "$(dirname "$0")" && pwd)/deep_gate.sh"
failures=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

new_repo() {
  local d="$tmp/$1"
  mkdir -p "$d/verify/reports" && cd "$d" || exit 1
  git init -q
  git config user.email t@example.invalid
  git config user.name test
  git config commit.gpgsign false
  git config core.autocrlf false
  echo app > app.txt
  touch verify/reports/.gitkeep
  git add -A && git commit -qm base
}

commit_all() { git add -A && git commit -qm "$1"; }

# report <file> <overall> <sha or ''>
report() {
  {
    echo "# Deep Verify"
    echo
    echo "Overall: $2"
    [ -n "$3" ] && echo "Tested-SHA: $3"
    echo
    echo "body"
  } > "verify/reports/$1"
}

expect() { # expect <pass|fail> <label> <pr>
  local want="$1" label="$2" pr="$3" out rc
  out="$(bash "$gate" "$pr" "$(git rev-parse HEAD)" 2>&1)"; rc=$?
  if { [ "$want" = pass ] && [ $rc -eq 0 ]; } || { [ "$want" = fail ] && [ $rc -ne 0 ]; }; then
    echo "PASS  $label"
  else
    echo "FAIL  $label (wanted $want, exit $rc)"; sed 's/^/      /' <<<"$out"; failures=$((failures + 1))
  fi
}

# 1. No report at all.
new_repo c1; expect fail "no report" 30

# 2. The skeleton-key bug: a PASS report for ANOTHER PR must not count.
new_repo c2; tested=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-18_pr27-old.md PASS "$tested"; commit_all r
expect fail "PASS report for pr27 does not satisfy pr30" 30

# 3. pr3 must not match a pr30 report, and pr30 must not match pr3.
new_repo c3; tested=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-19_pr30-x.md PASS "$tested"; commit_all r
expect fail "pr30 report does not satisfy pr3" 3
new_repo c3b; tested=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-19_pr3-x.md PASS "$tested"; commit_all r
expect fail "pr3 report does not satisfy pr30" 30

# 4. The happy path: report committed as a child of the tested commit.
new_repo c4; tested=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-19_pr30-x.md PASS "$tested"; commit_all r
expect pass "PASS for pr30, Tested-SHA = parent, only the report changed" 30

# 5. Tested-SHA equal to HEAD (report already in the tested tree).
new_repo c5; report DEEP_VERIFY_2026-09-19_pr30-x.md PASS ""; commit_all r
sha=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-19_pr30-x.md PASS "$sha"; commit_all r2
expect pass "Tested-SHA is an ancestor with only report edits after it" 30

# 6. Code changed after the run: the report no longer covers the head.
new_repo c6; tested=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-19_pr30-x.md PASS "$tested"; commit_all r
echo changed > app.txt; commit_all code
expect fail "code changed after Tested-SHA" 30

# 7. Verdict FAIL, or no verdict.
new_repo c7; tested=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-19_pr30-x.md FAIL "$tested"; commit_all r
expect fail "Overall: FAIL" 30
new_repo c7b; tested=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-19_pr30-x.md "PENDING" "$tested"; commit_all r
expect fail "no PASS verdict" 30

# 7c. A PASS quoted below a non-PASS verdict must not count (seen on lumen #35,
#     where a FAIL-bound report quoted the marker inside a warning).
new_repo c7c; tested=$(git rev-parse HEAD)
printf '# Deep Verify\n\nOverall: PENDING\nTested-SHA: %s\n\nWarning: the old gate matched "\nOverall: PASS" anywhere.\n' "$tested" > verify/reports/DEEP_VERIFY_2026-09-19_pr30-x.md
commit_all r
expect fail "PASS quoted below the real verdict does not count" 30
new_repo c7d; tested=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-19_pr30-x.md "PASSED-ISH" "$tested"; commit_all r
expect fail "verdict must be exactly PASS, not a longer word" 30
# 7e. Whole-token only: qualified or decorated PASS verdicts do not count.
n=0
for v in "PASS-ISH" "PASS_WITH_ISSUES" "PASS (partial)" "PASS." "PASS with warnings"; do
  n=$((n + 1)); new_repo "c7e$n"; tested=$(git rev-parse HEAD)
  report DEEP_VERIFY_2026-09-19_pr30-x.md "$v" "$tested"; commit_all r
  expect fail "verdict '$v' is not a bare PASS" 30
done
# 7f. Bold on the value, and trailing spaces, still count.
new_repo c7f; tested=$(git rev-parse HEAD)
printf '# Deep Verify\n\nOverall: **PASS**  \nTested-SHA: %s\n' "$tested" > verify/reports/DEEP_VERIFY_2026-09-19_pr30-x.md
commit_all r
expect pass "Overall: **PASS** with trailing spaces" 30

# 8. Missing or short Tested-SHA.
new_repo c8; report DEEP_VERIFY_2026-09-19_pr30-x.md PASS ""; commit_all r
expect fail "missing Tested-SHA" 30
new_repo c8b; tested=$(git rev-parse --short HEAD)
report DEEP_VERIFY_2026-09-19_pr30-x.md PASS "$tested"; commit_all r
expect fail "short Tested-SHA (40 hex required)" 30

# 9. Tested-SHA that is not an ancestor (a side branch).
new_repo c9; git checkout -qb side; echo side > side.txt; commit_all side
side=$(git rev-parse HEAD); git checkout -q -
report DEEP_VERIFY_2026-09-19_pr30-x.md PASS "$side"; commit_all r
expect fail "Tested-SHA not an ancestor of the head" 30

# 10. Tested-SHA that is not a commit at all.
new_repo c10; report DEEP_VERIFY_2026-09-19_pr30-x.md PASS "$(printf 'a%.0s' {1..40})"; commit_all r
expect fail "Tested-SHA not in the repo" 30

# 11. Markdown bold forms, as reports actually write them.
new_repo c11; tested=$(git rev-parse HEAD)
printf '# Deep Verify\n\n**Overall:** PASS\n\n**Tested-SHA:** `%s`\n' "$tested" > verify/reports/DEEP_VERIFY_2026-09-19_pr30-x.md
commit_all r
expect pass "bold Overall and backticked Tested-SHA" 30

# 12. The report is read from the head tree: an uncommitted report does not count.
new_repo c12; tested=$(git rev-parse HEAD)
report DEEP_VERIFY_2026-09-19_pr30-x.md PASS "$tested"
expect fail "uncommitted report is ignored" 30

# 13. Bad arguments.
new_repo c13; out="$(bash "$gate" "" "" 2>&1)"; rc=$?
if [ $rc -ne 0 ]; then echo "PASS  missing arguments rejected"; else echo "FAIL  missing arguments accepted"; failures=$((failures + 1)); fi

if [ $failures -gt 0 ]; then echo "$failures failure(s)"; exit 1; fi
echo "All deep_gate tests passed"
