import { describe, it, expect } from "vitest";
import {
  assessResetFreshness,
  exitCodeFor,
  describeVerdict,
  type ResetLogRow,
} from "@/lib/reset-freshness";

/**
 * The freshness verdict, tested without a database.
 *
 * These are the branches that matter and the branches hardest to reach any
 * other way: proving STALE against a live database means waiting six hours or
 * rewriting timestamps, and proving NEVER_RAN means an empty log that a
 * successful deploy immediately fills. A check whose failure paths are
 * untestable is a check nobody can trust when it finally fires.
 */
const NOW = new Date("2026-09-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const row = (o: Partial<ResetLogRow> = {}): ResetLogRow => ({
  ok: true,
  finished_at: hoursAgo(1),
  rows_restored: 100,
  error: null,
  ...o,
});

describe("reset freshness", () => {
  it("OK inside the window", () => {
    const v = assessResetFreshness(row(), 6, NOW);
    expect(v.kind).toBe("OK");
    expect(exitCodeFor(v)).toBe(0);
  });

  it("NEVER_RAN when the log is empty -- the deploy-mistake case", () => {
    const v = assessResetFreshness(undefined, 6, NOW);
    expect(v.kind).toBe("NEVER_RAN");
    expect(exitCodeFor(v)).toBe(1);
    expect(describeVerdict(v, "sample")).toMatch(/retention promise is NOT being kept/);
  });

  it("STALE once past the limit", () => {
    const v = assessResetFreshness(row({ finished_at: hoursAgo(6.5) }), 6, NOW);
    expect(v.kind).toBe("STALE");
    expect(exitCodeFor(v)).toBe(1);
  });

  it("is OK exactly at the limit, not stale", () => {
    // Off-by-one at the boundary would make the check flap every interval.
    expect(assessResetFreshness(row({ finished_at: hoursAgo(6) }), 6, NOW).kind).toBe("OK");
  });

  it("FAILED when the latest run failed, even though it is recent", () => {
    const v = assessResetFreshness(
      row({ ok: false, error: "boom", finished_at: hoursAgo(0.1) }),
      6,
      NOW,
    );
    expect(v.kind).toBe("FAILED");
    expect(exitCodeFor(v)).toBe(1);
  });

  it("reports FAILED rather than OK when a failure follows a recent success", () => {
    // The query feeds only the LATEST row. This asserts the rule that makes
    // that correct: a fresh failure is not excused by an older success still
    // inside the window, which is how a broken reset goes unnoticed.
    const v = assessResetFreshness(
      row({ ok: false, error: "still broken", finished_at: hoursAgo(0.2) }),
      6,
      NOW,
    );
    expect(v.kind).toBe("FAILED");
  });

  it("every non-OK verdict exits non-zero", () => {
    for (const v of [
      assessResetFreshness(undefined, 6, NOW),
      assessResetFreshness(row({ finished_at: hoursAgo(99) }), 6, NOW),
      assessResetFreshness(row({ ok: false }), 6, NOW),
    ]) {
      expect(exitCodeFor(v)).toBe(1);
    }
  });
});
