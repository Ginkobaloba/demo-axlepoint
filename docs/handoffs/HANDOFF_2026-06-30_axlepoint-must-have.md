# HANDOFF -- 2026-06-30 -- AxlePoint upgraded to "must-have" and redeployed

## What this session did

Closed every gap in Drew's AxlePoint gap analysis and shipped them as five
Tier-2 PRs (agent-reviewed, admin squash-merged bottom-up), then redeployed
the live demo.

- **PR #8 -- junk-title guard** (gap 5). The seed generator was already clean
  (0 junk rows in a fresh DB); the "Test" / "JSON API test order" /
  "Test audit work order" records were RUNTIME drafts that accumulated in the
  live container via the open create endpoint (drafts persist until redeploy,
  D-005). Added `screenWorkOrderTitle` (src/lib/work-order-validation.ts):
  rejects sub-6-char and test/placeholder titles; 422 for API callers, a
  relative redirect-with-reason for form posts. The redeploy regenerates the
  DB and clears the existing junk; the guard stops it re-accumulating.
- **PR #9 -- writable work order, the closed loop** (gap 1, the headline).
  `PATCH /api/work-orders/[id]` plus two client components let you move status,
  assign a technician, set a due date, and attach/detach parts. Closing stamps
  completed_at; reopening clears it. **Also unblocked `next build`**: main
  could not build due to two pre-existing auth-chunk breakers (a `makeHandler`
  export from the portal-handoff route, and an unused import). Extracted the
  handler to src/lib/portal-handoff-handler.ts; route exports only POST. (The
  parallel Harbor work flagged the same breaker pattern.)
- **PR #10 -- table search/sort/filter** (gap 3). Work Orders and Parts are now
  client tables with search, every-column sort (shared unit-tested util,
  numeric-aware, nulls-last), and filters (WO: status tabs + type + priority;
  Parts: category + stock status).
- **PR #11 -- purchase-order entity + parts<->WO linkage** (gap 2). New
  purchase_orders / purchase_order_lines tables (UNIQUE(po_id, part_id)),
  seeded with 13 historical/in-flight POs. Purchase Orders nav (list + detail).
  "Create reorder PO" drafts one PO per supplier for all below-reorder parts
  (recommended qty = reorder_point*2 - on_hand); per-part "Reorder this part"
  on a new part detail page. Lifecycle draft -> ordered -> received, where
  **receiving restocks inventory** (the one place stock is incremented). Part
  detail lists consuming work orders and the POs that include the part.
- **PR #12 -- interactive schedule** (gap 4). Month/Week/Day/By-technician
  views with prev/next/today nav, and drag-to-reschedule (drop a task on a day
  -> optimistic move + `PATCH /api/schedule/[id]`, reverts on failure).

Every PR: `next build` green, vitest green (61 tests total across the session),
and a browser click-through of the actual workflow (not just a page load).
Decisions D-006 through D-011 logged in docs/demos/axlepoint/decisions.md.

- **Redeployed to DREWSPC** (`-LocalOnly`, the tunnel origin). The fresh image
  ran `db:generate && next build`, so the live DB is clean (no junk WOs) and
  has the PO tables. Verified: https://axlepoint.projectnexuscode.org returns
  200 through Cloudflare with "AxlePoint", and an authenticated container smoke
  check confirmed all five surfaces live (Purchase Orders, schedule "By
  technician", WO search, "Create reorder PO") with no junk titles.

## What is currently broken or incomplete

- **deploy-demo.ps1 empty-env-file bug (cloudflare-config).** The deploy script
  crashes in `Deploy-Local` for any demo with NO env files: `Resolve-EnvFiles`'
  `, $resolved.ToArray()` wraps an empty list into a 1-element array holding
  `@()`, so `Get-EnvDockerArgs` emits a stray `--env-file` that steals the image
  arg ("docker run requires at least 1 argument"). Because Deploy-Local removes
  the old container BEFORE the failed run, **the site went down** until the new
  container was started by hand:
  `docker run -d --name demo-axlepoint --restart unless-stopped -p 8102:3000 demo-axlepoint:latest`
  then `docker exec demo-proxy nginx -s reload`. A background task was spawned
  to fix it (guard the empty case in Resolve-EnvFiles / Get-EnvDockerArgs).
  Until that lands, deploy axlepoint by hand or with a throwaway `.env.demo`.
- **BROOKFIELD HA still degraded.** Deploy was `-LocalOnly`; BROOKFIELD has no
  axlepoint container (pre-existing ssh blocker). The tunnel serves from
  DREWSPC alone.
- **17 Dependabot alerts** on the repo (6 high / 8 moderate / 3 low),
  pre-existing, not addressed this session.
- **Git worktree wrinkle:** `main` is checked out in another worktree
  (`C:\Users\Drama\Desktop\Claude\demo-axlepoint\elastic-taussig-85a4fa`), so
  `git checkout main` in C:\dev\demo-axlepoint fails. This clone was left on a
  detached/branch state; all work is merged to origin/main regardless. Someone
  should `git worktree remove` that stray worktree when convenient.

## What the next session should do first

1. Land the deploy-demo.ps1 fix (background task `task_687a0436`) so axlepoint
   (and any env-file-less demo) deploys cleanly without manual recovery.
2. Resolve the stray `main` worktree so this clone can sit on main normally.
3. Optional polish: PO list could get the same search/sort treatment as the
   other tables; a "reschedule from the work-order detail" affordance; address
   the Dependabot backlog.

## Open questions for Drew

- The PO reorder rule is reorder-to-2x-target. Fine as a demo heuristic, or do
  you want a different policy (economic order qty, supplier MOQ)?
- Flip the repo public as a portfolio artifact whenever you want; nothing is
  sensitive.

## Pointers

- Decisions log: docs/demos/axlepoint/decisions.md (D-001..D-011)
- Live site: https://axlepoint.projectnexuscode.org (DREWSPC, host port 8102)
- Deploy recipe: project CLAUDE.md "Deploy" section (note the env-file bug above)
- Prior handoff: docs/handoffs/HANDOFF_2026-06-10_axlepoint-live.md

## Next Session Onboarding

Future sessions: read `C:\dev\SESSION_PROTOCOL.md`, then `CLAUDE.md` in this
project, then this file, then run `vstart`.
