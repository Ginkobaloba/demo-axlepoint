# Deep Verify: PR #24 stop persisting visitor-typed work-order text (2026-09-19)

Overall: FAIL
Tested-SHA: 4bbb480f1b94f9f0c4c45ecb80c5a4e797b2855b

Independent deep verify of `Ginkobaloba/demo-axlepoint` PR #24 (branch
`fix/no-persist-visitor-text`), run against a production image built from the PR
head. The verifier did not write the PR.

**Verdict: FAIL, one blocker.** What the PR changed works as described:
- title and description are never stored;
- the predictive flow is derived on the server;
- POs carry no visitor text;
- the reset is throttled, guarded, atomic and survives disk-full, EACCES and
  `kill -9`.

But the PR's core premise is wrong. D-012 and the PR body state that "everything
else a visitor can write is already structured", naming `assigned_to` as "a
foreign key picklist". It is not: `assigned_to` is an unvalidated TEXT column with
no FK and no lookup in either write route. Marker text posted in `assigned_to`
through POST `/api/work-orders` (JSON, multipart and urlencoded) and PATCH
`/api/work-orders/[id]` (`action: assign`, on seed and new rows) landed in the
shared DB. It was then served to a **fresh visitor with a separate cookie jar**
inside the page source (RSC flight payload) of `/app/work-orders` and of each work
order's detail page. This is the defect class the PR exists to close, in a field
the PR explicitly vouched for. The reset bounds the exposure to at most 6 hours.
It does not prevent it.

Totals:
- marker attack: 83 requests across 8 routes and 5 methods, 0 5xx. Markers found
  in the raw DB: 11 rows, all in `work_orders.assigned_to`. Title, description, PO,
  schedule and other columns: 0 hits;
- headless: 28 checks, 25 PASS. The other 3 are 2 informative probes and 1
  hydration error that already exists on `main` (see section 2);
- reset matrix: 5 of 5 interval values behaved as claimed;
- race: 460 requests against resets every 1 ms and every 50 ms, 0 5xx;
- missing seed: exactly 1 log line, and the title/description fix held;
- atomicity: disk-full 18 of 18 failures handled, EACCES 15 of 15, `kill -9` 12 of
  12 with the DB intact;
- unit tests: 79 of 79 pass, `tsc` clean.

## 1. Target and scope

- **Target:** PR #24, head `4bbb480f1b94f9f0c4c45ecb80c5a4e797b2855b`, one commit on
  `origin/main` `97828db`. The worktree `C:\dev\demo-axlepoint-wt-fix` had HEAD
  equal to `origin/fix/no-persist-visitor-text` and a clean status. Label: `tier-3`.
- **Mode:** deep. Layers 1, 2, 3 (local origin only), 4 (headless Chromium) and 6
  (edge and adversarial matrix) ran. **Layer 5 (headed Chrome) was not run**, per
  the dispatch rule of no headed Chrome. It is listed as a gap.
- **Image:** `demo-axlepoint:dv24` (`sha256:368be5ab6a8f...`), built once from the
  worktree with the BuildKit `npmrc` secret pattern from `deploy-demo.ps1`. The token
  was read from `~/.secrets/github.agent.local.txt` and never printed. The temporary
  npmrc was deleted after the build and its absence confirmed. Image contents:
  `data/axlepoint.db` and `data/axlepoint.seed.db`, both 43,212,800 bytes and
  byte-identical (`cmp`), owned by `node`, with the process running as uid 1000.
  The image has no `sqlite3` CLI. Raw DB reads used the image's own
  `/app/node_modules/better-sqlite3` through `docker exec ... node`.
- **Containers:** all `dva24-*`, on 127.0.0.1 ports 18911 to 18919. No env was set
  beyond the variable under test, and no secrets were needed. Nothing touched the
  live `demo-axlepoint` container (port 8102, still `Up 6 hours` at the end),
  demo-proxy, the public URL or cloudflare-config. All `dva24-*` containers and the
  image were removed at the end.
- **Write surfaces enumerated:** every `route.ts` under `src/app/api` (8 routes).
  There are no server actions (`"use server"` and `action={` grep: 0 hits). The
  middleware matcher is `/app/:path*` only, so every API route accepts anonymous
  writes (already true on `main`).

## 2. Results by category

