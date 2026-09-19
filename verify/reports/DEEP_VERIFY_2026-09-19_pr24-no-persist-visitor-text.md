# Deep Verify: PR #24 stop persisting visitor-typed work-order text (2026-09-19)

Overall: FAIL
Tested-SHA: fb2639bfa515657a88cf194868d021d7c0c9dd99

## Re-verify (round 2): fb2639b, Overall: FAIL

This is a re-verify of `fb2639bfa515657a88cf194868d021d7c0c9dd99`, the builder's fix
commit on top of the round-1 tested commit `4bbb480`. (`684b54b`, the round-1
report, sits between them.) One production image, `demo-axlepoint:dv24`
(`sha256:55b13714aaba...`), was built from the new head with the same BuildKit npmrc
secret pattern. The temporary npmrc was deleted and its absence confirmed. Every
`dva24-*` container and the image were removed at the end. The live container was
untouched.

**Verdict: FAIL, one new blocker (B2), introduced by the fix commit.** The
privacy fix itself is now complete, and so are W2 and W4. But the new
`chmod 444 /app/data/axlepoint.seed.db` in the Dockerfile breaks the image:
- `fs.copyFileSync` copies the source file's permission bits;
- so the boot reset turns the **live** database into `-r--r--r--` on the first
  request after every container start;
- from then on every write returns 500 with `SqliteError: attempt to write a
  readonly database`: creating a work order, every PATCH, POs and schedule;
- the demo's headline flow is dead as built.

The 88 unit tests do not catch it because the test fixtures never make the seed
read-only.

Round-2 totals:
- **as-built image:**
  - marker sweep of 83 requests: 9 5xx;
  - race run: 200 of 200 writes returned 500;
  - headless regression: 10 of 20;
- **same image with the seed made writable again at start** (`chmod 644`, to
  test the rest of the fix separately):
  - marker sweep: 83 requests, 0 5xx, 0 markers in the DB, WAL, HTML or RSC;
  - headless: 20 of 20;
  - reset matrix: 5 of 5;
  - race: 0 5xx;
- **code:** 88 of 88 unit tests, `tsc` clean.

### R2.1 Diff review, 4bbb480 to fb2639b

`git diff 4bbb480 fb2639b` changes 9 files: Dockerfile, decisions.md, both work-order
routes, route.test.ts, db.ts, queries.ts, test fixtures, plus the round-1 report.

- **B1 fix (correct):**
  - New `getTechnician(id)` with a parameterized `SELECT`.
  - POST trims `assigned_to`. Empty or absent means null; anything else must exist,
    else 422 (the form path gets a relative 303 to `?error=Unknown technician.`).
  - PATCH `assign` checks `getTechnician` before the write, else 422.
  - The parser stays DB-free, which is reasonable.
- **W2 fix (correct):** a relative `Location: /app/work-orders/<id>?created=1`, 303.
  The JSON `url` is unchanged in meaning.
- **W4 fix (correct):** POST returns 422 on a NaN date, like PATCH.
- **Log hardening (correct):** one line per failed reset.
- **Dockerfile `chmod 444` seed: DEFECT (B2).** `resetDbIfDue` still does
  `fs.copyFileSync(SEED_DB_PATH, tmp); fs.renameSync(tmp, DB_PATH)`. There is no
  chmod of the temp file, so the mode propagates to the live DB.
- **D-012 addendum:** it accurately corrects the `assigned_to` claim. It says the
  read-only seed "hardens" the reset, which is the opposite of what happens.

### R2.2 Re-audit of every stored string a visitor controls

This does not rely on the builder's list. I listed every `INSERT`, `UPDATE` and
`DELETE` in `src/lib/queries.ts` (20 statements) and traced each bound value back to
the request:

