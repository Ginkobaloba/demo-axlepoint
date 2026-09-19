# Deep Verify: PR #32 verify the portal session cookie instead of checking presence (2026-09-19)

Overall: PASS
Tested-SHA: a02d3496e4331b78190fb1e95c7cab22e179f92e

Target: `Ginkobaloba/demo-axlepoint` PR #32, branch `fix/real-portal-session`,
head `a02d3496e4331b78190fb1e95c7cab22e179f92e`, label `tier-3`.
Mode: deep, layers 1, 2, 3 (local origin only), 4 (curl and raw response
headers), 6 (edge sweep). Layer 5 (headed real Chrome) was unavailable by
instruction for this run, so nothing in this report rests on it.
Base at the time of the run: `origin/main` moved twice mid-run, from
`d1602d7f8eaf31df9ac5b09965c19ab4aaa715fa` to
`afa12bac3389824a53e11a2950912031266cf2b0` (PR #33 then PR #30 merged at
23:02 UTC). See section 8; that is the one thing standing between this PR
and a merge.

Evidence root:
`C:\Users\Drama\AppData\Local\Temp\claude\C--dev\c411ea0d-b7a5-4294-9c55-34d74f91e960\scratchpad\verify-runs\pr32-deep\`
(build logs, generated hostile tokens, matrix and regression scripts).

Images and containers, all built from the fetched commit, all removed after
the run:

- `demo-axlepoint:dv32` built from `git archive a02d3496`, not from a working
  tree, so the image provably is the tested commit.
- `demo-axlepoint:dv32m` built from a throwaway local merge of `a02d3496`
  into `afa12ba` (section 8).
- `dva32-a` 18981 (secret alpha), `dva32-b` 18982 (secret bravo),
  `dva32-nosecret` 18983, `dva32-empty` 18984, `dva32-short` 18985 (31
  chars), `dva32-placeholder` 18986 (the `.env.example` placeholder),
  `dva32-merged` 18987 (dv32m). Nothing else was touched: the live
  `demo-axlepoint` container on 8102, `demo-proxy`, the public URL and
  `cloudflare-config` were all left alone.

## Pass/fail per category

| Category | Verdict | Evidence |
|---|---|---|
| smoke | PASS | All 7 containers answered `GET /` with 200. `/app` anonymous returns 307 to `/?signin=required` |
| navigation | PASS | With a valid portal cookie, `/app`, `/app/assets`, `/app/reports`, `/app/work-orders` all 200 |
| auth_lifecycle | PASS | See section 2: 11 hostile portal cookie values rejected and cleared on `/app` and on a deep subpath; valid hand-signed and `mintPortalSession` values accepted; fail-closed on 4 bad secret configs |
| data_crud | PASS | Closed loop 7 of 7 200 on `WO-1001` (assign, due, status, add_part, remove_part, close, clear assignee) |
| visual_regression | SKIPPED | Needs layer 5, unavailable by instruction. This PR renders no new UI |
| performance | SKIPPED | Not a surface this PR touches. Middleware bundle size is reported under `edge_cases` instead |
| accessibility | SKIPPED | Needs layer 5, unavailable by instruction. No markup changed in this PR |
| security_headers | PASS (with note) | Container responses carry no `Strict-Transport-Security`; that header is added at the Cloudflare and nginx edge, not by the app, and is unchanged by this PR. The headers this PR does own, the `Set-Cookie` clear, are checked byte for byte in section 2 |
| mobile_responsive | SKIPPED | Needs layer 5, unavailable by instruction. No layout change |
| error_handling | PASS | `#29` due-date matrix: 10 invalid payload shapes all 422 with `{"error":"Invalid due date."}`, valid control 200 |
| cross_browser | SKIPPED | Needs layer 5, unavailable by instruction |
| edge_cases | PASS | 17 token variants times 2 paths against a real production image, plus 4 secret configurations, plus the D-006 boundary and the combined-cookie case |

## 1. Surface enumeration, done independently: CONFIRMED

