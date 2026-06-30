import { describe, expect, it } from "vitest";
import { isValidIsoDate, technicianLoad } from "./schedule-view";

describe("technicianLoad", () => {
  const entries = [
    { technician_name: "Marcus Webb", est_hours: 3, next_due: "2099-01-01" },
    { technician_name: "Marcus Webb", est_hours: 2, next_due: "2099-01-02" },
    { technician_name: "Elena Vasquez", est_hours: 8, next_due: "2099-01-03" },
    { technician_name: null, est_hours: 1, next_due: "2099-01-04" },
  ];

  it("sums hours and counts per technician", () => {
    const load = technicianLoad(entries);
    const marcus = load.find((l) => l.name === "Marcus Webb")!;
    expect(marcus.taskCount).toBe(2);
    expect(marcus.hours).toBe(5);
  });

  it("sorts by hours descending with Unassigned last", () => {
    const load = technicianLoad(entries);
    expect(load.map((l) => l.name)).toEqual([
      "Elena Vasquez", // 8h
      "Marcus Webb", // 5h
      "Unassigned", // always last
    ]);
  });

  it("returns an empty array for no entries", () => {
    expect(technicianLoad([])).toEqual([]);
  });
});

describe("isValidIsoDate", () => {
  it("accepts real dates", () => {
    expect(isValidIsoDate("2026-06-30")).toBe(true);
    expect(isValidIsoDate("2099-12-31")).toBe(true);
  });
  it("rejects malformed and impossible dates", () => {
    expect(isValidIsoDate("2026-6-1")).toBe(false); // not zero-padded
    expect(isValidIsoDate("2026-02-30")).toBe(false); // overflow
    expect(isValidIsoDate("2026-13-01")).toBe(false); // bad month
    expect(isValidIsoDate("not-a-date")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});
