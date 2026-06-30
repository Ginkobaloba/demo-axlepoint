import { describe, expect, it } from "vitest";
import { MIN_TITLE_LEN, screenWorkOrderTitle } from "./work-order-validation";

describe("screenWorkOrderTitle", () => {
  it("accepts a real maintenance description", () => {
    expect(screenWorkOrderTitle("Replace oil filter on Engine 12").ok).toBe(
      true,
    );
    expect(
      screenWorkOrderTitle("Inspect bearings - Generator 05 (AST-0065)").ok,
    ).toBe(true);
  });

  it("does not reject legit titles that merely start with test/sample", () => {
    // These are real industrial work and must pass (review nit).
    for (const ok of [
      "Test bench calibration on rig 4",
      "Sample collection port reseal",
      "Sample line pressure check",
      "Testing rig vibration survey",
    ]) {
      expect(screenWorkOrderTitle(ok).ok).toBe(true);
    }
  });

  it("rejects the known junk fixtures that leaked into the live demo", () => {
    for (const junk of [
      "Test",
      "test",
      "JSON API test order",
      "Test audit work order",
      "  test order  ",
    ]) {
      expect(screenWorkOrderTitle(junk).ok).toBe(false);
    }
  });

  it("rejects placeholder words", () => {
    for (const junk of ["foo", "asdf", "TODO", "placeholder", "dummy data"]) {
      expect(screenWorkOrderTitle(junk).ok).toBe(false);
    }
  });

  it(`rejects titles shorter than ${MIN_TITLE_LEN} characters`, () => {
    expect(screenWorkOrderTitle("abc").ok).toBe(false);
    expect(screenWorkOrderTitle("     ").ok).toBe(false);
  });

  it("returns a human-readable reason on rejection", () => {
    const short = screenWorkOrderTitle("ab");
    expect(short.ok).toBe(false);
    expect(short.reason).toMatch(/at least/i);
    const junk = screenWorkOrderTitle("test order");
    expect(junk.reason).toMatch(/test fixture/i);
  });
});
