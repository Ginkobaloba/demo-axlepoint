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
  finished_at: Date;
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
  now: Date = new Date(),
): ResetVerdict {
  if (!latest) return { kind: "NEVER_RAN" };

  const ageHours = (now.getTime() - latest.finished_at.getTime()) / 3_600_000;

  // A failed latest run is reported as FAILED even when an older success is
  // still inside the window. The window is not the point: something is broken
  // now, and reporting OK because of a stale success is how a broken reset
  // goes unnoticed until the window closes.
  if (!latest.ok) return { kind: "FAILED", ageHours, error: latest.error };

  if (ageHours > limitHours) return { kind: "STALE", ageHours, limitHours };

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