Enumerated from the fetched refs rather than from the PR body.
`git grep` over `a02d3496` for `PORTAL_SESSION_COOKIE`, `readPortalSession`,
`mintPortalSession`, `axle_portal_session`, plus a sweep for every cookie
read in `src/` (`request.cookies`, `.cookies.get`, `cookies()`,
`document.cookie`):

- `src/middleware.ts` is the only place that reads the portal cookie in
  order to decide access, and after this PR it validates it.
- `src/lib/portal-handoff-handler.ts:85` writes the cookie (mint path), it
  never reads an existing one.
- `src/app/api/session/route.ts` touches `axle_demo_session` only.
- `src/components/paradigm-banner.tsx` reads a client-side banner cookie,
  unrelated.
- Everything else is test files.

No route under `src/app/api/**` reads the portal cookie without validating
it. The claim holds.

One framing caveat the PR body does not spell out, recorded so nobody reads
this line as stronger than it is: the middleware matcher is `/app/:path*`
only, and every data API is anonymous by design (D-012). Verified live:
`GET /api/work-orders/WO-1001` returns 405 (the route is PATCH only) and
`PATCH` succeeds with no cookie at all. So "the middleware is the entire
session-required surface" is true, but partly because nothing else requires
a session in the first place. A forged portal cookie never bought API access
that an anonymous request did not already have. That is a pre-existing
design decision, not a regression from this PR.

## 2. Hostile matrix against a real production image

`demo-axlepoint:dv32`, container `dva32-a`, secret set at runtime. Every
request is a single `curl -D -` with a hand-built `cookie:` header, no
redirect following. Run against `/app` and against the subpath
`/app/work-orders/WO-1001`; results identical, so one table is shown.

| Case | Status | Location | Portal cookie cleared |
|---|---|---|---|
| valid control (hand-signed, right secret) | 200 | -- | no (correct, nothing to clear) |
| old opaque value `any-value-opens-the-app` | 307 | `/?signin=required` | yes |
| empty value | 307 | `/?signin=required` | yes |
| unsigned (`header.payload.`) | 307 | `/?signin=required` | yes |
| signature stripped (two segments) | 307 | `/?signin=required` | yes |
| forged with another secret | 307 | `/?signin=required` | yes |
| tampered payload, original signature | 307 | `/?signin=required` | yes |
| expired | 307 | `/?signin=required` | yes |
| alg none | 307 | `/?signin=required` | yes |
| HS512 signed with the right secret | 307 | `/?signin=required` | yes |
| missing `sub` | 307 | `/?signin=required` | yes |
| missing `exp` | 200 | -- | no (see W2) |
| missing `exp` and `iat` | 200 | -- | no (see W2) |
| `exp` in 2099 | 200 | -- | no (see W2) |
| valid token signed with the other container's secret | 307 | `/?signin=required` | yes |
| valid token signed with a 31-char secret | 307 | `/?signin=required` | yes |
| valid token signed with the `.env.example` placeholder | 307 | `/?signin=required` | yes |

The old opaque value is the one that proves the gap was real: it is exactly
what opened `/app` before this commit, and it now bounces.

`Set-Cookie` attributes on every rejection, verbatim:

```
set-cookie: axle_portal_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
```

`Path=/` matches the mint path in `portal-handoff-handler.ts`, and the mint
sets no `Domain`, so name plus path plus domain match and a browser really
does drop the cookie. The clear carries no `HttpOnly`, `SameSite` or
`Secure`, unlike the mint. That is cosmetically inconsistent but not a
defect: deletion is keyed on name, domain and path, and the expiry is in the
past. Recorded as W5.

The three accepted cases (missing `exp`, missing `exp` and `iat`, `exp` in
2099) are the gap this PR explicitly says it does not close and PR #30 does.
They all require the real signing secret, so they are a token-lifetime
problem, not an unauthenticated bypass. Confirmed closed in the combined
tree in section 8.

## 3. The D-006 boundary

Intended behavior, confirmed unchanged:

- `axle_demo_session` set to `demo-user`, `literally-anything`, `%20` and
  `0` each returned 200 on `/app`. Presence only, by design.
- Anonymous, no cookie at all: 307 to `/?signin=required`.

