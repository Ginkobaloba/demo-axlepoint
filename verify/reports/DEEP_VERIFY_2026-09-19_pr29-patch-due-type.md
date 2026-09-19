# Deep Verify: PR #29 PATCH due_date rejects non-string values (2026-09-19)

Overall: PASS
Tested-SHA: 61176ddf23d44b9e56e2297aa21e1404cc04a24b

Independent deep verify of `Ginkobaloba/demo-axlepoint` PR #29 (branch
`fix/patch-due-type`, label `tier-3`). This closes W6 from the PR #24 deep-verify
report. The verifier did not write the PR.

**Result: PASS.** The fix does exactly what it claims, and it was proven with a
before-and-after control rather than a read of the diff: the same 14-value matrix
was run against the fixed image and against an image carrying the pre-fix code,
with the stored `due_at` read out of the container's SQLite database after every
single request.

Totals:
- **2 production images** from the same worktree tree, built with the BuildKit
  npmrc secret: the fix (`dvaxle:dvn29`, `sha256:c5cebc7c30a1...`, node
  v20.20.2) and a pre-fix control (`dvaxle:dvn22`, built from PR #27's branch,
  which shares the merge-base `2739306` and still carries the old `asInt`
  fallback).
- **PATCH matrix:** 14 values x 2 builds = 28 requests, each followed by a DB
  read. Every one of the 14 outcomes on the fixed build matches the claim.
- **The bug is real and is gone:** on the pre-fix control, `true` stored
  `due_at=1` (1970-01-01T00:00:01Z) and `[]` stored `due_at=0`
  (1970-01-01T00:00:00Z), both with a 200. On the fix, both return 422 and the
  stored value is untouched.
- **POST behavior recorded honestly:** POST rejects `true`, `{}`, `0` and a
  numeric epoch with 422, and **silently treats `[]` as "clear the due date"**
  (200, `due_at` NULL). Exactly as the builder stated. Out of scope for this PR,
  stated for the record.
- **No other caller sends `due_date`:** grep of `src/` confirms the date picker
  in `work-order-controls.tsx` is the only sender, always `e.target.value || null`
  (string or null) or a bare `null`.
- **Regression:** 106 of 106 unit tests pass on Linux (including the 2 POSIX-only
  cases that skip on Windows), `tsc --noEmit` exit 0, `eslint .` 0 errors, the
  work-order closed loop is 7 of 7, and PR #24's no-persist marker sweep still
  finds 0 markers in the database, the HTML or the RSC payload.

Layer 5 (headed Chrome) was **not run**, by dispatch rule. It is listed as a gap,
not a pass.

## 1. Target and scope

- **Target:** PR #29, head `61176ddf23d44b9e56e2297aa21e1404cc04a24b`, two
  commits on top of `2739306`. Worktree
  `C:\dev\_worktrees\axlepoint-patch-due-type`, branch `fix/patch-due-type`,
  `git status --porcelain` empty.
- **Mode:** deep. Layers 1, 2, 3 (local origin only), 4 (curl and raw page
  source) and 6 (edge and control matrix) ran. Layer 5 did not.
- **Repo assertions:** `verify/smoke.yml` and `verify/tier_map.yml` present. The
  changed surface is the work-order write path, which `tier_map.yml` rates
  tier 2, but the PR carries the `tier-3` label, so it was treated as tier-3.
- **Credential handling:** the npmrc was passed to BuildKit by path only
  (`--secret id=npmrc,src=<path>`). It was never opened, read, printed or
  hashed. No 401 occurred at any point.
- **Containers:** `dvn29-app` on 127.0.0.1:18963 (the fix) and `dvn27-app` on
  127.0.0.1:18961 (the pre-fix control). Nothing touched the live
  `demo-axlepoint` container, demo-proxy, the public URL or cloudflare-config.
  All containers and images created for this run were removed at the end.
