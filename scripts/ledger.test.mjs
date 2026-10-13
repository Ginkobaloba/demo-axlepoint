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

import { checkEntry, FIELDS, listEntries, runCheck, scaffold } from "./ledger.mjs";

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

// The 2026-10-13 false pass (cloudflare-config PR #48): an untouched "new"
// scaffold has every label and no content, and "check" reported it as valid.
// A label with nothing after it is not a field. The scaffold test feeds the
// real scaffold output, not a hand-written copy, so it follows "new".
const BLANK_FIELD_NAME = "2026-09-19-1200-probe-entry.md";
const BLANK_FIELD_BASE = [
  "# 2026-09-19 12:00 CDT - probe entry",
  "- **Who:** test",
  "- **Change:** test",
  "- **Why:** test",
  "- **State after:** test",
  "- **Refs:** test",
  "",
].join("\n");

describe("blank required fields", () => {
  it("the blank scaffold from new fails, naming every empty field", () => {
    const { name, body } = scaffold("probe entry", new Date(2026, 9, 13, 11, 13));
    const problems = checkEntry(name, body);
    expect(problems).toHaveLength(FIELDS.length);
    for (const field of FIELDS) {
      expect(problems.some((p) => p.includes("**" + field + ":**") && p.endsWith("is empty"))).toBe(true);
    }
  });

  it("one blank field among filled ones fails", () => {
    const text = BLANK_FIELD_BASE.replace("- **Refs:** test", "- **Refs:**   ");
    expect(checkEntry(BLANK_FIELD_NAME, text)).toEqual([BLANK_FIELD_NAME + ': "- **Refs:**" is empty']);
  });

  it("a field whose content starts on an indented continuation line passes", () => {
    const text = BLANK_FIELD_BASE.replace("- **Change:** test", "- **Change:**\n  1. first item\n  2. second item");
    expect(checkEntry(BLANK_FIELD_NAME, text)).toEqual([]);
  });

  it("a blank field followed directly by the next field is not rescued by it", () => {
    const text = BLANK_FIELD_BASE.replace("- **Who:** test", "- **Who:**");
    expect(checkEntry(BLANK_FIELD_NAME, text)).toEqual([BLANK_FIELD_NAME + ': "- **Who:**" is empty']);
  });
});
