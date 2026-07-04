# HANDOFF -- 2026-06-10 -- AxlePoint built, deployed, and on the work page

## What this session did

- **Built the entire AxlePoint demo** (chunks 1.1-1.11 of the demo
  handoff) in `C:\dev\demo-axlepoint`: Next.js 14 App Router, TypeScript,
  Tailwind with the AxlePoint brand system, hand-rolled shadcn-style
  primitives (decisions D-004), SQLite via better-sqlite3.
- **Synthetic data generator** (`scripts/generate-db.ts`): 100 assets,
  8 sites, ~544k sensor readings (hourly 14d, 6-hourly to 183d), EWMA
  z-score anomaly detection (3.5 sigma), explainable 0-100 risk scores
  with smooth saturation, 150 work orders, 80 parts, 15 technicians,
  PM schedule. Deterministic (seeded mulberry32) except the time anchor.
  Tuning history and rationale: `docs/demos/axlepoint/decisions.md`.
- **All pages live**: marketing landing, cookie demo auth + middleware,
  dashboard, assets list + detail (risk explanation panel, model
  confidence 0.78, sensor charts with anomaly overlay, risk-ordered
  tabs), Recommend Preventive Action (drafts real predictive work
  orders), work orders list/detail/new, schedule calendar, parts, team,
  reports (6 recharts tiles). Production build green, all routes 200,
  mobile checked at 375px and 390px.
- **DEPLOYED: https://axlepoint.projectnexuscode.org is LIVE** with valid
  TLS via the Phase 0 pipeline (`deploy-demo.ps1`, host port 8102,
  <HOST> only; BROOKFIELD skipped, see below). Verified externally
  twice (initial deploy + polish redeploy).
- **Repo**: `Ginkobaloba/demo-axlepoint` (private), main at `e4f91e0`
  plus this handoff commit, delete_branch_on_merge on.
- **Marketing site integration (chunk 1.12)**: paradigm-site PR #31
  squash-merged (`dd75906`): "Live demos" section on /work with the
  AxlePoint screenshot card + `/work/axlepoint` case study page.
  Screenshots captured from the live site via Playwright
  (`C:\dev\_tools\shot\shoot-axlepoint.mjs`).
- **Coordination**: status + sweep posted to
  `C:\dev\DEMOS_RUNNING_HANDOFF.md` (AxlePoint section).

## What is currently broken or incomplete

- **paradigm-site /work IS published** (this section updated before
  session end): PR #31 deploy surfaced an nginx regression (/work 301 to
  /work/ then 403, caused by the nested case-study page's directory
  shadowing work.html in try_files). Rolled back within ~3 minutes,
  fixed in PR #32 (`e2d1f71`: resolve $uri.html before directory lookup,
  never serve bare directories), redeployed from `sha-e2d1f71`, all
  public routes verified 200 and gated routes still 404. Rollback image
  retained as `paradigm-site:rollback-pre-pr31` on <HOST>; safe to
  delete once the fix has soaked.
- **BROOKFIELD has no AxlePoint container** (host unreachable + ssh
  config perms block agent-side ssh: "Bad owner or permissions on
  C:\Users\Drama\.ssh\config" for the claude-remote user; needs icacls
  fix). HA is degraded fleet-wide until both are fixed; deploy script
  rolls BROOKFIELD in automatically on the next deploy after that.
- **Screenshot tooling**: the Claude Preview MCP screenshot capture times
  out on this box (snapshots and eval work). Playwright in
  `C:\dev\_tools\shot\` is the working alternative for visual QA.
- Demo work-order drafts persist in the running container until the next
  redeploy (by design, decisions D-005).

## What the next session should do first

1. Read `C:\dev\DEMOS_RUNNING_HANDOFF.md` for cross-demo state.
2. If paradigm-site CI for `dd75906` is green and /work on the live site
   does not show the Live demos section yet: pull the sha image and
   recreate the container on <HOST>, verify
   https://projectnexuscode.org/work shows the AxlePoint card and
   /work/axlepoint renders.
3. Optional polish backlog (none blocking): a dashboard site/type risk
   heatmap, CI workflow for the demo repo itself (build + lint on PR),
   axe-core a11y pass, OG image for the marketing landing.

## Open questions for Drew

- The four demo repos are private. Flip any of them public as portfolio
  artifacts whenever you want; nothing in demo-axlepoint is sensitive.
- BROOKFIELD ssh perms (icacls on your .ssh\config) when convenient; it
  also blocks every other demo's HA deploy.

## Pointers

- Demo spec: Dispatch upload `HANDOFF_20260609_demomaintenancemanagement.md`
- Cross-demo coordination: `C:\dev\DEMOS_RUNNING_HANDOFF.md` (canonical)
- Decisions log: `docs/demos/axlepoint/decisions.md`
- Deploy recipe: `C:\dev\cloudflare-config\docs\demos\README.md`
- Live site: https://axlepoint.projectnexuscode.org
- Case study: https://projectnexuscode.org/work/axlepoint (after publish)

## Next Session Onboarding

Future sessions: read `C:\dev\SESSION_PROTOCOL.md`, then `CLAUDE.md` in
this project, then this file, then run `vstart`.
