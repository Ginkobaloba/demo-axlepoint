#!/usr/bin/env node
// Duplicate decision-id guard for docs/demos/axlepoint/decisions.md.
//
// Two branches each adding "## D-019: ..." merge cleanly with NO conflict
// (they touch different lines, both appended near the end), and GitHub sees
// no reason to complain. That happened for real in demo-harborbistro on
// 2026-09-19 (two PRs both claimed D-019) and, independently, ALREADY
// HAPPENED HERE: this file's D-006 through D-010 were each claimed twice --
// a second wave of council items restarted numbering from D-006 instead of
// continuing after D-005. This script found that while being ported in and
// the collision was fixed in the same change (D-018) that added this file,
// by renumbering the second wave to D-013..D-017. Nothing else in this
// repo's CI would have caught either shape -- the ledger check validates
// docs/ledger/, not docs/demos/axlepoint/decisions.md, and there is no code
// path that reads a decision id and would fail on a collision.
//
// This script is the check: every `## D-<digits>` heading in
// docs/demos/axlepoint/decisions.md must have a unique id. Run:
//   node scripts/check-decisions.mjs [path-to-decisions.md]
//
// Ported from demo-harborbistro (origin/main b205dec), which keys
// docs/decisions.md at the repo root. This repo's decision log instead
// lives at docs/demos/axlepoint/decisions.md (docs/demos/<name>/... is the
// convention for this repo's per-demo docs), so DEFAULT_PATH below points
// there instead -- the only path-shaped difference from harbor's version.
//
// Second adaptation: this file has an established "addendum" convention
// harbor's doesn't -- a later update to an existing decision is logged as
// "## D-012 addendum (2026-09-19): ..." under the SAME id, on purpose,
// rather than minting a new id (see the two D-012 addenda below D-012
// itself). That is not a collision; it is the file's way of recording that
// a decision was revisited. HEADING_RE excludes exactly that pattern via a
// negative lookahead, so it still flags any other non-addendum reuse of an
// id (including a heading with no colon at all, like a malformed one) --
// the exemption is narrow, not "skip anything without a colon."
//
// Also run by npm test (see check-decisions.test.mjs), which covers the
// function in isolation. The CI step runs this file directly against the
// real docs/demos/axlepoint/decisions.md, because a check that only
// exercises a synthetic fixture is not proof the real file passes.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_PATH = join(ROOT, "docs", "demos", "axlepoint", "decisions.md");

// Matches "## D-<digits>" UNLESS immediately followed by whitespace then the
// word "addendum" (this repo's documented "revisit the same decision"
// convention, not a new claim on the id). The `\b` keeps normal headings
// like "## D-001: ..." matching exactly as before; the lookahead is the
// only thing narrower than a plain `\b`.
const HEADING_RE = /^## D-(\d+)\b(?!\s+addendum\b)/;

/**
 * Finds every counted `## D-<digits>` heading (see HEADING_RE) in `text`
 * and returns a Map from numeric id to every {raw, line} occurrence. Keyed
 * by the NUMERIC value, not the matched digit string: "D-019" and "D-19"
 * name the same decision with inconsistent padding, and that is exactly the
 * kind of collision this check exists to catch, not a reason to treat them
 * as two different ids. Shared by checkDecisions and runCheck's id count so
 * the two can never drift out of sync on what counts as a heading.
 */
function parseHeadingIds(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  /** @type {Map<number, {raw: string, line: number}[]>} */
  const seen = new Map();
  lines.forEach((line, i) => {
    const m = HEADING_RE.exec(line);
    if (!m) return;
    const id = Number(m[1]);
    const at = seen.get(id) ?? [];
    at.push({ raw: m[1], line: i + 1 });
    seen.set(id, at);
  });
  return seen;
}

/**
 * Returns problems: one entry per id that appears more than once (naming
 * every line it appears on), plus a single problem if zero ids were found
 * at all -- an empty or missing file must fail loudly, not report
 * "0 problems" while checking nothing.
 */
export function checkDecisions(text, label = "decisions.md") {
  const seen = parseHeadingIds(text);

  const problems = [];
  if (seen.size === 0) {
    problems.push(`${label}: no "## D-<n>" decision headings found; nothing was checked`);
    return problems;
  }
  for (const [id, occurrences] of seen) {
    if (occurrences.length > 1) {
      const spots = occurrences.map((o) => `D-${o.raw} on line ${o.line}`).join(", ");
      problems.push(`${label}: id ${id} appears ${occurrences.length} times (${spots})`);
    }
  }
  return problems;
}

export function runCheck(path = DEFAULT_PATH, log = console.log, err = console.error) {
  const label = relative(ROOT, path) || path;
  if (!existsSync(path)) {
    err(`decisions: ${label} does not exist; nothing was checked`);
    return 1;
  }
  const text = readFileSync(path, "utf8");
  const problems = checkDecisions(text, label);
  for (const p of problems) err(`decisions: ${p}`);
  const idCount = parseHeadingIds(text).size;
  log(`decisions: ${idCount} unique id(s), ${problems.length} problem(s).`);
  return problems.length ? 1 : 0;
}

function main([path]) {
  return runCheck(path ? join(process.cwd(), path) : DEFAULT_PATH);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
