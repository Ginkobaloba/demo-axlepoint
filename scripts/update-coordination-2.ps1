# Second atomic patch of the shared coordination handoff: publish record.
$path = "C:\dev\DEMOS_RUNNING_HANDOFF.md"
$text = [System.IO.File]::ReadAllText($path)

$oldRow = "| Demo 1: AxlePoint (maintenance mgmt) | AxlePoint session | APP COMPLETE (chunks 1.1-1.11), pushed to GitHub; container build running; deploying to axlepoint.projectnexuscode.org next | 2026-06-10 (post-interview) |"
$newRow = "| Demo 1: AxlePoint (maintenance mgmt) | AxlePoint session | LIVE at https://axlepoint.projectnexuscode.org (DREWSPC only, BROOKFIELD pending ssh fix); /work card + case study published | 2026-06-10 (pm) |"

$anchor = @"
  - Local port note for sibling sessions: port 3000 on this box is held
    by the Slatewell dev server; AxlePoint verifies on 3105 and has
    registered that in ``C:\dev\.claude\launch.json``.
"@

$addition = @"
- **2026-06-10 (pm): AxlePoint LIVE + /work published. Chunks 1.1-1.12
  complete.**
  - https://axlepoint.projectnexuscode.org deployed via deploy-demo.ps1,
    verified through Cloudflare twice (initial + polish redeploy).
    BROOKFIELD skipped by the script (known ssh perms blocker).
  - paradigm-site: PR #31 (Live demos section on /work + /work/axlepoint
    case study) and PR #32 (nginx fix, below) merged; site recreated on
    DREWSPC from ``sha-e2d1f71``; all public routes verified 200, gated
    routes still 404. Rollback image kept as
    ``paradigm-site:rollback-pre-pr31`` on DREWSPC.
  - **INCIDENT (resolved, ~3 min exposure): /work 403 after PR #31
    deploy.** Astro file output creates ``dist/work/`` for the nested case
    study page, and the strict nginx try_files checked ``$uri/`` before
    ``$uri.html``, so /work 301d to /work/ then 403d. Rolled back within
    ~3 minutes, fixed properly in PR #32 (resolve ``$uri.html`` first,
    never serve bare directories), verified on a local image build before
    merge. LESSON for demo sessions: if you add a nested route to
    paradigm-site whose parent path matches an existing page, you needed
    PR #32's image or you reintroduce this.
  - Screenshot tooling note: Claude Preview MCP screenshot times out on
    this box; Playwright harness at ``C:\dev\_tools\shot\`` works (used
    for the /work card hero + QA).
  - AxlePoint session handoff:
    ``demo-axlepoint/docs/handoffs/HANDOFF_2026-06-10_axlepoint-live.md``.
"@

if ($text.Contains($oldRow)) { $text = $text.Replace($oldRow, $newRow); "row: patched" } else { "row: ANCHOR MISSING" }
if ($text.Contains($anchor)) { $text = $text.Replace($anchor, $anchor + $addition); "log: patched" } else { "log: ANCHOR MISSING" }

[System.IO.File]::WriteAllText($path, $text)
"written"
