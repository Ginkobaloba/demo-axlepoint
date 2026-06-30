import { describe, expect, it } from "vitest";
import {
  canTransition,
  nextStatuses,
  parsePoStatusPatch,
  recommendedReorderQty,
} from "./po-actions";

describe("canTransition / nextStatuses", () => {
  it("allows the forward PO lifecycle", () => {
    expect(canTransition("draft", "ordered")).toBe(true);
    expect(canTransition("ordered", "received")).toBe(true);
    expect(canTransition("draft", "cancelled")).toBe(true);
    expect(canTransition("ordered", "cancelled")).toBe(true);
  });
  it("forbids skipping and reversing", () => {
    expect(canTransition("draft", "received")).toBe(false);
    expect(canTransition("received", "ordered")).toBe(false);
    expect(canTransition("cancelled", "draft")).toBe(false);
  });
  it("treats received and cancelled as terminal", () => {
    expect(nextStatuses("received")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
    expect(nextStatuses("draft")).toEqual(["ordered", "cancelled"]);
  });
});

describe("recommendedReorderQty", () => {
  it("brings stock up to twice the reorder point", () => {
    expect(recommendedReorderQty({ qty_on_hand: 1, reorder_point: 5 })).toBe(9); // 10 - 1
    expect(recommendedReorderQty({ qty_on_hand: 0, reorder_point: 4 })).toBe(8);
  });
  it("never proposes less than 1", () => {
    expect(recommendedReorderQty({ qty_on_hand: 50, reorder_point: 5 })).toBe(1);
  });
});

describe("parsePoStatusPatch", () => {
  it("accepts a legal transition", () => {
    expect(parsePoStatusPatch({ status: "ordered" }, "draft")).toEqual({
      ok: true,
      status: "ordered",
    });
  });
  it("rejects an illegal transition", () => {
    expect(parsePoStatusPatch({ status: "received" }, "draft").ok).toBe(false);
  });
  it("rejects an unknown status and a no-op", () => {
    expect(parsePoStatusPatch({ status: "frob" }, "draft").ok).toBe(false);
    expect(parsePoStatusPatch({ status: "draft" }, "draft").ok).toBe(false);
  });
  it("rejects a non-object body", () => {
    expect(parsePoStatusPatch(null, "draft").ok).toBe(false);
  });
});
