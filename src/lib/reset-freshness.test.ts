import { describe, it, expect } from "vitest";
import {
  assessResetFreshness,
  exitCodeFor,
  describeVerdict,
  type ResetLogRow,
} from "@/lib/reset-freshness";

/**
 * The freshness verdict, tested without a database AND without a clock.
 *
 * These are the branches hardest to reach any other way: proving STALE against
 * a live database means waiting six hours or rewriting timestamps, and proving
 * NEVER_RAN means an empty log that a successful deploy immediately fills. A
 * check whose failure paths are untestable is a check nobody can trust when it
 * finally fires.
 *
 * NO CLOCK APPEARS HERE, and that is the point of the change these tests were
 * rewritten for. The verdict used to compare a database timestamp against
 * Node's `new Date()`, so a host clock running behind the database shrank the
 * age and a genuinely stale reset reported OK -- a retention gate failing OPEN
 * on clock skew. The age now arrives already computed by the database, so
 * there is no second clock to disagree with, and these tests pass an age
 * directly rather than staging two timestamps.
 */
const row = (o: Partial<ResetLogRow> = {}): ResetLogRow => ({
  ok: true,
  age_hours: 1,
  rows_restored: 100,
  error: null,
  ...o,
});

describe("reset freshness", () => {
  it("OK inside the window", () => {
    const v = assessResetFreshness(row(), 6);
    expect(v.kind).toBe("OK");
    expect(exitCodeFor(v)).toBe(0);
  });

  it("NEVER_RAN when the log is empty -- the deploy-mistake case", () => {
    const v = assessResetFreshness(undefined, 6);
    expect(v.kind).toBe("NEVER_RAN");
    expect(exitCodeFor(v)).toBe(1);
    expect(describeVerdict(v, "sample")).toMatch(/retention promise is NOT being kept/);
  });

  it("STALE once past the limit", () => {
    const v = assessResetFreshness(row({ age_hours: 6.5 }), 6);
    expect(v.kind).toBe("STALE");
    expect(exitCodeFor(v)).toBe(1);
  });

  it("is OK exactly at the limit, not stale", () => {
    // Off-by-one at the boundary would make the check flap every interval.
    expect(assessResetFreshness(row({ age_hours: 6 }), 6).kind).toBe("OK");
  });

  it("FAILED when the latest run failed, even though it is recent", () => {
    const v = assessResetFreshness(row({ ok: false, error: "boom", age_hours: 0.1 }), 6);
    expect(v.kind).toBe("FAILED");
    expect(exitCodeFor(v)).toBe(1);
  });

  it("reports FAILED rather than OK when a failure is the newest row", () => {
    // The query feeds only the LATEST row. This asserts the rule that makes
    // that correct: a fresh failure is not excused by an older success still
    // inside the window, which is how a broken reset goes unnoticed.
    const v = assessResetFreshness(row({ ok: false, error: "still broken", age_hours: 0.2 }), 6);
    expect(v.kind).toBe("FAILED");
  });

  it("a NEGATIVE age does not read as fresh", () => {
    // A negative age means finished_at is in the future relative to the
    // database's own now(). That should not be possible with one clock, so it
    // means something is wrong -- a restored backup, a manually inserted row,
    // or the very clock confusion this design removed. It must not be the
    // quietest possible OK.
    const v = assessResetFreshness(row({ age_hours: -3 }), 6);
    expect(v.kind).toBe("STALE");
    expect(exitCodeFor(v)).toBe(1);
  });

  it("every non-OK verdict exits non-zero", () => {
    for (const v of [
      assessResetFreshness(undefined, 6),
      assessResetFreshness(row({ age_hours: 99 }), 6),
      assessResetFreshness(row({ ok: false }), 6),
      assessResetFreshness(row({ age_hours: -1 }), 6),
    ]) {
      expect(exitCodeFor(v)).toBe(1);
    }
  });
});