The combined case, which the unit tests cannot fully prove because they read
`Set-Cookie` off the returned object rather than off the wire. Against the
real image, a tampered portal cookie plus a valid demo cookie:

```
HTTP/1.1 200 OK
set-cookie: axle_portal_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
```

The pass-through is a real 200, and the clear header really does reach the
client through Next's `x-middleware-set-cookie` merge. This is the single
most valuable runtime check in the run and it holds.

## 4. Fail closed

Same image, different runtime secrets, each probed with an otherwise
well-formed token:

| Secret configuration | Token | Result |
|---|---|---|
| env var unset | signed with alpha | 307, cookie cleared |
| env var set to empty | signed with alpha | 307, cookie cleared |
| 31 characters | signed with that same 31-char secret | 307, cookie cleared |
| 31 characters | signed with alpha | 307, cookie cleared |
| `.env.example` placeholder (46 chars) | signed with alpha | 307, cookie cleared |
| `.env.example` placeholder (46 chars) | signed with the placeholder | 200, ACCEPTED |

The first five confirm the claim: no new code was needed, `getSecret()`
throws and `readPortalSession`'s `catch` turns it into a verification
failure. The sixth is the config-hygiene warning W1 below. It is not a
defect in this PR, and it is not in scope for it, but it is worth saying
plainly: the committed placeholder is 46 characters, so it satisfies the
32-character floor, and a deployment that ships `.env.example` verbatim gets
a signing secret that is published in the repo.

## 5. Mutation check, reproduced

Restored `src/middleware.ts` to the pristine presence-only version from
`origin/main` with `git checkout origin/main -- src/middleware.ts`, then ran
`npx vitest run src/middleware.test.ts`:

```
Tests  4 failed | 6 passed (10)
```

The 4 that went red, by name:

1. `rejects every hostile portal cookie value, redirects, and clears the cookie`
2. `with a bad portal cookie AND a valid demo cookie, still passes (demo path) but clears the bad portal cookie`
3. `fails closed when AXLE_PORTAL_SESSION_SECRET is missing, even for a well-formed token`
4. `fails closed when AXLE_PORTAL_SESSION_SECRET is under 32 characters, even for a token signed with that short secret`

Exactly the 4 of 10 the PR body claims, and exactly the ones that should be
sensitive to the change. Restored with
`git checkout a02d3496 -- src/middleware.ts`; `Compare-Object` against a
pristine copy taken before the mutation reported 0 differences;
`git status --short` and `git diff --stat` both empty; `HEAD` still
`a02d3496`.

Full suite on the branch before and after the mutation exercise:
12 files, 111 passed, 2 skipped. `npx tsc --noEmit` exit 0.
`npx eslint .` exit 0 with 7 pre-existing warnings, all in files this PR does
not touch (`src/lib/db.ts` unused disable directives, a chart component's
`react-hooks/set-state-in-effect`).

## 6. Edge bundle and runtime secret read

`docker build` of `demo-axlepoint:dv32` from the archived commit: exit 0. The
build log contains no `Edge Runtime`, no `CompressionStream` and no
`not supported` line anywhere. Next reported:

```
ƒ Middleware                               40 kB
```

The subpath import claim holds: the JWE path is not in the Edge bundle and
the analyzer raises nothing.

Runtime, not build-time, secret read, proven with one image and two
containers:

| Container | Secret | Token signed with alpha | Token signed with bravo |
|---|---|---|---|
| `dva32-a` 18981 | alpha | 200 | 307, cleared |
| `dva32-b` 18982 | bravo | 307, cleared | 200 |

Same image id both times. The secret is read per request at runtime, not
baked at build.

## 7. Regression sweep

- `#29` due-date validation, `PATCH /api/work-orders/WO-1001`: `true`, `[]`,
  `0`, `{}`, a numeric epoch, `2026-02-30`, `2026-13-01`, an omitted
  `due_date`, `not-a-date` and `["2027-03-15"]` all returned 422
  `{"error":"Invalid due date."}`. Valid `2030-01-02` returned 200. Holds.