| Column | Source | Visitor free text? |
|---|---|---|
| work_orders.title / description | derived / fixed notice / `risk_factors` | no |
| work_orders.assigned_to | `getTechnician` must match (both routes) | no (fixed) |
| work_orders.status / priority / type | enum lists | no |
| work_orders.due_at, created_at, completed_at | numbers | no |
| work_order_parts.part_id / qty | `getPart` must match / int 1..999 | no |
| maintenance_schedule.next_due | `isValidIsoDate` (regex plus round-trip) | no |
| purchase_orders.* | supplier from `parts` rows, fixed notes, status via parser | no |
| purchase_order_lines.* | ids matched from `parts` | no |
| meta.wo_seq / po_seq | server counters | no |

No remaining free-text path was found. Each row was also checked at runtime by
the sweep below.

### R2.3 Marker sweep (claim 1), all 8 routes, 5 methods, all encodings

I re-ran the round-1 matrix (83 requests, `attack.sh`), which puts a marker in every
field, including `assigned_to`, on POST JSON, multipart and urlencoded, and on
PATCH seed and new rows.

I added a valid-path set so creates actually succeed while carrying markers in
every other field:
- 4 types by JSON with `assigned_to=" TCH-01 "`;
- 4 types by form with `TCH-02`;
- 1 urlencoded create with an empty `assigned_to`.

I also added `assigned_to` variants on PATCH: `"TCH-01 DVA24M-x"`, `"tch-01"`,
`"TCH-01%"`, an SQL-quote payload, a number, an object, and null.

Results:
- **Seed made writable (dva24-rw):**
  - Status codes: 11x200, 7x303, 8x400, 1x401, 2x404, 32x405, 22x422, **0 5xx**.
  - Every marker `assigned_to` returned 422 `Unknown technician.` All 6 bad PATCH
    variants returned 422. `TCH-03` and null returned 200.
  - Raw DB scan of every column in all 12 tables: `TOTAL_HITS 0`. `grep -c DVA24M`
    on the db, WAL, shm and seed files: 0, 0, 0, 0.
  - The stored rows show derived titles, the fixed notice, `assigned_to` in
    {`TCH-01`, `TCH-02`, `TCH-03`, null}, and numeric `due_at`.
- **Fresh client** (new cookie jar), HTML and `RSC: 1` flight on 16 URLs (list,
  `?status=open`, 6 WO details including seed WO-1001, asset, PO list, 2 PO
  details, schedule, parts, reports): 0 markers on every one.
- **As-built image (dva24-main):** 0 markers anywhere, but only because writes fail.
  9 requests returned 500 (PO create x4, PO PATCH, schedule PATCH, WO PATCH
  add/remove part, WO create).

### R2.4 W2, form redirect in a real browser (headless Chromium, no request rewriting)

On the writable-seed container:
- the New Work Order submit landed on
  `http://127.0.0.1:18912/app/work-orders/WO-1165?created=1`;
- the recorded main-frame navigations contain no `0.0.0.0`;
- the due-date form also landed on its WO;
- curl `Location` headers are all relative (`/app/work-orders/WO-1153?created=1`);
- the error paths are relative too (`/app/work-orders/new?error=Unknown%20technician.`,
  `...?error=Invalid%20due%20date.`).

**PASS.** On the as-built image the same submit ends on
`/api/work-orders` with a 500 (B2).

### R2.5 W4, due_date consistency

| due_date | POST | PATCH due |
|---|---|---|
| `DVA24M-due` | 422 | 422 |
| `2026-13-01` | 422 | 422 |
| `2026-10-01T05:00` | 422 | 422 |
| `20261001` | 422 | 422 |
| `1789804800` (string) | 422 | 422 |
| `2026-02-30` | 200 (rolls to Mar 2) | 200 (same) |
| `"  "` (spaces) | 200, null | 422 |
| `""` | 200, null | 200, null |

The fix works as intended. Two small remaining inconsistencies (minor, not
blocking): both routes accept an overflow date, and they handle a whitespace-only
value differently. Neither stores text.

