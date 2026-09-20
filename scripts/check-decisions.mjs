#!/usr/bin/env node
// Duplicate decision-id guard for a repo's decisions log.
//
// Two branches each adding "## D-019: ..." to a decisions log merge
// cleanly with NO conflict (they touch different lines, both appended
// near the end), and GitHub sees no reason to complain. That happened for
// real in demo-harborbistro on 2026-09-19: two PRs both claimed D-019.
// Nothing else in CI reads a decision id and would fail on a collision --
// this is the only thing that catches it.
//
// This script is the check: every `## D-<digits>` heading in the given
// decisions log must have a unique id. Run:
//   node scripts/check-decisions.mjs <path-to-decisions.md>
//
// The path is required and repo-specific: each repo keeps its decisions
// log at its own location and passes that path from its own call sites
// (the CI step that runs this file). There is deliberately no built-in
// default path -- a default is exactly the kind of repo-specific state
// this shared script must not carry, and a missing, wrong, or omitted
// path must fail loudly rather than silently check nothing.
//
// Also run by npm test (see check-decisions.test.mjs), which covers the
// function in isolation. The CI step runs this file directly against the
// real decisions log, because a check that only exercises a synthetic
// fixture is not proof the real file passes.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Matches "## D-<digits>" UNLESS immediately followed by whitespace then
// the word "addendum" -- some repos record a later revisit of an existing
// decision as "## D-012 addendum (...): ..." under the SAME id on purpose,
// rather than minting a new id. That is not a collision. The `\b` keeps
// normal headings like "## D-001: ..." matching exactly as before; the
// lookahead is the only thing narrower than a plain `\b`, so it still
// flags any other non-addendum reuse of an id (including a heading with
// no colon at all).
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

export function runCheck(path, log = console.log, err = console.error) {
  if (!path) {
    err("decisions: no path given; usage: node scripts/check-decisions.mjs <path-to-decisions.md>");
    return 1;
  }
  const resolved = resolve(process.cwd(), path);
  const label = relative(ROOT, resolved) || resolved;
  if (!existsSync(resolved)) {
    err(`decisions: ${label} does not exist; nothing was checked`);
    return 1;
  }
  const text = readFileSync(resolved, "utf8");
  const problems = checkDecisions(text, label);
  for (const p of problems) err(`decisions: ${p}`);
  const idCount = parseHeadingIds(text).size;
  log(`decisions: ${idCount} unique id(s), ${problems.length} problem(s).`);
  return problems.length ? 1 : 0;
}

function main([path]) {
  return runCheck(path);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
