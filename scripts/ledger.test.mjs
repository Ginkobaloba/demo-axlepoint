import { describe, expect, it } from "vitest";
import { checkAll, checkEntry, scaffold, slugify } from "./ledger.mjs";

const GOOD_NAME = "2026-09-19-0340-ledger-one-file-per-entry.md";
const good = (heading = "# 2026-09-19 03:40 CDT - Ledger: one file per entry") =>
  [heading, "- **Who:** a", "- **Change:** b", "- **Why:** c", "- **State after:** d", "- **Refs:** e", ""].join("\n");

describe("checkEntry", () => {
  it("accepts a well-formed entry", () => {
    expect(checkEntry(GOOD_NAME, good())).toEqual([]);
  });

  it("accepts CRLF line endings (Windows checkouts)", () => {
    expect(checkEntry(GOOD_NAME, good().replace(/\n/g, "\r\n"))).toEqual([]);
  });

  it("rejects a bad file name", () => {
    expect(checkEntry("2026-09-19-ledger.md", good())[0]).toMatch(/name must be/);
    expect(checkEntry("2026-09-19-0340-Ledger_Entry.md", good())[0]).toMatch(/name must be/);
  });

  it("rejects a heading whose date or time differs from the file name", () => {
    expect(checkEntry(GOOD_NAME, good("# 2026-09-19 03:41 CDT - x")).join()).toMatch(/does not match/);
    expect(checkEntry(GOOD_NAME, good("# 2026-09-18 03:40 CDT - x")).join()).toMatch(/does not match/);
  });

  it("rejects a malformed heading", () => {
    expect(checkEntry(GOOD_NAME, good("## 2026-09-19 03:40 CDT - x")).join()).toMatch(/first line/);
  });

  it("requires every field", () => {
    const missing = good().replace("- **Why:** c\n", "");
    expect(checkEntry(GOOD_NAME, missing)).toEqual([`${GOOD_NAME}: missing "- **Why:**"`]);
  });

  it("rejects em dashes", () => {
    expect(checkEntry(GOOD_NAME, good() + `a ${String.fromCharCode(0x2014)} b\n`).join()).toMatch(/em dash/);
  });
});

describe("slugify and scaffold", () => {
  it("makes a lowercase kebab slug", () => {
    expect(slugify("C10b: /lab/draughts page, pinned!")).toBe("c10b-lab-draughts-page-pinned");
    expect(() => slugify("!!!")).toThrow();
  });

  it("scaffolds an entry that passes the check once filled in", () => {
    const when = new Date(2026, 8, 19, 3, 40);
    const { name, body } = scaffold("Ledger: one file per entry", when);
    expect(name).toBe(GOOD_NAME);
    const filled = body.replace(/:\*\* $/gm, ":** filled");
    expect(checkEntry(name, filled)).toEqual([]);
  });
});

describe("docs/ledger", () => {
  it("every committed entry is well formed", () => {
    expect(checkAll()).toEqual([]);
  });
});
