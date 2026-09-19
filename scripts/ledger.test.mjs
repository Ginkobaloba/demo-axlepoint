// Tests for the ledger check's three states. Run: npm test
//
// The case that matters is zero entries: `check` used to print
// "0 entries, 0 problem(s)" and exit 0 when the directory was missing or
// empty, so a move, a rename or a wrong path left the check green while it
// inspected nothing.
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkEntry, listEntries, runCheck } from "./ledger.mjs";

const VALID = [
  "# 2026-09-19 16:13 CDT - a valid entry",
  "- **Who:** dev-44",
  "- **Change:** something concrete",
  "- **Why:** a reason",
  "- **State after:** what is true now",
  "- **Refs:** PR #1",
  "",
].join("\n");
const VALID_NAME = "2026-09-19-1613-a-valid-entry.md";

function tmp() {
  return mkdtempSync(join(tmpdir(), "ledger-test-"));
}

function capture(dir) {
  const out = [];
  const errs = [];
  const code = runCheck(dir, (m) => out.push(m), (m) => errs.push(m));
  return { code, out: out.join("\n"), errs: errs.join("\n") };
}

describe("ledger check", () => {
  it("check fails when docs/ledger is missing", () => {
    const r = capture(join(tmp(), "docs", "ledger"));
    expect(r.code).toBe(1);
    expect(r.errs).toMatch(/does not exist/);
    expect(r.out).not.toMatch(/0 entries, 0 problem/);
  });

  it("check fails when docs/ledger has zero entries", () => {
    const dir = join(tmp(), "ledger");
    mkdirSync(dir, { recursive: true });
    const r = capture(dir);
    expect(r.code).toBe(1);
    expect(r.errs).toMatch(/no entries found/);
  });

  it("README alone is still no entries", () => {
    const dir = join(tmp(), "ledger");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "# Ledger\n");
    expect(capture(dir).code).toBe(1);
  });

  it("check passes on a normal tree", () => {
    const dir = join(tmp(), "ledger");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, VALID_NAME), VALID);
    const r = capture(dir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1 entries, 0 problem/);
  });

  it("a malformed entry still fails", () => {
    const dir = join(tmp(), "ledger");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, VALID_NAME), VALID.replace("- **Why:** a reason\n", ""));
    const r = capture(dir);
    expect(r.code).toBe(1);
    expect(r.errs).toMatch(/missing "- \*\*Why:\*\*"/);
  });

  it("the real ledger of this repo is valid and not empty", () => {
    expect(listEntries().length).toBeGreaterThan(0);
    expect(runCheck(undefined, () => {}, () => {})).toBe(0);
  });

  it("checkEntry still catches name/heading mismatches and em dashes", () => {
    expect(checkEntry("2026-09-19-1613-x.md", VALID.replace("16:13", "17:13")).join()).toMatch(/does not match the file name/);
    expect(checkEntry(VALID_NAME, VALID.replace("a reason", "a — reason")).join()).toMatch(/em dash/);
    expect(checkEntry("nope.md", VALID).join()).toMatch(/name must be/);
  });
});