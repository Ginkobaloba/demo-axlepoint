import { describe, expect, it } from "vitest";
import { compareValues, nextSort, sortRows } from "./table-sort";

describe("nextSort", () => {
  it("sorts a new column ascending", () => {
    expect(nextSort({ key: "a", dir: "desc" }, "b")).toEqual({
      key: "b",
      dir: "asc",
    });
  });
  it("flips direction on the active column", () => {
    expect(nextSort({ key: "a", dir: "asc" }, "a")).toEqual({
      key: "a",
      dir: "desc",
    });
    expect(nextSort({ key: "a", dir: "desc" }, "a")).toEqual({
      key: "a",
      dir: "asc",
    });
  });
});

describe("compareValues", () => {
  it("compares numbers numerically", () => {
    expect(compareValues(2, 10, "asc")).toBeLessThan(0);
    expect(compareValues(2, 10, "desc")).toBeGreaterThan(0);
  });
  it("compares strings case-insensitively and numeric-aware", () => {
    expect(compareValues("apple", "Banana", "asc")).toBeLessThan(0);
    expect(compareValues("WO-9", "WO-100", "asc")).toBeLessThan(0); // numeric
  });
  it("always sorts nulls and empty strings last regardless of direction", () => {
    expect(compareValues(null, 5, "asc")).toBeGreaterThan(0);
    expect(compareValues(null, 5, "desc")).toBeGreaterThan(0);
    expect(compareValues(5, null, "asc")).toBeLessThan(0);
    expect(compareValues(5, null, "desc")).toBeLessThan(0);
    expect(compareValues("", "x", "desc")).toBeGreaterThan(0);
  });
});

describe("sortRows", () => {
  const rows = [
    { id: "c", n: 3, due: 100 },
    { id: "a", n: 1, due: null as number | null },
    { id: "b", n: 2, due: 50 },
  ];

  it("sorts by a string accessor ascending and descending", () => {
    expect(sortRows(rows, (r) => r.id, "asc").map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortRows(rows, (r) => r.id, "desc").map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("keeps nulls last even when sorting descending", () => {
    expect(sortRows(rows, (r) => r.due, "desc").map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("is stable for equal keys", () => {
    const dup = [
      { id: "x", n: 1 },
      { id: "y", n: 1 },
      { id: "z", n: 1 },
    ];
    expect(sortRows(dup, (r) => r.n, "asc").map((r) => r.id)).toEqual([
      "x",
      "y",
      "z",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    sortRows(input, (r) => r.n, "desc");
    expect(input.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
