# Deep Verify: PR #30 require exp, iat, and sub on the customer session token (2026-09-19)

Overall: PASS
Tested-SHA: 311276e5ba803d41f2d250ac1a3f98a2067063d7

Independent deep verify of `Ginkobaloba/demo-axlepoint` PR #30 (branch
`fix/customer-session-claims`, label `tier-3`). The verifier did not write the
PR and attacked it rather than reading it.

Everything below was run against the FETCHED ref. `git fetch origin --prune`
ran first, the worktree `C:\dev\demo-axlepoint-wt-csc` was confirmed at
`311276e5` with an empty `git status --porcelain`, and
`origin/fix/customer-session-claims` resolves to the same `311276e5`. No
local-only state fed any finding.

**Result: PASS.** Every claim in the PR reproduced under independent
re-signing, both reported mutation numbers reproduced exactly, and the
caller-enumeration caveat was confirmed both statically and at runtime
against a purpose-built container.

## Target and scope

| Item | Value |
|---|---|
| Repo | Ginkobaloba/demo-axlepoint |
| PR | #30, `fix/customer-session-claims` |
| Head tested | `311276e5ba803d41f2d250ac1a3f98a2067063d7` |
| Base | `origin/main` = `89e67bcda156d311e03deae525e7b5c28962fab3` |
| Tier | 3 (`tier-3` label present; `verify/tier_map.yml` present, and it does enumerate `portal-handoff` at tier 3) |
| Mode | DEEP REQUESTED, LAYER 5 UNAVAILABLE |

Layers 1, 2, 3, 4 and 6 ran. **Layer 5 (headed real-Chrome run) did not
run**: the dispatch prohibits headed Chrome. Per the skill's stop gate this
is stated rather than silently downgraded.

## Pass/fail per category

| Category | Verdict | Evidence |
|---|---|---|
| smoke | PASS | `demo-axlepoint:dv30` built and run as `dva30-app` on 127.0.0.1:18972; `GET /` returned 200; container logs show `Ready in 52ms` and no error lines |
| navigation | PASS | `/`, `/app`, `/app/work-orders`, `/app/work-orders/WO-1087` all served 200 |
| auth_lifecycle | PASS | 17 of 17 in `src/lib/portal-session.test.ts`, plus 36 of 36 independent probes; sign-in via `POST /api/session` returned 303 and set `axle_demo_session` |
| data_crud | PASS | PATCH due-date matrix, 13 cases, each followed by a read of `due_at` out of the container's SQLite |
| visual_regression | SKIPPED | No rendering change in the diff; only `src/lib/portal-session.ts`, a new test file and a decisions doc changed |
| performance | SKIPPED | No performance-relevant change |
| accessibility | SKIPPED | No markup change in the diff |
| security_headers | SKIPPED | No header change in the diff; `src/middleware.ts` is untouched by this PR |
| mobile_responsive | SKIPPED | No markup or CSS change in the diff |
| error_handling | PASS | Every malformed token returns `null` rather than throwing; 18 edge shapes refused with no uncaught exception; malformed PATCH bodies return 422, never 5xx |
| cross_browser | SKIPPED | No client-side code in the diff |
| edge_cases | PASS | 36 of 36 independent probes; see below |

### Layer 1 detail