| Category | Result | Evidence |
|---|---|---|
| smoke | PASS (local) | `/` shows the 3 copy strings and `form[action='/api/session']`; `/app`, `/app/assets` and `/app/work-orders` 307 to `/?signin=required`; GET `/api/session` 405. HSTS is added at the edge (N/A locally) |
| navigation | PASS | Headless H1, H14: sign-in form to `/app`; `/app`, assets, schedule, reports, parts and work-orders all 200 |
| data_crud | PASS | Create, assign, status, add part, close, reorder PO, schedule PATCH all work (H4 to H11, race runs) |
| **security / privacy (visitor text)** | **FAIL** | Title and description: 0 markers anywhere. `assigned_to`: 11 rows with markers in the raw DB, served to a fresh visitor in the list and detail page source (see Blockers) |
| error_handling | PASS | 400/401/404/405/422 as expected across the 83-request matrix; 0 5xx under reset races, disk-full, EACCES, `kill -9` |
| performance | PASS (local) | First request after boot: 0.18 to 0.52 s with reset on vs 0.55 to 1.08 s with `AXLEPOINT_RESET_DISABLED=1` (3 trials each). The copy cost is below cold-start noise. A request that always resets (interval 50 ms): 0.23 s. Docker Desktop, not the deployed host |
| auth_lifecycle | PASS (unchanged) | Session POST 303, gated routes redirect; the PR does not touch auth |
| security_headers | N/A locally | Edge-only |
| mobile_responsive | PASS (partial) | Visitor B ran at 390x844 |
| accessibility | SKIP | axe-core not in the harness |
| visual_regression | SKIP | No baseline |
| cross_browser | SKIP | Chromium only; headed layer not run |
| edge_cases | PASS except the blocker | See layer 6 |

### Layer 1: code