### R2.6 Reset, atomicity, race (claim 4) with the chmod 444 seed

- **Interval matrix** (writable-seed containers; inode counted after each of 31
  samples):
  - `6h`, `-1`, `""`, `abc`: 1 inode change in total (the boot reset), and the
    created WO survived 30 of 30 requests.
  - `1`: 30 changes, and the WO was reset away (30 x 404).
  - **PASS.**
- **Race, 30 s:** 20 create-then-PATCH workers plus 10 seed-PATCH workers.
  - Writable seed at interval `1`: 0 5xx; the 404s are PATCHes on rows already
    reset away.
  - Writable seed at interval `50`: 0 5xx.
  - **As-built at interval `50`:** create 20x500, PATCH 140x500, PO 20x500,
    schedule 20x500. Logs show 200 x `SqliteError: attempt to write a readonly
    database`.
- **Live-DB mode after the boot reset, as built:**
  - before the first request: `-rw-r--r-- axlepoint.db`;
  - after it: `-r--r--r-- axlepoint.db`, `-r--r--r-- axlepoint.db-shm`,
    `-r--r--r-- axlepoint.db-wal`.
- **ENOSPC** (read-only seed kept, 7.7 MB free):
  - 24 of 24 failed resets were each logged on **one line**
    (`[reset] axlepoint seed reset failed: ENOSPC: ...`), with no stack.
  - Pages and creates all returned 200 (ironically, because the copy never landed
    and the live DB kept mode 644).
  - `integrity_check` returned ok, and no temp file was left.
- **Missing seed:**
  - exactly 1 `[reset]` line;
  - the sweep's status codes matched the writable-seed run exactly;
  - DB `TOTAL_HITS 0`.
  - **PASS.**
- **`kill -9` mid-copy, as built, 10 rounds:**
  - The live DB passed `integrity_check` ok every round, and pages returned 200.
    Nothing unopenable.
  - **But** round 2 left a partial, **read-only** `axlepoint.db.reset-tmp`
    (20,697,088 bytes, `-r--r--r--`). It was never cleaned up: every later round
    shows the same file.
  - The log then contains 92 x `EACCES: permission denied, copyfile ... ->
    axlepoint.db.reset-tmp`.
  - So one crash mid-copy **permanently disables the reset** until a redeploy.
    The read-only temp file cannot be overwritten by `copyFileSync`.
  - This is part of B2.

### R2.7 Regression (claim 6), headless Chromium

- **Writable seed: 20 of 20.**
  - Recommend Preventive Action on AST-0005 gave "Inspect lube oil system - Engine
    05 (AST-0005)".
  - The closed loop worked: assign (Marcus Webb), in_progress, add part, closed.
  - The form create with TCH-02 gave the derived title, the notice, and no typed
    text.
  - Reorder PO returned 200. The PO list had 0 free-text inputs.
  - 6 nav pages returned 200. 0 API 5xx. A fresh visitor saw 0 markers.
- **As built: 10 of 20.**
  - Recommend Preventive Action stays on the asset page, with 0 WOs created.
  - The closed loop cannot start.
  - The form ends on a 500.
  - Reorder PO returns 500.
  - Only the read-only pages pass.
