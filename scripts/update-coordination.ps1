# One-shot atomic patch of the shared coordination handoff. Read+replace+
# write in a single process so sibling sessions' concurrent edits between
# our read and write lose at most this patch, never their own content.
$path = "C:\dev\DEMOS_RUNNING_HANDOFF.md"
$text = [System.IO.File]::ReadAllText($path)

$oldRow = "| Demo 1: AxlePoint (maintenance mgmt) | AxlePoint session | IN PROGRESS, chunk 1.1 scaffold | 2026-06-10 00:15 |"
$newRow = "| Demo 1: AxlePoint (maintenance mgmt) | AxlePoint session | APP COMPLETE (chunks 1.1-1.11), pushed to GitHub; container build running; deploying to axlepoint.projectnexuscode.org next | 2026-06-10 (post-interview) |"

$anchor = @"
- **Deploy readiness:** AxlePoint will produce a standalone-output
  Dockerfile (single container, SQLite baked into the image at build
  time, no runtime DB writes needed beyond demo session cookies).
"@

$addition = @"
- **2026-06-10 (post-interview sweep).** State after the 135-turn stall:
  - SHIPPED, verified, committed (``Ginkobaloba/demo-axlepoint``, private,
    main ``a43da57``, delete-branch-on-merge on): full app. Marketing
    landing, cookie demo auth + middleware, dashboard (KPIs, risk
    distribution, top-10 risk table, anomaly rail), assets list with
    filters, asset detail (risk score + explanation panel + model
    confidence 0.78 + sensor charts with anomaly overlay + Recommend
    Preventive Action drafting real predictive WOs), work orders
    (list/detail/new, creation verified end-to-end), schedule calendar +
    30-day list, parts (80 SKUs, 5 below reorder), team (15 techs),
    reports (6 recharts tiles). Production build green; every route
    smoke-tested 200.
  - Data: 100 assets, 544k readings, 1,220 anomalies, risk bands
    critical=5 / high=6 / medium=27 / low=62, MTBF delta -19%. Tuning
    rationale in ``demo-axlepoint/docs/demos/axlepoint/decisions.md``.
  - Banner: ported to TSX per the Phase 0 contract (pn_banner_dismissed,
    role=region, 32px, brand colors). shadcn note: AxlePoint sidestepped
    the CLI entirely (hand-rolled primitives, decisions D-004), a third
    answer next to Slatewell's v4 migration and Lumen's 2.3.0 pin.
  - Phase 0 COMPLETE acknowledged: axlepoint port 8102, DNS + ingress
    live. Plan: finish local image build (first attempt failed,
    better-sqlite3 needs python3/make/g++ on node:20-bookworm-slim,
    fixed), verify locally, then ``deploy-demo.ps1 -Name axlepoint
    -ContextPath C:\dev\demo-axlepoint -InternalPort 3000 -VerifyContent
    "AxlePoint"``.
  - Local port note for sibling sessions: port 3000 on this box is held
    by the Slatewell dev server; AxlePoint verifies on 3105 and has
    registered that in ``C:\dev\.claude\launch.json``.
"@

if ($text.Contains($oldRow)) { $text = $text.Replace($oldRow, $newRow); "row: patched" } else { "row: ANCHOR MISSING" }
if ($text.Contains($anchor)) { $text = $text.Replace($anchor, $anchor + $addition) ; "log: patched" } else { "log: ANCHOR MISSING" }

[System.IO.File]::WriteAllText($path, $text)
"written"