| Check | Result |
|---|---|
| `npx vitest run` | 12 files, **121 passed, 2 skipped** (the 2 skips pre-exist in `src/lib/db.test.ts`, unrelated to this PR) |
| `npx vitest run src/lib/portal-session.test.ts` | **17 of 17 passed** |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint .` | exit 0, 7 warnings, **0 errors**. All 7 pre-exist in files this PR does not touch |
| `docker build` | exit 0, image `demo-axlepoint:dv30`, npmrc supplied as a BuildKit secret by path |

## Caller enumeration: CONFIRMED, independently

The builder states `readPortalSession` has no production caller and that
`src/middleware.ts` gates `/app` on `cookies.has()`, presence only. I
enumerated callers myself from the fetched refs with `git grep` against
`311276e5` and against `origin/main`, not a working tree.

Every importer of the module across the branch tree:

- `src/lib/portal-handoff-handler.ts` imports **only** `mintPortalSession`
  and `PORTAL_SESSION_COOKIE`. It is the mint side. It never calls
  `readPortalSession`.
- `src/app/api/auth/portal-handoff/route.test.ts` imports
  `readPortalSession`, but it is a test file that round-trips a minted
  cookie.
- `src/lib/portal-session.test.ts` is the PR's own test file.

That is the complete list. **`readPortalSession` has no production caller.**

`src/middleware.ts`, read from `311276e5`, confirms the second half:

```
export const PORTAL_SESSION_COOKIE = "axle_portal_session";
...
const hasPortal = request.cookies.has(PORTAL_SESSION_COOKIE);
```

Presence only. No signature check, no claim check, and note that the
middleware declares its **own duplicate string literal** rather than
importing the constant from `portal-session.ts`, so the two could drift.

**Verdict: the builder's caveat is CONFIRMED, not refuted.**

Runtime corroboration against the container, so this does not rest on grep:

```
no cookies at all                       -> HTTP 307 (redirect to /?signin=required)
forged axle_portal_session (not a JWT)  -> HTTP 200, bytes=69619
forged cookie on /app/work-orders       -> HTTP 200, bytes=219281
```

A cookie whose value is the literal string `totally-forged-not-even-a-jwt`
opens the whole `/app` surface. `readPortalSession` is never consulted.

**What that means for risk, stated plainly and without dramatizing it:**
the hardened function is bypassed at the edge today, so this PR closes no
live hole. It is also not a newly opened one. Two things keep the practical
severity low: the gap predates this PR and is disclosed by the builder in
the decisions entry, and `/app` is not a real security boundary in this demo
anyway, because `POST /api/session` hands out a session with no credentials
at all. Anyone who can forge a cookie could equally just click sign-in. The
honest framing is that the middleware is a demo convenience gate, not an
authorization boundary, and this PR neither improves nor worsens that. It
makes `readPortalSession` correct for whoever calls it next.

The related claim that requiring `jti`, `iss` or `aud` would reject every
real session is also CONFIRMED by reading `mintPortalSession` at `311276e5`:
it calls `setIssuedAt`, `setSubject` and `setExpirationTime` only.

## Attack 1: the 12 claimed cases, re-signed by the verifier

I wrote my own probe suite with my own `handSign` helper, my own payload
shapes and my own expectations, then ran it against the unmodified branch
code. Probe file `src/lib/zz-verify-probe.test.ts`, deleted after the run.

| # | Shape | Expected | Observed |
|---|---|---|---|
| 01 | missing `exp` | refuse | REJECTED |
| 02 | missing `iat` | refuse | REJECTED |
| 03 | missing `sub` | refuse | REJECTED |
| 04 | `exp` a century out | refuse | REJECTED |
| 05 | `iat` in the future | refuse | REJECTED |
| 06 | `iat` after `exp` | refuse | REJECTED |
| 07 | fractional `exp` | refuse | REJECTED |
| 08 | fractional `iat` | refuse | REJECTED |
| 09 | lifetime over TTL | refuse | REJECTED |
| 10 | positive control, all claims correct | accept | ACCEPTED, `sub=a@b.com` |
| 11 | boundary `exp - iat == TTL` | accept | ACCEPTED |
| 12 | boundary `exp - iat == TTL + 1` | refuse | REJECTED |

All 12 reproduce. **Total for the probe suite: 36 of 36 passed.**

## Attack 2: the shapes the builder says are UNTESTED

| Shape | How it was produced | Observed |
|---|---|---|
| `exp: NaN` | JS value through `SignJWT`; `JSON.stringify` emits `null` | REJECTED |
| `iat: NaN` | same | REJECTED |
| literal `NaN` token | raw bytes via `CompactSign`, `"exp":NaN` (invalid JSON) | REJECTED |
| `exp: Infinity` | JS value, serializes to `null` | REJECTED |
| `iat: -Infinity` | JS value, serializes to `null` | REJECTED |
| literal `Infinity` | raw bytes, `"exp":Infinity` | REJECTED |
| `exp` past MAX_SAFE_INTEGER | `exp: 9007199254740994` | REJECTED |
| `iat` past MAX_SAFE_INTEGER with `exp - iat == TTL` | `iat: 9007199254740994` | REJECTED |
| string-typed `exp` | raw bytes, `"exp":"1789858627"` | REJECTED |
| string-typed `iat` | raw bytes, `"iat":"1789858027"` | REJECTED |
| exponent notation, huge | raw bytes, `"exp":1e21` | REJECTED |
| exponent notation, fractional in range | raw bytes, `"exp":17898586.275e2` parsing to `1789858627.5` | REJECTED |
| negative `iat`, `exp - iat == TTL` | `iat: -1000` | REJECTED |
| negative `iat`, `exp` in the future | `iat: -1000` | REJECTED |
| numeric `sub` | raw bytes, `"sub":123` | REJECTED |
| explicit `null` `exp` | raw bytes, `"exp":null` | REJECTED |
| negative zero `exp` | raw bytes, `"exp":-0` | REJECTED |
| **empty-string `sub`** | `sub: ""` | **ACCEPTED** (see warnings) |

Discrimination control for the exponent-notation row, so that "REJECTED"
means fractionality and not the notation:

```
PROBE_RAW_JSON_FRAC={"sub":"a@b.com","iat":1789858027,"exp":17898586.275e2,...} parses_to=1789858627.5
PROBE_EDGE exp-exponent-fractional = REJECTED
PROBE_RAW_JSON_OK={"sub":"a@b.com","iat":1789858027,"exp":17898586.27e2,...} parses_to=1789858627
PROBE_EDGE exp-exponent-integer-inrange = ACCEPTED sub="a@b.com" role="customer"
```

Two probes came back ACCEPTED. Both are divergences from the harbor
implementation this file's own comment calls "the canonical pattern", and
both are recorded as warnings rather than blockers, for the reasons given
there:

```
PROBE_EDGE empty-sub    = ACCEPTED sub="" role="customer"
PROBE_EDGE unknown-role = ACCEPTED sub="a@b.com" role="superadmin"
```

## Attack 3: both mutation results, reproduced

Run by editing `src/lib/portal-session.ts` in the worktree, running the PR's
own test file, and restoring the file from the original bytes. `git status
--porcelain` was empty afterwards and is empty now.

| Mutation | Builder reported | I measured | Match |
|---|---|---|---|
| delete `requiredClaims` line | 0 of 17 red | **0 of 17 red** | CONFIRMED |
| delete the `exp - iat` block | 5 of 17 red | **5 of 17 red** | CONFIRMED |

The exp-iat mutation turned red exactly these five, which is the set the
decisions entry names:

```
x exp far in the future (100 years, iat now)
x fractional exp
x fractional iat (in the past, isolated from the future-iat rejection)
x lifetime over the TTL (iat now, exp one hour past the 8h TTL)
x boundary: exp - iat one second over the TTL is refused
```

`iat in the future` and `iat after exp` stayed green under that mutation,
correctly: jose's own `exp` and `maxTokenAge` checks catch them.

The extra mutation the builder did not report:

| Extra mutation | Result |
|---|---|
| delete `maxTokenAge` | **1 of 17 red**, exactly `iat in the future` |

Deleting `requiredClaims` also turned 0 of my 36 probes red. In this
codebase it is genuinely redundant with the `typeof` guard on `sub` and the
`typeof` / `Number.isInteger` guards on `exp` and `iat`. The decisions entry
states this plainly instead of overselling the line, which is to the
builder's credit.

Both numbers are identical to the harbor sibling PR, which is what you would
expect from two copies of the same pattern, and is itself a small
cross-check that neither repo's count is an artifact.

## Attack 4: the TTL constant is load-bearing, proven by moving it

Not a grep. `SESSION_TTL_SECONDS` was changed from `60 * 60 * 8` to `60` in
the worktree, and probes with **hardcoded** lifetimes (not derived from the
imported constant) were run before and after.

| Probe | Stock TTL (28800) | TTL mutated to 60 |
|---|---|---|
| `PROBE_TTL` | 28800 | 60 |
| hardcoded lifetime 28800 | ACCEPTED | **REJECTED** |
| hardcoded lifetime 28801 | REJECTED | REJECTED |
| hardcoded lifetime 60 | ACCEPTED | ACCEPTED |
| hardcoded lifetime 61 | ACCEPTED | **REJECTED** |

The enforced bound moved with the constant. The constant is genuinely
load-bearing, and the 8-hour value is confirmed at 28800 seconds. File
restored; `git status --porcelain` empty.

## Attack 5: regression

Both regression surfaces were exercised against the built container
`demo-axlepoint:dv30` running as `dva30-app` on 127.0.0.1:18972, with state
read back out of the container's own SQLite rather than inferred from the
HTTP status.

### #29 due-date validation: PASS, 13 of 13

First attempt sent `{"due_date": ...}` with no `action` key and got 422 for
every case including valid ones. That was my error, not a regression: the
route dispatches on `body.action`. Recorded here because a less careful run
would have filed a false blocker. Re-run with the correct contract:

| Body | HTTP | stored `due_at` |
|---|---|---|
| `{"action":"due","due_date":"2099-04-01"}` | 200 | 4078728000 |
| `{"action":"due","due_date":null}` | 200 | null |
| `{"action":"due","due_date":""}` | 200 | null |
| `{"action":"due","due_date":"   "}` | 200 | null |
| `{"action":"due","due_date":true}` | 422 | null |
| `{"action":"due","due_date":false}` | 422 | null |
| `{"action":"due","due_date":[]}` | 422 | null |
| `{"action":"due","due_date":{}}` | 422 | null |
| `{"action":"due","due_date":0}` | 422 | null |
| `{"action":"due","due_date":1767225600}` | 422 | null |
| `{"action":"due","due_date":"2026-02-30"}` | 422 | null |
| `{"action":"due","due_date":"tomorrow"}` | 422 | null |
| `{"action":"due"}` | 422 | null |

The #29 fix still holds: `true` and `[]` are 422 and leave the stored value
untouched, rather than the pre-fix behavior of a 200 writing a 1970 epoch.
The whitespace-clear consistency from W5 also still holds, and the calendar
overflow `2026-02-30` is still rejected.

### #24 no-persist marker sweep: PASS

A unique marker (`ZQMARKER766503`) was pushed through every mutating path:
`assign` with the marker as a technician, `assign` with a script-tagged
marker, `add_part` with the marker as a part id, `remove_part`, `status`
with the marker as a status, an unknown `action` value, and two
`POST /api/work-orders` creates carrying the marker in `asset_id`,
`summary` and `priority`.

```
PATCH codes: 422, 422, 422, 200, 422, 422
POST codes:  400, 400
marker occurrences in /app/data/axlepoint.db : 0
marker occurrences in WAL                    : 0 (no WAL file present)
/app/work-orders          200 clean
/app/work-orders/WO-1087  200 clean
/app                      200 clean
fresh visitor, no cookies, GET /            : home clean
container log 5xx / Error lines             : none
```

Zero markers reached the database, the WAL, any rendered page, or a fresh
visitor's view. The single 200 is `remove_part` for a part that was never
attached, an idempotent no-op that stores nothing, which the DB read
confirms. No 5xx anywhere.

## Attack 6: diff review

`git diff --name-status origin/main...311276e5`:

```
M	docs/demos/axlepoint/decisions.md
A	src/lib/portal-session.test.ts
M	src/lib/portal-session.ts
```

Three files, exactly the stated set. The test file is **new**: this repo had
no `portal-session.test.ts` on main, so the PR adds 17 tests where there were
none. No config, no CI, no route, no middleware, no lockfile. Two commits,
both conventionally named.

Dash sweep over the full diff, counted by code point rather than by eye:
**em-dash count 0, en-dash count 0.**

The decisions entry (D-014) was read line by line against the code. Every
factual claim in it is accurate, including both mutation numbers. It also
pre-discloses two things a less honest entry would have omitted: that
`readPortalSession` has no production caller, and that the `role` fallback
does not validate against the declared union. My probes confirmed both.

## Theater Check

| Agent claimed | Verification found | Verdict |
|---|---|---|
| Verifier passes `requiredClaims: ["sub","iat","exp"]` | Present at `src/lib/portal-session.ts:100`, read from the fetched ref | CONFIRMED |
| `maxTokenAge` comes from the repo's own exported TTL constant | `maxTokenAge: SESSION_TTL_SECONDS`, and the constant is now exported at line 21 | CONFIRMED |
| Axlepoint TTL is 8h | `PROBE_TTL=28800` = 60 * 60 * 8 | CONFIRMED |
| Explicit post-verify check that `exp - iat` is a positive integer no greater than TTL | Lines 104 to 114; behavior proven by the boundary probes and by moving the constant | CONFIRMED |
| Requiring `jti`/`iss`/`aud` would reject every real session | `mintPortalSession` sets issued-at, subject and expiry only | CONFIRMED |
| 12 hand-signed test cases | 12 cases present, all 12 reproduced under independent re-signing | CONFIRMED (see warning on duplication) |
| Deleting `requiredClaims` turns 0 of 17 red | Measured 0 of 17, and 0 of my 36 | CONFIRMED |
| Deleting the `exp - iat` block turns 5 of 17 red | Measured 5 of 17, and the exact five named | CONFIRMED |
| `readPortalSession` has no production caller | Enumerated from fetched refs: three importers, two are tests, the third imports only the mint helpers | CONFIRMED |
| `src/middleware.ts` gates `/app` on `cookies.has()`, presence only | Read from the fetched ref, and proven at runtime: a non-JWT cookie value opens `/app` with a 200 | CONFIRMED |
| The `role` fallback does not validate the union (builder's own disclosure) | Probe returned `role="superadmin"` for a hand-signed token | CONFIRMED |
| The named shapes are untested | True as stated. 17 of 18 are nevertheless refused; the empty-`sub` case is not | CONFIRMED with one exception, see warnings |

No theater found. Every claim the builder made was reproducible, including
the unflattering ones and the two pre-existing defects the builder disclosed
voluntarily.

## Blockers

None.

## Warnings

1. **Empty-string `sub` is accepted here and refused in harbor.** This is my
   one finding neither the PR nor its decisions entry mentions. Axlepoint
   checks `typeof payload.sub !== "string"`; harbor checks
   `typeof payload.sub !== "string" || payload.sub.length === 0`. A
   hand-signed token with `sub: ""` therefore yields a session object with an
   empty subject here:
   `PROBE_EDGE empty-sub = ACCEPTED sub="" role="customer"`.
   Not a blocker: it needs the signing secret, and nothing in production
   calls this function. It matters because this file's own comment names
   harbor as the canonical pattern, so the two should not diverge silently.
   One added clause fixes it.

2. **The `role` value is not validated against its declared union.** A
   hand-signed token with `role: "superadmin"` is returned as
   `role: "superadmin"` while typed as `"customer" | "staff" | "internal"`.
   That is a type lie at the module boundary. The builder disclosed this and
   scoped it out, which is the right call for this PR, but it should not be
   left indefinitely once something actually reads the session.

3. **The fix is inert today.** Zero production callers, and a forged cookie
   opens `/app` at the edge. Merging this closes no live hole. Do not record
   it as a production security fix.

4. **`src/middleware.ts` duplicates the cookie-name literal.** It declares
   its own `PORTAL_SESSION_COOKIE = "axle_portal_session"` instead of
   importing the exported constant from `portal-session.ts`. The two can
   drift, and if they do the gate silently stops matching the cookie the
   handoff sets. Pre-existing, out of scope, worth a one-line fix.

5. **Two of the twelve cases are the same token.** "positive control" and
   "boundary: exp - iat exactly equal to the TTL" build an identical payload
   (`iat: now, exp: now + TTL`) and assert the same outcome. 12 cases,
   **11 distinct shapes**.

6. **`requiredClaims` is decorative in this file.** 0 of 17 and 0 of 36 under
   deletion. Defensible as defense in depth; the decisions entry is honest
   about it.

7. **The `exp - iat <= 0` branch is unreachable in practice.** jose already
   rejects `exp <= now` and, with `maxTokenAge` set, rejects `iat > now`.
   Defense in depth, not a defect.

8. **CI is red on this PR and will stay red until this report reaches the PR
   branch.** `Deep Verify (tier-3 PRs only)` fails with `missing report for
   pr30`. `verify/ci/deep_gate.sh` reads reports from **the PR head's tree**.
   This report is committed to a separate branch as instructed, so the gate
   does not see it yet. Merging `verify/pr30-customer-session-claims` into
   `fix/customer-session-claims` will satisfy it: the Tested-SHA is the PR
   head, and the only file added is under `verify/reports/`.

## Evidence and cleanup

Commands ran from Windows PowerShell. No file under `C:\Users\Drama\.secrets`
and no `.env*` was opened. The npm credentials file was passed to
`docker build --secret id=npmrc,src=...` by path only, never read; the build
returned exit 0 with no 401. Throwaway secrets only
(`AXLE_PORTAL_SESSION_SECRET` was a 48-character local throwaway). No live
container, public URL, demo-proxy or cloudflare-config was touched. No headed
Chrome. The container was bound to 127.0.0.1 only.

Cleaned up: the probe file `src/lib/zz-verify-probe.test.ts` was deleted, the
container `dva30-app` was removed (`docker rm -f`), and the image
`demo-axlepoint:dv30` was untagged and deleted. No `dva30-*` or `dvh37-*`
container and no `dv30` image remains. Two dangling images exist on the host
but are dated 2026-06-27 and 2026-07-16, months before this run, so they were
left alone rather than pruned, which could disturb a sibling session. All
mutations were reverted from the original bytes. `git status --porcelain` in
the worktree is **empty**, and HEAD is still
`311276e5ba803d41f2d250ac1a3f98a2067063d7`.

No code was edited on the PR branch and nothing was merged.