- `npx vitest run` at `4bbb480`: **10 files, 79 of 79 passed** (matches the PR's claim).
- `npx tsc --noEmit`: exit 0.
- `next build`: succeeded inside the image build (`npm run db:generate && npm run build`).
- CI on the head: Quick Verify SUCCESS (2 runs), Socket SUCCESS (2). Deep Verify
  FAILURE (2) because `verify/reports/` was empty. That is correct gate behavior. This
  report records FAIL, so the gate stays red.
- Code read, with findings that matter:
  - `src/app/api/work-orders/route.ts:81` stores `raw.assigned_to ? String(raw.assigned_to) : null` with no lookup;
  - `src/lib/wo-actions.ts:59-63` (`assign`) does `String(body.assigned_to)` with no lookup;
  - `queries.ts assignWorkOrder` runs `UPDATE work_orders SET assigned_to = ?`;
  - `scripts/generate-db.ts` declares `assigned_to TEXT,` with no `REFERENCES`, and there is no `foreign_keys` pragma anywhere in `src/` or `scripts/`.

### Layer 2: runtime

`dva24-main` started with `Ready in 305ms`, no errors. Inode of `/app/data/axlepoint.db`:
273454 at boot, 28850 after the first request. So the boot reset ran on the first
`getDb()` call. `-wal` and `-shm` appeared afterwards, as expected.

### Layers 3 and 4: network and headless

Headless Chromium harness (Playwright 1.60), two isolated contexts: visitor A at
1440x900 and visitor B at 390x844 with a separate cookie jar.

| ID | Check | Result |
|---|---|---|
| H1 | Landing sign-in form lands on `/app` | PASS |
| H2 | Clicking Recommend Preventive Action on AST-0005 (oil_pressure) lands on a WO titled `Inspect lube oil system - Engine 05 (AST-0005)` | PASS |
| H3 | Detail shows "Pull an oil sample for wear metals analysis." | PASS |
| H4 | Assign TCH-01 persists (Marcus Webb) | PASS |
| H5 | Add part shows a Remove control | PASS |
| H6 | Status closed persists | PASS |
| H7 | New WO form submit reaches detail (see Warning W2 on the redirect) | PASS |
| H8 | Detail shows `Corrective - Engine 42`, no `DVA24H` typed text | PASS |
| H9 | Detail shows the fixed description notice | PASS |
| H10 | "JSON API test order" bounced with `?error=Title looks like a test fixture...` | PASS |
| H11 | Parts page reorder button fires POST `/api/purchase-orders` 200 | PASS |
| H12 | PO list renders | PASS |
| H13 | 0 free-text inputs on the PO list and PO-1011 detail | PASS |
| H14 x6 | `/app`, assets, schedule, reports, parts, work-orders 200 | PASS |
| H15 | Visitor A console clean | PASS |
| H16 | Visitor A: 0 API 5xx | PASS |
| H17 | Visitor B: 0 title/desc/`DVA24H`/`DVA24R` markers in visible list text | PASS |
| H18 | Visitor B: 0 title/desc markers in list page source | PASS |
| H19 | Probe: `assigned_to` markers visible as text in the list | not visible (the list renders `technician_name`, which the LEFT JOIN makes null) |
| H20 | Probe: `assigned_to` markers in list page source | **present**: `DVA24M-patch-assign-...`, `DVA24M-wo-json-assign-preventive`, ... |
| H21 | Visitor B sees the recommended WO with derived text only | PASS |
| H22 | Probe: WO-1152 visible text shows the assignee marker | not visible (select shows empty) |
| H23 | Visitor B console clean | FAIL: React #418 hydration error on `/app/work-orders`. **Already on `main`**: reproduced on a clean, never-written container, desktop and mobile. `work-orders-table.tsx` is not in this diff (Warning W3) |

### Layer 5: headed

Not run (the dispatch forbade headed Chrome). Gap: the real-mouse "Recommend
Preventive Action" click and the form UX in a real browser are only headless-verified.

### Layer 6: edge cases and matrix

**(1) Marker sweep against the real image (`dva24-main`, 18911).** 83 requests, with a
distinct marker per field:
- **POST `/api/work-orders`**:
  - JSON with all four types, plus the extra fields `notes`, `status`, `id` and
    `created_at`;
  - multipart form with all four types;
  - urlencoded;
  - markers placed in `due_date`, `priority`, `type` and `asset_id`;
  - array or object values for `title`, `description` and `assigned_to`;
  - markers in the query string;
  - junk title with marker description and assignee.
- **PATCH `/api/work-orders/[id]`**, on seed WO-1001 and new WO-1151: `assign` (with
  extra `title`/`description`), `status`, `due`, `add_part` (unknown part, marker
  qty), `remove_part`, an unknown action, and an unknown WO id.
- **POs:** POST `/api/purchase-orders` with marker `part_ids`, `notes`, `supplier`
  and `qty` (JSON and form); PATCH with a marker `status`, extra `notes`, `supplier`
  and `expected_at`; an unknown PO id.
- **Schedule:** PATCH `/api/schedule/[id]` with a marker `next_due`, `assigned_to`,
  `task` and `est_hours`.
- **Auth routes:** `/api/session` with a marker in the query and body;
  `/api/auth/portal-handoff` with a marker token (JSON and form).
- **Readings:** GET `/api/assets/[id]/readings` with marker params.
- **Methods:** GET, POST, PUT, PATCH and DELETE on all 8 routes.

Status codes: 19x200, 7x303, 8x400, 1x401, 2x404, 32x405, 14x422, **0 5xx**.

Raw DB scan (every column of every one of the 12 tables, `CAST(col AS TEXT) LIKE '%DVA24M%'`):

```
work_orders: 11 rows, every hit in assigned_to:
  WO-1001 (seed row) assigned_to=DVA24M-patch-assign-WO-1001
  WO-1151 assigned_to=DVA24M-patch-assign-WO-1151
  WO-1152..1159, 1161 assigned_to=DVA24M-wo-{json,form,urlenc,arr}-assign-*
  every title is derived ("Corrective - Engine 42", "Inspect governor and speed control - Engine 42 (AST-0042)")
  every non-predictive description is the fixed notice
TOTAL_HITS 11 tables 12
grep -c DVA24M: axlepoint.db 0, axlepoint.db-wal 51 (all *-assign-*), axlepoint.seed.db 0
```

Title/description markers found anywhere in the DB or WAL: 0. PO columns: 0
(`notes` is always "Auto-drafted from a reorder alert."). Schedule: 0. A `due_date`
marker was accepted with 200 and stored as `due_at` NULL (Warning W4).

Fresh client (new cookie jar `jarB`, HTML and `RSC: 1` flight), 15 URLs:
- title/description markers: 0 on every page;
- `assigned_to` markers: present in `/app/work-orders` (10 distinct), in
  `?status=open`, and in each affected WO detail page. Snippet from the list page
  source:
  `\"type\":\"preventive\",\"assigned_to\":\"DVA24M-wo-json-assign-preventive\",\"created_at\":1789804803`

**(2) PO free text.** Confirmed none:
- POST builds each PO from `parts` rows matched by id (the marker id matched
  nothing) and writes the fixed `notes`;
- PATCH accepts only the status enum;
- the UI has 0 free-text inputs on the PO pages (H13);
- a grep of `<input`/`<textarea>` across `src/app` and `src/components` found only
  the WO title and description inputs, plus search, filter, date and qty controls.

**(3) Recommend Preventive Action.** Two POSTs per asset, each carrying different
marker preview text (`DVA24R-A`, `DVA24R-B`). One asset per top sensor: temperature
AST-0001, vibration AST-0002, rpm AST-0003, oil_pressure AST-0005, cylinder_pressure
AST-0010, fuel_rate AST-0045, plus one asset with no positive factors (AST-0008).

| Asset | A == B | Marker | Stored title |
|---|---|---|---|
| AST-0001 | yes | clean | Inspect cooling circuit - Engine 01 (AST-0001) |
| AST-0002 | yes | clean | Inspect bearings and alignment - Engine 02 (AST-0002) |
| AST-0003 | yes | clean | Inspect governor and speed control - Engine 03 (AST-0003) |
| AST-0005 | yes | clean | Inspect lube oil system - Engine 05 (AST-0005) |
| AST-0008 | yes | clean | Inspect bearings and alignment - Engine 08 (AST-0008), "elevated composite risk score" |
| AST-0010 | yes | clean | Inspect cylinder heads and valves - Engine 10 (AST-0010) |
| AST-0045 | yes | clean | Inspect fuel injection system - Engine 45 (AST-0045) |

The UI click was confirmed as well (H2, H3).

**(4) Reset interval.** One container per value. Method: create a WO, then 30 GETs of
its detail page, sampling the live DB inode after every request (the rename hands the
tmp inode to the live path, so inode changes count copies).

| `AXLEPOINT_RESET_INTERVAL_MS` | Inode changes after the boot reset | Created WO after 30 requests | tmp left |
|---|---|---|---|
| `6h` | 0 (1 total, the boot reset) | 30x200 (persists) | no |
| `-1` | 0 (1 total) | 30x200 | no |
| `""` (set, empty) | 0 (1 total) | 30x200 | no |
| `abc` | 0 (1 total) | 30x200 | no |
| `1` (control) | 30 of 30 | 30x404 (reset away) | no |

The control proves the env var is read at runtime, not inlined at build time.

**(5) PATCH racing a reset.** 20 parallel workers for 30 s each on interval `1` and
interval `50`: create, 5 PATCHes, a page GET, a PO POST and a schedule PATCH per
loop. Then 20 workers PATCHing seed WO-1001 (assign, status, add_part, remove_part)
plus a page GET, on interval 50. Result: 460 requests, 260x200, 200x404 (PATCH
against a visitor WO the reset had already removed; the claimed behavior), **0 5xx**.
Container logs: 0 `error`, `not open` or `SQLITE` lines.

**(6) Missing seed.** Container started with `rm /app/data/axlepoint.seed.db` before
`node server.js`, interval 1. The full 83-request matrix returned status codes
identical to the main run. After 20 more requests, the log contained exactly **1**
`[reset]` line:
`[reset] no seed snapshot at /app/data/axlepoint.seed.db; skipping the visitor-data reset. Run "npm run db:generate" to create one.`
Raw DB: 0 title/description markers. The same 10 `assigned_to` markers were
present (same blocker).

**(7) First-request latency.** See the performance row. The reset adds no
measurable cold-start cost locally. The deployed host was not measured, per the
rules.

**(8) Atomicity.**
- *Disk full mid-copy:*
  - Setup: live and seed DBs on a 90 MB tmpfs (7.7 MB free), with
    `AXLEPOINT_DB_PATH` and `AXLEPOINT_SEED_DB_PATH` pointed there, interval 1.
  - Result: 18 of 18 resets failed with
    `ENOSPC ... copyfile '/mnt/small/axlepoint.seed.db' -> '/mnt/small/axlepoint.db.reset-tmp'`,
    each logged. All 12 requests (pages and creates) returned 200.
  - Aftermath: no `.reset-tmp` left, and the live DB passed `integrity_check` with
    "ok".
- *Unwritable data dir:* `chmod 555 /app/data` as root, interval 1. 15 of 15 resets
  failed with `EACCES ... unlink axlepoint.db-wal`, logged. 10 of 10 requests
  returned 200. After restoring 755: 200.
- *`kill -9` mid-copy:* 12 rounds of `docker kill -s KILL` at a random 0.3 to 1.8 s
  into a request stream (interval 1), then `docker start`:
  - round 2 left a partial `axlepoint.db.reset-tmp` of 15,876,096 bytes;
  - round 7 left a complete 43,212,800-byte tmp (killed between copy and rename);
  - in all 12 rounds the live `axlepoint.db` passed `integrity_check` with "ok" and
    the next request returned 200;
  - the leftover tmp was overwritten and renamed away by the next reset.

**(9) Regression.** H1 to H16 (the closed loop, the reorder PO, every nav page) and
the race runs all passed. Two issues were already on `main` and were not introduced
here: W2 and W3.

## 3. Theater Check

| PR #24 claimed | Verification found | Verdict |
|---|---|---|
| Before: visitor free text was stored in a shared DB and shown to later visitors | True, and it is still true for `assigned_to` | CONFIRMED (problem statement) |
| `work_orders.title` and `description` are never persisted from visitor input; title derived, description a fixed notice | 0 title/desc markers in the DB, WAL, pages or RSC across JSON, form, urlencoded, array and object inputs, all 4 types, with and without a seed | CONFIRMED |
| Predictive WOs derive text from server-side `risk_factors`, ignoring the submission | 7 assets x 2 different submissions: identical, sensor-specific, marker-free; the UI click matches | CONFIRMED |
| POs have no visitor free text | Fixed `notes`, id-matched parts, status enum only, 0 PO inputs in the UI | CONFIRMED |
| "Everything else a visitor can write is already structured/enum-constrained: assigned_to (technician id, a foreign key picklist)" (D-012, PR body) | `assigned_to` accepts any string in POST and PATCH; there is no FK or lookup; 11 rows stored markers; fresh visitors receive them in page source | **THEATER** |
| The audit covered every visitor-writable surface | It covered the routes but not the fields: `assigned_to` was asserted rather than tested. The PR's marker tests post markers only in title/description | **THEATER** (for the field audit) |
| `getDb()` resets on the first call after boot | Inode changed on the first request in every container | CONFIRMED |
| At most once per interval, default 6 h, NaN guard | `6h`, `-1`, `""`, `abc`: 1 reset total over 31 samples; control `1`: 30 of 30 | CONFIRMED |
| Atomic temp-file plus rename | ENOSPC, EACCES and `kill -9` never left an unopenable DB; the tmp is overwritten on the next reset | CONFIRMED |
| Missing seed: skipped, logged once, the fix still holds | 1 line; the title/desc fix held | CONFIRMED |
| A PATCH racing a reset doesn't 500 | 0 5xx in 460 racing requests | CONFIRMED |
| 79/79 tests, tsc clean, build succeeds | Reproduced | CONFIRMED |

## 4. Blockers

### B1. `work_orders.assigned_to` persists and re-serves visitor free text

- **Where:**
  - `src/app/api/work-orders/route.ts:81`;
  - `src/lib/wo-actions.ts:58-63` via `src/app/api/work-orders/[id]/route.ts` (`assign`);
  - `queries.ts createWorkOrder` / `assignWorkOrder`;
  - the schema has `assigned_to TEXT` with no FK.
- **Impact:** any anonymous caller (the API routes are not behind the middleware) can
  write arbitrary text, up to the request size, into any work order, seed rows
  included. Every later visitor receives it in the `/app/work-orders` list and in the
  detail-page RSC payload. It is not visible as rendered text, but it is in the page
  source every visitor downloads. The reset bounds this to at most 6 h. It is the
  same leak class D-012 closes, and D-012 claims this field is safe.
- **Fix:**
  1. In both routes, accept `assigned_to` only if it is `null`, `""` or the id of an
     existing `technicians` row (add a `getTechnician(id)` lookup). Return 422
     otherwise, or coerce to null for the form path.
  2. Add route tests that post markers in `assigned_to` via POST (JSON and form) and
     PATCH `assign`, then assert absence with the same `queries.ts` read-back.
  3. Correct the `assigned_to` sentence in D-012.
  4. Optionally, stop passing raw `w.*` to client components (select only the columns
     the table renders), so a future unvalidated column cannot leak through RSC.
- **Agent tier:** small code change on a Tier-3 surface. A Sonnet-class executor can
  make it (about 20 lines plus tests), but it needs a fresh deep verify (Opus) before
  merge, and Drew merges (Tier-3).

## 5. Warnings

### W1. The PR's own tests encode the false premise
The marker tests post markers in `title` and `description` only, so they would stay
green with B1 present. **Fix:** part of B1 (add `assigned_to` markers). **Tier:**
executor (Sonnet).

### W2. Already on `main`: the New Work Order form redirects to the container bind address
`route.ts:60` builds `new URL(..., request.url)`. The response carries
`Location: http://0.0.0.0:3000/app/work-orders/WO-1179?created=1`, or `https://0.0.0.0:3000/...`
when the request has forwarded headers. A real browser lands on an error page after
submitting the form. `api/session/route.ts` documents this exact trap and uses a
relative Location. The headless run had to rewrite the header for H7 to proceed.
The same line is on `origin/main` (`git show origin/main:src/app/api/work-orders/route.ts`).
This PR did not introduce it, but it breaks the flow the PR edits.
**Fix:** use a relative `Location` (303) like the session route and the reject path.
**Tier:** executor (Sonnet), then a quick verify of the form path (Tier-2).

### W3. Already on `main`: hydration error #418 on `/app/work-orders`
It reproduces on a clean seed DB at both viewports. Likely cause: a date/time
formatted with the server timezone (UTC) in `work-orders-table.tsx` (`fmtDate`) and
then hydrated in the browser timezone. The file is not in this diff.
**Fix:** format on one side only, or pass a fixed timezone.
**Tier:** executor (Sonnet), not Tier-3.

### W4. POST `/api/work-orders` accepts an invalid `due_date` silently
A marker `due_date` returns 200 and stores `due_at` NULL. PATCH `due` rejects the same
input with 422. This does not persist text, but the two routes are inconsistent.
**Fix:** return 422 on a NaN date. **Tier:** executor (Sonnet).

### Minor, not blocking
- `remove_part` accepts any `part_id` string. It only feeds a `DELETE ... WHERE`, so
  nothing persists.
- A failed reset logs a full stack on every due interval. At the 6 h default that is
  negligible, and it only matters on a misconfigured short interval.
- `data/axlepoint.seed.db` is writable by the app user (`chown -R node /app/data`).
  No code writes to it. Making it read-only (`chmod 444` in the Dockerfile) would
  harden the "seed is pristine" assumption.
- The API routes accept anonymous writes (the middleware matcher is `/app` only).
  This is already on `main` and by design for the demo, but it widens B1 to
  unauthenticated callers.

### Coverage gaps (stated so the verdict is not overclaimed)
- Layer 5 (headed Chrome) was not run, by dispatch rule.
- Latency was measured on local Docker Desktop, not the deployed host.
- axe/accessibility and visual regression were not run.
- The origin/main baseline image was not built (one-image rule). "Already on
  `main`" for W2 and W3 rests on the unchanged code lines plus a clean-DB
  reproduction on this image.
- The throwaway harness scripts (`dva24-headless.mjs`, `dva24-hydr.mjs` under
  `C:\dev\_tools\shot`) were deleted after the run; their results are transcribed
  above.

## 6. Run artifacts

- Scratch evidence (local, not committed):
  `C:\Users\Drama\AppData\Local\Temp\claude\C--dev\c411ea0d-b7a5-4294-9c55-34d74f91e960\scratchpad\dv24\`
  - `attack.sh`, `attack_main.txt`, `attack_noseed.txt`;
  - `q.js` (all-table marker scan), `ids.js`, `top.js`;
  - `race.sh`, `race2.sh`, `race_*`, `r2_*`;
  - `recs.txt`, `wo1152-visitorB.png`.
- Build log: `%TEMP%\dva24-build.log`.
- Cleanup: every `dva24-*` container removed (0 remaining), image
  `demo-axlepoint:dv24` deleted, temporary npmrc deleted. Live `demo-axlepoint`
  was untouched.