- `#24` no-persist marker sweep (compact form, 4 POST shapes carrying a
  unique marker in title, description, `assigned_to` and `asset_id`):
  marker title and marker description creates returned 200 with the title
  derived (`Corrective - Engine 01`, marker discarded); marker
  `assigned_to` returned 422 `Unknown technician.`; marker `asset_id`
  returned 400. Reading the container's own SQLite afterwards:
  `marker rows in work_orders: 0`. Marker hits across `/app`,
  `/app/work-orders`, `/app/assets`, `/app/schedule`, `/app/reports`,
  `/app/team`, `/app/parts` and both created detail pages: 0. Holds.
- Closed loop: assign, due, in_progress, add_part, remove_part, closed,
  clear assignee, 7 of 7 200. Holds.

## 8. Sequencing with PR #30: the situation changed during this run

PR #30 (`fix/customer-session-claims`) is no longer open. It merged as
`afa12bac3389824a53e11a2950912031266cf2b0` at 2026-09-19 23:02:35 UTC,
partway through this verification, together with PR #33 (ledger check in
CI). `origin/main` is now `afa12ba`, and PR #32's base is stale.

GitHub agrees: `gh pr view 32 --json mergeable,mergeStateStatus` now returns
`CONFLICTING` and `DIRTY`, where it returned `MERGEABLE` at the start of this
run.

Throwaway local merge, in a detached worktree, never pushed, removed
afterwards: `git merge --no-ff a02d3496` onto `afa12ba`.

- `src/lib/portal-session.ts` auto-merged with no conflict. The merged file
  carries both changes: this PR's `jose/jwt/sign` and `jose/jwt/verify`
  subpath imports, and #30's `requiredClaims: ["sub", "iat", "exp"]` plus
  `maxTokenAge: SESSION_TTL_SECONDS`. The PR body's prediction about
  non-overlapping hunks was correct.
- The one conflict is `docs/demos/axlepoint/decisions.md`, a single hunk
  where both branches appended a decision entry at the same place. Content
  conflict only, trivially resolved by keeping both entries.
- With the doc conflict resolved and nothing else changed, the combined tree
  passes: 13 files, 128 passed, 2 skipped, 0 failed.
- Built `demo-axlepoint:dv32m` from that combined tree (exit 0, middleware
  40.1 kB, no Edge warnings) and reran the full hostile matrix against it on
  port 18987. All 14 hostile cases now redirect and clear, including missing
  `exp`, missing `exp` and `iat`, and `exp` in 2099, which this PR alone
  accepts. The valid control still passes, so #30's hardening does not lock
  out real portal users when combined with this PR's middleware call.

So the two changes are complementary and the combined end state is the one
worth having. The cost is only mechanical: #32 needs a rebase onto `afa12ba`
with a one-hunk docs resolution.

## Theater Check

| Agent claimed | Verification found | Verdict |
|---|---|---|
| Before: `/app` gated on `cookies.has()`, presence only, any value opened it | `git show origin/main:src/middleware.ts` is exactly that, and the opaque string `any-value-opens-the-app` is in the tested matrix | CONFIRMED |
| Before: `readPortalSession` had no caller anywhere | Independent grep of `a02d3496`'s parent tree: only tests referenced it | CONFIRMED |
| Now: middleware calls `readPortalSession`; missing, invalid or forged is treated as no session and the bad cookie is cleared | 11 hostile values, 2 paths, real image: 307 plus `axle_portal_session=; Path=/; Expires=1970` every time | CONFIRMED |
| Cleared even when the demo cookie separately grants access | 200 pass-through plus the clear header on the wire | CONFIRMED |
| `portal-session.ts` moved to jose subpath imports so the Edge bundle excludes JWE | Production build log has no Edge Runtime or CompressionStream warning; middleware 40 kB | CONFIRMED |
| Fail closed needs no new code | Unset, empty and 31-char secrets all reject a well-formed token, no new code in the diff | CONFIRMED |
| Demo cookie deliberately still presence-only per D-006 | 4 arbitrary demo values all returned 200 | CONFIRMED as intended, not a defect |
| The middleware is the entire session-required surface | Independent enumeration agrees, with the caveat in section 1 that the APIs require no session at all | CONFIRMED, with framing note |
| Full suite 111 passed, 2 skipped | Measured 12 files, 111 passed, 2 skipped | CONFIRMED |
| Mutation: 4 of 10 go red on main's middleware | Measured 4 failed, 6 passed, same 4 test names | CONFIRMED |
| No Edge-runtime warning, middleware 40.1 kB | Measured 40 kB on the dv32 build, 40.1 kB on the dv32m build | CONFIRMED |
| Clean 3-way merge with #30 either order | Code file auto-merged; `decisions.md` conflicts. Close but not exact: the merge is not conflict free | PARTLY CONFIRMED |
| `POST /api/session?signout=1` only deletes the demo cookie | Reproduced: single `set-cookie: axle_demo_session=; ... 1970`, and `/app` still opened with the surviving portal cookie afterwards | CONFIRMED, and it is a real gap |

