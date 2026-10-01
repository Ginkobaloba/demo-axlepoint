// No shell script under pipefail may pipe a producer into `grep -q`. Run: npm test
//
// THE BUG THIS CAME FROM. verify/ci/quick_smoke.sh sets `set -uo pipefail` and had:
//
//   if yq -r "...assertions[].type" "$SMOKE" | grep -qx redirects_to; then ...
//
// `grep -q` exits on the FIRST match, so yq gets EPIPE while still writing the
// remaining lines and exits non-zero. pipefail then makes the whole pipeline
// fail, the `if` takes the else branch, and a surface that DOES declare
// redirects_to is reported as "undeclared redirect".
//
// It is a RACE -- whether the producer flushed and exited before grep matched --
// so it reddens a gate at random and looks like a problem with the thing being
// tested. On 2026-10-01 the same commit failed and then passed on a re-run, and
// the first guess was the live site. Reproduced deterministically with a producer
// that sleeps between writes:
//
//   producer() { echo redirects_to; sleep 0.3; echo http_status; }
//   producer | grep -qx redirects_to   # -> non-zero under pipefail
//
// The window is the number of unread lines, which is why the surface with four
// assertions flaked while its two-assertion neighbours did not.
//
// A gate that reddens at random is worse than no gate: it teaches people to
// re-run instead of read, and that is how a real failure gets waved through.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every .sh under the given roots, recursively. */
function shellScripts(dirs) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".sh")) out.push(full);
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out;
}

const SETS_PIPEFAIL = /^\s*set\s+-[a-zA-Z]*o\s+pipefail|^\s*set\s+-o\s+pipefail/m;
// A pipe into grep with -q anywhere in its flag cluster (-q, -qx, -sq, ...).
const PIPE_INTO_GREP_Q = /\|\s*grep\s+-[a-zA-Z]*q/;
const OPT_OUT = "pipefail-shortcircuit-ok";

/** Offending lines in one script, or [] when it is clean or sets no pipefail. */
export function offendingLines(source) {
  if (!SETS_PIPEFAIL.test(source)) return [];
  const out = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (line.trimStart().startsWith("#")) return;
    if (line.includes(OPT_OUT)) return;
    if (PIPE_INTO_GREP_Q.test(line)) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

describe("the check detects the pattern", () => {
  // Positive control. Without this, a clean repo and a broken matcher look the same.
  const BAD = ['#!/usr/bin/env bash', 'set -uo pipefail', 'if yq -r ".x[]" f | grep -qx wanted; then :; fi'].join("\n");
  // The fix is pure bash with no pipe at all. Capturing into a variable and then
  // piping to `grep -q` would still have a pipe, and printf can take EPIPE too,
  // so that only narrows the window. This rule is strict on purpose.
  const FIXED = [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    'v="$(yq -r \'.x[]\' f)"',
    "if [[ $'\\n'\"$v\"$'\\n' == *$'\\n'wanted$'\\n'* ]]; then :; fi",
  ].join("\n");
  const NO_PIPEFAIL = ['#!/usr/bin/env bash', 'if yq -r ".x[]" f | grep -qx wanted; then :; fi'].join("\n");

  it("flags a producer piped into grep -q under pipefail", () => {
    const hits = offendingLines(BAD);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("grep -qx");
  });

  it("accepts the pipe-free bash form", () => {
    expect(offendingLines(FIXED)).toHaveLength(0);
  });

  it("ignores a script that does not set pipefail", () => {
    // Without pipefail the pipeline takes grep's status, so the race is harmless.
    expect(offendingLines(NO_PIPEFAIL)).toHaveLength(0);
  });

  it("ignores comments and honours an explicit opt-out", () => {
    expect(offendingLines(`set -o pipefail\n# a | grep -q b\n`)).toHaveLength(0);
    expect(
      offendingLines(`set -o pipefail\nfoo | grep -q bar # ${OPT_OUT}: producer is tiny\n`),
    ).toHaveLength(0);
  });
});

describe("this repo's shell scripts", () => {
  const scripts = shellScripts(["verify", "scripts", "ops"]);

  it("finds shell scripts to check, so a path change cannot empty this", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it("none pipes a producer into grep -q under pipefail", () => {
    const offenders = scripts.flatMap((file) =>
      offendingLines(readFileSync(file, "utf8")).map(
        (hit) => `${relative(root, file)}:${hit.line}  ${hit.text}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
