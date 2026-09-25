# 2026-09-25 07:06 CDT - Freshness gate reads one clock, the database's
- **Who:** Claude (Opus 5). Raised by the Orchestrator from Treadle's flake diagnosis.
- **Change:** `assessResetFreshness` takes an `age_hours` computed BY POSTGRES
  instead of a `finished_at` timestamp compared against Node's `new Date()`.
  `started_at` is now derived from the database clock too. A negative age
  fails closed.
- **Why:** The gate mixed clocks. `finished_at` defaulted to the database's
  `now()`; the comparison used the host's. Over six hours milliseconds do not
  matter, but **the failure is not symmetric**: a host clock running BEHIND the
  database shrinks the age, so a genuinely stale reset reports OK. A retention
  gate that fails OPEN on clock skew is worse than no gate, because it is
  believed. Treadle's one-in-eight flake was the same shape, with its container
  47-95ms ahead; against Neon, or a laptop that has slept, the skew is larger.
- **State after:** 122 unit tests, 61 integration. Verified end to end against
  the database clock: a fresh seed reads OK (exit 0); a row aged nine hours
  reads STALE (exit 1); a row stamped three hours in the FUTURE reads STALE
  (exit 1) rather than being the quietest possible pass.
- **A second trap found by the end-to-end run, which the unit tests could not
  see:** `EXTRACT(EPOCH FROM ...)` returns NUMERIC, and node-postgres hands
  numeric back as a STRING for the same precision reason as int8. `age_hours`
  arrived as "9.37" and `.toFixed()` threw. The unit tests pass a real number,
  so the type only changes crossing the driver. Cast to `::float8`.
  Worth adding to the dialect-trap list beside int8: **numeric is a string too.**
- **Also:** while verifying, `cmd | tail -1; echo $?` reported TAIL's exit
  status rather than the command's -- a measurement reading the wrong thing,
  which is the class this whole gate exists to prevent. Captured to a file and
  read `$?` directly instead.
- **Refs:** D-027. Same rule applied in the harborbistro port from the start.