- W3 (the hydration error #418, already on `main`) was not re-tested. It is out of
  scope, and the builder deferred it.

### R2.8 Code layer

- `npx vitest run` at `fb2639b`: 10 files, **88 of 88** pass.
- `npx tsc --noEmit`: exit 0.
- `next build` succeeded in the image build.
- `db.test.ts` has no test with a read-only (0444) seed, so B2 is invisible to the
  suite.

### Round-2 Theater Check

| Builder claimed | Verification found | Verdict |
|---|---|---|
| B1: `assigned_to` validated by `getTechnician` in POST and PATCH `assign`, 422 otherwise | All marker and variant values return 422; valid ids and null accepted; 0 markers in the DB, WAL or any page source | CONFIRMED |
| W1: marker tests on `assigned_to`, seed pre-assigned to prove non-mutation | Present in route.test.ts and the fixtures; 88 of 88 pass | CONFIRMED |
| W2: relative 303 Location | Relative on the success and error paths; a real headless browser lands on the created WO | CONFIRMED (only reachable with a writable seed; see B2) |
| W4: POST due_date returns 422 | 422 on every NaN date, matching PATCH | CONFIRMED (minor edge differences above) |
| Seed DB chmod 444 "hardens" the reset | It makes the live DB read-only after the first reset (every write 500s), and a crash mid-copy leaves a read-only temp file that blocks every later reset | **THEATER / REGRESSION** |
| A failing reset logs one line | 1 line per failure (ENOSPC, EACCES), no stack | CONFIRMED |
| D-012 corrected with an addendum | The `assigned_to` correction is accurate; the "hardening" paragraph is wrong (B2) | PARTIAL |
| 88 tests | 88 of 88 | CONFIRMED |

### Round-2 Blockers

#### B2. The chmod 444 seed makes the live DB read-only: every write 500s in the built image

- **Where:**
  - `Dockerfile` (`chmod 444 /app/data/axlepoint.seed.db`);
  - combined with `src/lib/db.ts` `resetDbIfDue` (`copyFileSync` preserves the
    mode, and the temp file is never chmodded or removed before the copy).
- **Impact:**
  - on every container start, the first `getDb()` call turns the live DB read-only;
  - every write route returns 500 (`SQLITE_READONLY`) for the life of the container;
  - Recommend Preventive Action, New Work Order, the closed loop, POs and schedule
    drag are all broken;
  - separately, a crash mid-copy leaves a read-only `.reset-tmp` that makes every
    later reset fail with EACCES until a redeploy.
- **Fix, either option:**
  - (a) In `resetDbIfDue`: remove any stale temp file first
    (`fs.rmSync(tmp, { force: true })`), copy, then `fs.chmodSync(tmp, 0o644)`
    before the rename.
  - (b) Drop the Dockerfile chmod. The seed is already never written by code.
  - Then add a `db.test.ts` case with a 0o444 seed. It should assert that the live
    DB accepts a write after a reset, and that a stale read-only temp file does not
    block the next reset. Note that POSIX modes are only meaningful on Linux or CI,
    not on Windows.
  - Fix the D-012 hardening paragraph.
- **Agent tier:**
  - Sonnet can make the code change (about 5 lines plus a test).
  - It needs another deep verify (Opus) against a built image, not just unit tests:
    this bug exists only in the container.
  - Drew merges (Tier-3).

### Round-2 Warnings

- **W3 (already on main):** the hydration error #418 on `/app/work-orders` is
  still open. The builder deferred it. Sonnet, not Tier-3.
- **W5 (minor):** `due_date` edge differences between POST and PATCH: POST accepts
  a whitespace-only value, and both routes accept an overflow date such as
  `2026-02-30`. Using `isValidIsoDate` in both would align them. Sonnet.
- **Process:** B2 passed 88 unit tests and a clean build. Container-level changes
  (the Dockerfile) need a runtime check before anyone claims done.

### Round-2 coverage gaps

- No headed Chrome (dispatch rule). No axe, visual regression, or deployed-host
  latency.
- The workaround container (`chmod 644` at start) is a test device. Those results
  show what the code does once B2 is fixed, not what the as-built image does.
- The throwaway harness (`dva24r2-headless.mjs`) was deleted after the run. Its
  results are transcribed above. Scratch evidence is in the same scratchpad
  `dv24\` folder (`r2_attack_*.txt`, `race_*`, `r2_*`).

---

# Round 1 (history): tested 4bbb480f1b94f9f0c4c45ecb80c5a4e797b2855b, Overall: FAIL

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
