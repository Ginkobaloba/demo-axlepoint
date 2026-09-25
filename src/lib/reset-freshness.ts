/**
 * Decide whether the demo reset has run recently enough.
 *
 * PURE ON PURPOSE. The verdict is a function of one log row, a limit and the
 * current time, so every branch can be tested with no database, no clock and
 * no scheduler -- which is the only way to prove the STALE and NEVER_RAN
 * branches at all. Reproducing them against a live database would mean either
 * waiting six hours or mutating timestamps, and a check whose failure paths
 * are untestable is a check nobody can trust.
 *
 * THREE FAILURES, NOT ONE. A single "is it fresh?" boolean collapses three
 * situations that need different responses:
 *   NEVER_RAN  the schedule was never wired up -- a deploy mistake, and the
 *              one a deploy must refuse to proceed past
 *   FAILED     the schedule works, the reset is broken
 *   STALE      the schedule stopped, or is running too slowly
 */

export interface ResetLogRow {
  ok: boolean;
  /**
   * Age computed BY THE DATABASE, in hours -- not a timestamp.
   *
   * ONE CLOCK, DELIBERATELY. This used to be `finished_at: Date` compared
   * against Node's `new Date()`, which subtracted a HOST timestamp from a
   * DATABASE one. Over a six-hour window milliseconds are irrelevant, but the
   * failure is NOT symmetric: a host clock running BEHIND the database shrinks
   * the age, so a genuinely stale reset reports OK. A retention gate that
   * fails OPEN on clock skew is worse than no gate, because it is believed.
   *
   * Found by the Orchestrator from Treadle's one-in-eight flake, which was the
   * same shape: a host-clock write compared against the database's now(), with
   * the container running 47-95ms ahead. Against Neon the skew is larger, and
   * a laptop that has slept is larger still.
   */
  age_hours: number;
  rows_restored: number;
  error: string | null;
}

export type ResetVerdict =
  | { kind: "OK"; ageHours: number; rowsRestored: number }
  | { kind: "NEVER_RAN" }
  | { kind: "FAILED"; ageHours: number; error: string | null }
  | { kind: "STALE"; ageHours: number; limitHours: number };

export function assessResetFreshness(
  latest: ResetLogRow | undefined,
  limitHours: number,
): ResetVerdict {
  if (!latest) return { kind: "NEVER_RAN" };

  // No clock here at all. The age arrived already computed by the database.
  const ageHours = latest.age_hours;

  // A failed latest run is reported as FAILED even when an older success is
  // still inside the window. The window is not the point: something is broken
  // now, and reporting OK because of a stale success is how a broken reset
  // goes unnoticed until the window closes.
  if (!latest.ok) return { kind: "FAILED", ageHours, error: latest.error };

  // A NEGATIVE age means finished_at is in the future relative to the
  // database's own now(). With a single clock that cannot legitimately happen,
  // so it signals something wrong: a restored backup, a hand-inserted row, or
  // exactly the clock confusion this design removed. Left unhandled it is the
  // QUIETEST POSSIBLE PASS -- any negative number is comfortably under the
  // limit, so the gate would report OK forever. Fail closed.
  if (ageHours < 0 || ageHours > limitHours) {
    return { kind: "STALE", ageHours, limitHours };
  }

  return { kind: "OK", ageHours, rowsRestored: latest.rows_restored };
}

/** Exit code for a verdict: 0 only for OK. */
export function exitCodeFor(v: ResetVerdict): number {
  return v.kind === "OK" ? 0 : 1;
}

export function describeVerdict(v: ResetVerdict, tenantId: string): string {
  switch (v.kind) {
    case "OK":
      return `ok: last reset ${v.ageHours.toFixed(1)}h ago, restored ${v.rowsRestored} rows`;
    case "NEVER_RAN":
      return (
        `NEVER RAN: ops.reset_log holds no entry for tenant "${tenantId}".\n` +
        "  D-012's retention promise is NOT being kept. The reset schedule\n" +
        "  (ops/reset-sidecar) has not been wired up for this deployment."
      );
    case "FAILED":
      return (
        `LAST RUN FAILED ${v.ageHours.toFixed(1)}h ago: ${v.error ?? "(no message)"}\n` +
        "  The schedule is running; the reset itself is broken."
      );
    case "STALE":
      return (
        `STALE: the last successful reset was ${v.ageHours.toFixed(1)}h ago, ` +
        `limit is ${v.limitHours}h.\n` +
        "  The schedule has stopped or is running too slowly. Visitor data is\n" +
        "  outliving its retention window right now."
      );
  }
}