- **The control is legitimate.** `dvaxle:dvn22` was built from
  `chore/node22-base` (PR #27), which branches from the same merge-base
  `2739306` and changes only the Dockerfile and two docs files. Its
  `src/lib/wo-actions.ts` still ends the `due` case with
  `const epoch = asInt(body.due_date); ... return { ok: true, action: { kind:
  "due", due_at: epoch } }`, which is exactly the pre-fix code. The control
  image runs node 22 (v22.23.2, since PR #27 is the node 22 base-image change)
  and the fix image runs node 20 (v20.20.2). That difference does not confound
  the comparison: `parseWorkOrderPatch` is pure JavaScript, `Number(true) === 1`
  and `Number([]) === 0` are ECMAScript semantics rather than runtime behavior,
  and all 11 non-W6 rows of the matrix produced identical results on both
  builds. Only the 3 rows the fix targets differ.

## 2. Results by category

| Category | Result | Evidence |
|---|---|---|
| smoke | PASS | `/` 200 on both builds |
| navigation | PASS | `/app`, `/app/assets`, `/app/work-orders`, `/app/schedule`, `/app/reports`, `/app/parts` all 200 |
| auth_lifecycle | PASS | Unchanged by this PR; sign-in cookie and gated redirects behave as in the PR #24 run |
| data_crud | PASS | Closed loop create, assign, due, in_progress, add_part, remove_part, closed: 7 of 7 200, and the due date read back as `2027-06-01T12:00:00Z` |
| **validation (the fix)** | **PASS** | 14-value PATCH matrix, section 3, with the DB checked after every request |
| error_handling | PASS | 422 on every invalid due value with `{"error":"Invalid due date."}`; 400 on malformed PATCH JSON. See W1 for a pre-existing 500 on malformed POST JSON |
| security / privacy | PASS | PR #24 marker sweep: `TOTAL_HITS 0` across all tables, 0 markers in HTML or RSC |
| performance | PASS (local) | Pages served in well under a second on local Docker |
| security_headers | N/A locally | Edge-only |
| visual_regression, accessibility, mobile_responsive, cross_browser | SKIP | No browser layer this run |
| edge_cases | PASS | Section 3 and section 4 |

### Layer 1: code

Run inside the image's own `build` stage (Linux, the same condition CI would
have if it ran tests):

- `npx vitest run`: **11 files, 106 of 106 passed**. That includes the 2
  POSIX-only `db.test.ts` cases that skip on Windows (the builder's "104 passed,
  2 skipped" is the Windows number and is consistent), and the new `W6:
  non-string due_date is rejected instead of coerced to a number` case.
- `npx tsc --noEmit`: exit 0.
- `npm run lint` (`eslint .`): **0 errors**, 7 warnings, all pre-existing and
  none in the diff.
- `next build`: succeeded inside the image build.
- CI on the head: Quick Verify **pass**, Socket Security Project Report **pass**,
  Socket Security Pull Request Alerts **pass**, Deep Verify **fail** because
  `verify/reports/` carried no report for pr29. That is correct gate behavior;
  this report is the thing it was waiting for.

**Dead-code check.** Removing the epoch branch does not orphan `asInt`: it is
still used by the `add_part` case for `qty`. The lint clean is therefore honest,
not an artifact.

### Layer 2: runtime

`dvn29-app` started with `Ready in 75ms`. The only error lines in the container
log for the whole run are two `SyntaxError: ... is not valid JSON` stacks, both
produced by this verifier's own malformed-body probes against POST
`/api/work-orders` (see W1), and both reproduced identically on the control. No
`SqliteError`, no unhandled rejections, no restart loops.

## 3. The fix: PATCH `/api/work-orders/[id]` with `action: "due"`

Method: for every value, first PATCH the subject work order to a known good date
(`2030-01-02`, stored as `due_at=1893585600`), then send the test value, then
read `work_orders.due_at` straight out of `/app/data/axlepoint.db` through the
image's own better-sqlite3 (`docker exec ... node`, since the slim image has no
sqlite3 CLI). A row still showing `2030-01-02` means the write was rejected and
nothing was stored.

### 3.1 PR #29 (fixed), subject WO-1151

| `due_date` payload | status | response body | stored `due_at` after |
|---|---|---|---|
| `true` | 422 | `{"error":"Invalid due date."}` | 1893585600 (2030-01-02, unchanged) |
| `[]` | 422 | `{"error":"Invalid due date."}` | 1893585600 (unchanged) |
| `0` | 422 | `{"error":"Invalid due date."}` | 1893585600 (unchanged) |
| `{}` | 422 | `{"error":"Invalid due date."}` | 1893585600 (unchanged) |
| `1789804800` (number) | 422 | `{"error":"Invalid due date."}` | 1893585600 (unchanged) |
| `""` | 200 | `{"id":"WO-1151","ok":true}` | NULL (cleared) |
| `"   "` (whitespace only) | 200 | `{"id":"WO-1151","ok":true}` | NULL (cleared) |
| `"2027-03-15"` (valid ISO) | 200 | `{"id":"WO-1151","ok":true}` | 1805112000 = 2027-03-15T12:00:00Z |
| `null` | 200 | `{"id":"WO-1151","ok":true}` | NULL (cleared) |
| `"2026-02-30"` (calendar overflow) | 422 | `{"error":"Invalid due date."}` | 1893585600 (unchanged) |
| `"2026-13-01"` (bad month) | 422 | `{"error":"Invalid due date."}` | 1893585600 (unchanged) |
| omitted (`{"action":"due"}`) | 422 | `{"error":"Invalid due date."}` | 1893585600 (unchanged) |
| `"not-a-date"` | 422 | `{"error":"Invalid due date."}` | 1893585600 (unchanged) |
| `["2027-03-15"]` (array wrapping a valid date) | 422 | `{"error":"Invalid due date."}` | 1893585600 (unchanged) |

All 14 match the claim exactly. **No 1970 date can be produced through this path
any more.**

### 3.2 Pre-fix control, subject WO-1152, same 14 values

| `due_date` payload | status | stored `due_at` after |
|---|---|---|
| `true` | **200** | **1 = 1970-01-01T00:00:01Z** |
| `[]` | **200** | **0 = 1970-01-01T00:00:00Z** |
| `0` | **200** | **0 = 1970-01-01T00:00:00Z** |
| `{}` | 422 | unchanged (`String({})` is not finite, so `asInt` already returned null) |
| `1789804800` (number) | 200 | 1789804800 = 2026-09-19T08:00:00Z |
| `""`, `"   "`, `null` | 200 | NULL (cleared) |
| `"2027-03-15"` | 200 | 1805112000 |
| `"2026-02-30"`, `"2026-13-01"`, omitted, `"not-a-date"`, `["2027-03-15"]` | 422 | unchanged |

The defect reported as W6 in the PR #24 deep verify reproduces exactly:
`true` and `[]` were accepted with a 200 and stored a 1970 date. The fix removes
that. **CONFIRMED with a control.**

### 3.3 Behavior change worth naming

Removing the `asInt` branch also removes the previously working
**numeric epoch** path: `due_date: 1789804800` used to be accepted and is now a
422. That is a deliberate narrowing of the API contract, is stated in the code
comment and the ledger entry, and is safe given section 4. It is recorded here so
nobody later reads it as an accident.

## 4. Claim: no other caller sends `due_date`

`grep -rn due_date src/` returns, outside tests and the parser itself:

- `src/components/work-order-controls.tsx:145`
  `patch("due", { action: "due", due_date: e.target.value || null })` (an
  `<input type="date">`, so a `YYYY-MM-DD` string or `null`);
- `src/components/work-order-controls.tsx:153`
  `patch("due", { action: "due", due_date: null })` (the Clear button);
- `src/app/app/work-orders/new/page.tsx:151` an
  `<input id="due_date" name="due_date" type="date">`, which is a form POST to
  `/api/work-orders`, not a PATCH, and always yields a string;
- `src/app/api/work-orders/route.ts:85` the POST route's own read.

There is no caller anywhere that sends a number, a boolean, an array or an
object. Removing the numeric path loses no legitimate use case. **CONFIRMED.**

## 5. POST `/api/work-orders` behavior, out of scope but stated accurately

The builder's ledger says: POST rejects `true`, but silently treats `[]` as
"clear the date". Both halves were tested against the built image. POST does
`String(raw.due_date ?? "").trim()` and then `isValidIsoDate`, so everything
depends on what `String()` produces.

| POST `due_date` | status | stored `due_at` |
|---|---|---|
| `true` | 422 | no row created (`String(true)` is `"true"`, fails isValidIsoDate) |
| `[]` | **200** | **NULL, the date is silently cleared** (`String([])` is `""`, which trims to empty and means "no due date") |
| `{}` | 422 | no row created (`"[object Object]"`) |
| `0` | 422 | no row created (`"0"`) |
| `1789804800` | 422 | no row created |
| `"2027-03-15"` | 200 | 1805112000 |
| `"   "` | 200 | NULL (cleared, by design since W5) |
| `null` | 200 | NULL |
| omitted entirely | 200 | NULL |

**The builder's statement is accurate in both halves. CONFIRMED.**

The residual inconsistency: after this PR, `PATCH` returns 422 for `[]` while
`POST` accepts it as a clear. That is a smaller gap than the one this PR closes
(PATCH used to store a 1970 date for the same value), and neither path persists
visitor text, so it is a warning rather than a blocker. See W2.

## 6. Regression

### 6.1 Work-order closed loop

On the fixed image, subject WO-1158:

| Action | Status |
|---|---|
| POST create | 200 |
| PATCH assign TCH-01 | 200 |
| PATCH due 2027-06-01 | 200 |
| PATCH status in_progress | 200 |
| PATCH add_part PRT-0001 qty 2 | 200 |
| PATCH remove_part PRT-0001 | 200 |
| PATCH status closed | 200 |
| Detail page | 200, renders "Marcus Webb", "closed", the 2027 due date |
| Stored `due_at` | 1811851200 = 2027-06-01T12:00:00Z |

Six navigation pages (`/app`, assets, work-orders, schedule, reports, parts) all
200.

### 6.2 PR #24 no-persist marker sweep

A unique marker was posted through every visitor-controlled field that PR #24
covers: POST JSON `title`, `description` and `assigned_to`; a second POST with a
different type; PATCH `assign` with a marker technician id; PATCH `due` with a
marker date string.

- Raw database scan of every column of every table:
  `TOTAL_HITS 0`.
- Served page source: `/app/work-orders` 0 hits, the same URL with `RSC: 1`
  0 hits, `/app/work-orders/WO-1001` 0 hits.

PR #24's guarantee still holds. **CONFIRMED.**

## 7. Theater Check

| Builder claimed | Verification found | Verdict |
|---|---|---|
| `parseWorkOrderPatch`'s `due` case no longer falls through to `Number()` | The `asInt` call is gone from the `due` case; `typeof !== "string"` returns the error directly | CONFIRMED |
| PATCH `due_date` with `true`, `[]`, `0` or `{}` gets 422 instead of storing a 1970 date | 4 of 4 return 422 on the fix, and the DB row is unchanged each time. On the pre-fix control the same inputs returned 200 and stored `due_at` 1, 0, 0 | CONFIRMED with a before/after control |
| Only the date picker sends `due_date`, always a string or null | grep of `src/` finds exactly two PATCH senders, both in `work-order-controls.tsx`, both string-or-null; the only other `due_date` is the POST form's `<input type="date">` | CONFIRMED |
| POST rejects `true` | 422, no row created | CONFIRMED |
| POST silently treats `[]` as "clear the date" rather than rejecting it | 200, row created with `due_at` NULL | CONFIRMED (the builder reported this against their own PR's interest, accurately) |
| Valid ISO, `""`, `"   "` and `null` are unaffected | 200 each, storing 1805112000, NULL, NULL, NULL | CONFIRMED |
| Overflow and bad-month dates still 422 | `2026-02-30` and `2026-13-01` both 422 | CONFIRMED |
| Full suite passes, tsc clean, lint clean, build clean | 106 of 106 on Linux, tsc 0, eslint 0 errors, build clean | CONFIRMED |
| Ledger: "104 passed, 2 skipped POSIX-only" | That is the Windows figure. On Linux the same suite is 106 of 106 with the 2 POSIX cases running. Consistent, not contradictory | CONFIRMED |

## 8. Blockers

None.

## 9. Warnings (non-blocking)

### W1. Pre-existing: malformed JSON to POST `/api/work-orders` returns 500
`PATCH /api/work-orders/[id]` wraps `await request.json()` in try/catch and
returns 400 on a bad body. `POST /api/work-orders` (route.ts:30) does not, so a
malformed body throws `SyntaxError` and Next returns 500 with a stack in the
container log. **Controlled:** the pre-fix image behaves identically (500 on
POST, 400 on PATCH), so this is on `main` and this PR did not introduce it.
**Fix:** mirror the PATCH route's try/catch and return 400. **Tier:** Sonnet
executor.

### W2. Residual POST/PATCH asymmetry for `due_date: []`
After this PR, `PATCH` 422s an array and `POST` treats `[]` as a clear. Both are
safe (neither persists text, neither can produce a 1970 date any more) but the
two routes still disagree about the same input. This is strictly better than the
state before this PR and is not a merge blocker. **Fix, if anyone wants full
parity:** have POST reject a `due_date` that is not `undefined`, `null` or a
string, instead of `String()`-coercing it. **Tier:** Sonnet executor.

### W3. Numeric epoch `due_date` is no longer accepted by PATCH
A deliberate contract narrowing (section 3.3). No caller uses it. Documented in
the code comment, D-012's history and the ledger entry. Recorded so it is not
later mistaken for a regression. **No action.**

### W4. Pre-existing: recharts SSR warnings in the container log
Repeated `The width(-1) and height(-1) of chart should be greater than 0` lines.
Unrelated to this PR and present on the pre-fix build too. **Tier:** Sonnet
executor, not this PR.

### W5. CI runs no unit tests
`.github/workflows/verify.yml` runs the offline gate test and the quick smoke
only. The new `W6:` test case, and the 2 POSIX-only `db.test.ts` cases, are never
exercised by CI. This was already raised as W7 in the PR #24 report and is still
open. **Fix:** add a `vitest run` step on ubuntu. **Tier:** Sonnet executor,
with a workflow change Drew should see.

## 10. Coverage gaps (stated so the verdict is not overclaimed)

- **Layer 5 (headed Chrome) was not run**, by dispatch rule. The date picker was
  verified at the API and code level, not by clicking it in a real browser.
- No headless browser layer either this round. The UI path that actually sends
  `due_date` (`work-order-controls.tsx`) was read and its payload shape confirmed
  by grep, but it was not driven through a browser. Since the component can only
  emit a string or `null`, the fix cannot break it, and the API-level matrix
  covers everything the component can send.
- No axe, no visual regression, no cross-browser.
- Latency was measured on local Docker Desktop, not the deployed host.
- The pre-fix control is PR #27's image rather than a build of `origin/main`
  exactly. Its `wo-actions.ts` is byte-identical to the merge-base version
  (PR #27 touches only the Dockerfile and two docs files), so it is a faithful
  control for this specific behavior.
- No load or race testing of the due-date path this round. PR #24's report
  covered the reset/race surface and nothing in this diff touches it.

## 11. Run artifacts

Scratch evidence (local, not committed), under
`...\scratchpad\verify-runs\`:
- `C-build.log`, `C-buildstage.log`, `C-tests.log`;
- the PATCH matrix driver and the DB readers were throwaway scripts
  (`matrix.sh`, `due.js`, `sweep.js`), deleted after the run; their results are
  transcribed above in full.

Cleanup: `dvn29-app`, `dvn27-app` and every image created for this run were
removed at the end. The live `demo-axlepoint` container was never touched.