No theater found. Every substantive claim in the PR body reproduced. The only
correction is the merge-conflict-free prediction, which the author hedged
anyway.

## Blockers

- **B1. PR #32 cannot merge as it stands.** `origin/main` moved to `afa12ba`
  (PR #30 and PR #33) during this run and GitHub now reports the PR
  `CONFLICTING` / `DIRTY`. The conflict is one hunk in
  `docs/demos/axlepoint/decisions.md`, no code conflict. This is a
  sequencing consequence, not a defect in the change.
- **B2. The rebase invalidates this report, by design.** `verify/ci/deep_gate.sh`
  requires the `Tested-SHA` to be the PR head or an ancestor of it, with
  nothing but `verify/reports/` changed since. A rebase rewrites
  `a02d3496`, so the gate will correctly refuse this report and a fresh deep
  verify is required on the rebased head before merge. The good news is that
  the combined behavior was already exercised here: section 8 built and
  probed the merged tree, and it passes.

## Warnings

- **W1. The committed `.env.example` placeholder is a usable secret.**
  `AXLE_PORTAL_SESSION_SECRET=replace-with-a-real-32-plus-char-random-secret`
  is 46 characters, so `getSecret()` accepts it, and a container running it
  accepted a token signed with it (section 4). A deploy that copies the
  example verbatim is forgeable by anyone who can read the repo. Pre-existing,
  not this PR's doing. Worth its own ticket: either shorten the placeholder
  below 32 characters so it fails closed, or reject the exact placeholder
  string explicitly.
- **W2. Token lifetime is not bounded by this PR alone.** A validly signed
  token with no `exp`, or with `exp` in 2099, still opens `/app` on this
  branch. It requires the real secret, so it is not an unauthenticated
  bypass. Closed by #30, which is now in `main`, and confirmed closed in the
  combined image.
- **W3. Nothing but `/app/*` is gated.** Matcher is `/app/:path*` and the
  data APIs are anonymous by D-012. That is why the middleware really is the
  whole session-required surface.
- **W4. Signout leaves a portal session alive.** See the adjacent finding
  below.
- **W5. The clearing `Set-Cookie` carries no `HttpOnly`, `SameSite` or
  `Secure`**, unlike the mint. Deletion still works because name, domain and
  path match and the expiry is in the past. Cosmetic.
- **W6. 7 pre-existing lint warnings** in files this PR does not touch. Not a
  regression.

## Adjacent finding, recorded not fixed

`POST /api/session?signout=1` with both cookies set returns
`303` to `/` and emits exactly one header:

```
set-cookie: axle_demo_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
```

The portal cookie survives, and an immediate `GET /app` carrying only that
surviving portal cookie returns 200. A portal-launched user who clicks "Sign
out" stays signed in. The builder flagged this and correctly scoped it out of
this PR. It deserves its own ticket.

## Cleanup

All seven `dva32-*` containers removed, both `demo-axlepoint:dv32` and
`demo-axlepoint:dv32m` images removed, the throwaway merge worktree removed,
scratch `node_modules` junctions removed. The live `demo-axlepoint` container
on 8102, `demo-proxy`, the public URL and `cloudflare-config` were never
touched. Working tree of `C:\dev\demo-axlepoint-wt-sess` clean apart from
this report.
