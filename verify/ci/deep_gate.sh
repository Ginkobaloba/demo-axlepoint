#!/usr/bin/env bash
# Deep-verify gate for tier-3 PRs.
#
# Layers 5 and 6 (real-Chrome headed run and adversarial generation) cannot run
# in CI -- they need a Windows desktop with the computer-use MCP. So this gate
# does not fake a deep run. It requires committed evidence that a deep run
# passed FOR THIS PR, ON THIS CODE:
#
#   1. a report under verify/reports/ whose file name names this PR
#      (DEEP_VERIFY_<date>_pr<N>-<slug>.md; pr3 never matches pr30),
#   2. that report has a line "Overall: PASS" (and no "Overall: FAIL"),
#   3. that report has a line "Tested-SHA: <full 40-hex sha>" naming the
#      commit the run tested,
#   4. that commit is the PR head or an ancestor of it, and every change from
#      it to the PR head is under verify/reports/ (so code changed after the
#      run invalidates the report).
#
# A PASS report from another PR, or from older code on this PR, does not count.
#
# Usage: deep_gate.sh <pr-number> <pr-head-sha>
# Needs full history (actions/checkout with fetch-depth: 0).
set -uo pipefail

fail() { echo "Deep-verify gate NOT satisfied: $*"; exit 1; }

pr="${1:-}"
head="${2:-}"
[[ "$pr" =~ ^[0-9]+$ ]] || fail "usage: deep_gate.sh <pr-number> <pr-head-sha> (got pr='$pr')"
[[ "$head" =~ ^[0-9a-f]{7,40}$ ]] || fail "usage: deep_gate.sh <pr-number> <pr-head-sha> (got head='$head')"
git cat-file -e "${head}^{commit}" 2>/dev/null || fail "PR head $head is not in this checkout (fetch-depth: 0?)"

# Reports are read from the PR head's tree, not the working tree.
mapfile -t reports < <(git ls-tree --name-only "$head" verify/reports/ \
  | grep -E "(^|/)[^/]*(^|[^A-Za-z0-9])[pP][rR]${pr}([^0-9][^/]*)?\.md$")
if [ ${#reports[@]} -eq 0 ]; then
  echo "Tier-3 PR #$pr: no deep-verify report for this PR under verify/reports/."
  echo "Run /verify deep locally, then commit verify/reports/DEEP_VERIFY_<date>_pr${pr}-<slug>.md"
  echo "with the lines 'Overall: PASS' and 'Tested-SHA: <full 40-hex sha of the code you tested>'."
  fail "missing report for pr${pr}"
fi

for r in "${reports[@]}"; do
  echo "Checking $r"
  body="$(git show "$head:$r")"
  if grep -qiE '^[[:space:]]*(\*\*)?overall:?(\*\*)?:?[[:space:]]*(\*\*)?fail' <<<"$body"; then
    echo "  report says Overall: FAIL"; continue
  fi
  if ! grep -qiE '^[[:space:]]*(\*\*)?overall:?(\*\*)?:?[[:space:]]*(\*\*)?pass' <<<"$body"; then
    echo "  no 'Overall: PASS' line"; continue
  fi
  verified="$(grep -oiE '^[[:space:]]*(\*\*)?tested-sha:?(\*\*)?:?[[:space:]]*`?[0-9a-f]{40}' <<<"$body" \
    | head -n1 | grep -oiE '[0-9a-f]{40}$' | tr 'A-F' 'a-f')"
  if [ -z "$verified" ]; then
    echo "  no 'Tested-SHA: <full 40-hex sha>' line"; continue
  fi
  if ! git cat-file -e "${verified}^{commit}" 2>/dev/null; then
    echo "  Tested-SHA $verified is not a commit in this repo"; continue
  fi
  if ! git merge-base --is-ancestor "$verified" "$head"; then
    echo "  Tested-SHA $verified is not the PR head or an ancestor of it"; continue
  fi
  outside="$(git diff --name-only "$verified" "$head" -- . ':(exclude)verify/reports/')"
  if [ -n "$outside" ]; then
    echo "  files changed after the verified commit (the report no longer covers them):"
    sed 's/^/    /' <<<"$outside"
    continue
  fi
  echo "Deep-verify report $r shows PASS for pr${pr} at $verified, and nothing but reports changed since. Gate satisfied."
  exit 0
done

fail "no report for pr${pr} passes all checks"
