import { describe, expect, it } from "vitest";
import { completionForStatus, parseWorkOrderPatch } from "./wo-actions";

describe("completionForStatus", () => {
  it("stamps completed_at when closing", () => {
    expect(completionForStatus("closed", 1000, null)).toBe(1000);
  });
  it("preserves an existing completed_at when re-closing", () => {
    expect(completionForStatus("closed", 2000, 1500)).toBe(1500);
  });
  it("clears completed_at when reopening to any active state", () => {
    expect(completionForStatus("open", 2000, 1500)).toBeNull();
    expect(completionForStatus("in_progress", 2000, 1500)).toBeNull();
    expect(completionForStatus("awaiting_parts", 2000, 1500)).toBeNull();
  });
});

describe("parseWorkOrderPatch", () => {
  it("parses assign with a tech id and with null", () => {
    expect(parseWorkOrderPatch({ action: "assign", assigned_to: "TCH-01" })).toEqual({
      ok: true,
      action: { kind: "assign", assigned_to: "TCH-01" },
    });
    expect(parseWorkOrderPatch({ action: "assign", assigned_to: null })).toEqual({
      ok: true,
      action: { kind: "assign", assigned_to: null },
    });
    expect(parseWorkOrderPatch({ action: "assign", assigned_to: "" })).toEqual({
      ok: true,
      action: { kind: "assign", assigned_to: null },
    });
  });

  it("accepts valid statuses and rejects unknown ones", () => {
    expect(parseWorkOrderPatch({ action: "status", status: "in_progress" })).toMatchObject({
      ok: true,
      action: { kind: "status", status: "in_progress" },
    });
    expect(parseWorkOrderPatch({ action: "status", status: "frobnicated" })).toMatchObject({
      ok: false,
    });
  });

  it("parses a due date from an ISO string and clears on empty", () => {
    const r = parseWorkOrderPatch({ action: "due", due_date: "2099-01-15" });
    expect(r.ok).toBe(true);
    if (r.ok && r.action.kind === "due") {
      expect(r.action.due_at).toBe(
        Math.floor(new Date("2099-01-15T12:00:00").getTime() / 1000),
      );
    }
    expect(parseWorkOrderPatch({ action: "due", due_date: "" })).toMatchObject({
      ok: true,
      action: { kind: "due", due_at: null },
    });
    expect(parseWorkOrderPatch({ action: "due", due_date: "not-a-date" })).toMatchObject({
      ok: false,
    });
  });

  it("validates add_part qty bounds", () => {
    expect(parseWorkOrderPatch({ action: "add_part", part_id: "PRT-0001", qty: 3 })).toMatchObject({
      ok: true,
      action: { kind: "add_part", part_id: "PRT-0001", qty: 3 },
    });
    expect(parseWorkOrderPatch({ action: "add_part", part_id: "PRT-0001", qty: 0 })).toMatchObject({
      ok: false,
    });
    expect(parseWorkOrderPatch({ action: "add_part", part_id: "" })).toMatchObject({
      ok: false,
    });
    // qty defaults to 1 when omitted
    expect(parseWorkOrderPatch({ action: "add_part", part_id: "PRT-0001" })).toMatchObject({
      ok: true,
      action: { kind: "add_part", qty: 1 },
    });
  });

  it("rejects unknown actions and non-object bodies", () => {
    expect(parseWorkOrderPatch({ action: "explode" }).ok).toBe(false);
    expect(parseWorkOrderPatch(null).ok).toBe(false);
    expect(parseWorkOrderPatch("nope").ok).toBe(false);
  });
});
