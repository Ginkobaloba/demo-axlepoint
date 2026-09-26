import { describe, expect, it } from "vitest";
import { detailTitle } from "./detail-title";

describe("detailTitle", () => {
  it.each([
    ["Asset", "AST-0023", "Asset AST-0023"],
    ["Work order", "WO-1001", "Work order WO-1001"],
    ["Part", "PRT-0080", "Part PRT-0080"],
    ["Purchase order", "PO-1013", "Purchase order PO-1013"],
  ])("names a %s by its id", (kind, id, expected) => {
    expect(detailTitle(kind, id)).toBe(expected);
  });

  it("gives each record kind a DISTINCT title, which is the whole point", () => {
    const titles = [
      detailTitle("Asset", "AST-0001"),
      detailTitle("Work order", "WO-1001"),
      detailTitle("Part", "PRT-0001"),
      detailTitle("Purchase order", "PO-1001"),
    ];
    expect(new Set(titles).size).toBe(titles.length);
  });

  it.each([
    ["a path segment", "../../etc/passwd"],
    ["markup", "<script>alert(1)</script>"],
    ["an empty id", ""],
    ["a bare word", "nonexistent"],
    ["an over-long number", "AST-123456789"],
  ])("falls back to the plain kind for %s", (_name, id) => {
    expect(detailTitle("Asset", id)).toBe("Asset");
  });
});
