# Deep Verify DELTA: PR #32 verify the portal session cookie instead of checking presence, at the merged head (2026-09-19)

Overall: PASS
Tested-SHA: 197926a5b2e1ff1929bd594fd5f239067dc323e0

Target: `Ginkobaloba/demo-axlepoint` PR #32, branch `fix/real-portal-session`,
head `197926a5b2e1ff1929bd594fd5f239067dc323e0`, label `tier-3`.

This is a DELTA re-verify, not a fresh run. The baseline is the full deep
verify committed on this branch at
`verify/reports/DEEP_VERIFY_2026-09-19_pr32-real-portal-session.md`, which
PASSED at `a02d3496e4331b78190fb1e95c7cab22e179f92e`. PR #33 (ledger check in
CI) and PR #30 (claim bounds on the customer session token) then merged into
`main`, making #32 CONFLICTING. The branch owner resolved it by MERGING
`origin/main` (`afa12bac3389824a53e11a2950912031266cf2b0`) into the branch
rather than rebasing, so `a02d3496` remains an ancestor. Merge commit
`197926a`.

This report establishes whether the baseline PASS still holds at `197926a`,
and states explicitly what was re-run versus what was carried forward.

Evidence root:
`C:\Users\Drama\AppData\Local\Temp\claude\C--dev\c411ea0d-b7a5-4294-9c55-34d74f91e960\scratchpad\pr32delta\`
(archive tar, build log, generated hostile tokens, matrix script, pristine
middleware copy).

## Re-ran versus carried forward

| Check | Re-ran at `197926a`? | Why |
|---|---|---|
| Tree equivalence against the union of baseline + #30 + #33 | RE-RAN | New commit, the whole point of this delta |
| Hostile matrix against an image built from the pushed head | RE-RAN | `portal-session.ts` is a merged file; the prior 14-case merged-tree probe was a different (throwaway) merge |
| Mutation check, 4 of 10 red | RE-RAN | `readPortalSession` changed underneath `middleware.ts`; the interaction could move the count |
| Edge bundle / Edge-runtime warnings / middleware size | RE-RAN | Free from the build, and `portal-session.ts` is exactly the file that check is about |
| Fail-closed secret configurations | RE-RAN | Cheap (4 containers) and it re-settles W1 at this head rather than quoting it |
| Runtime (not build-time) secret read | RE-RAN | Two containers off one image, cheap |
| Surface enumeration (who reads the portal cookie) | RE-RAN | A 1-command `git grep` at `197926a` is cheaper than arguing that #30's new test file adds no reader |
| W3 (data APIs anonymous) and W4 (signout leaves portal session alive) | RE-RAN | Two curls each, and the brief asked for them to be confirmed unchanged |
| Full unit suite, `tsc --noEmit`, `eslint .` | RE-RAN | New tree |
| `#29` due-date regression matrix | CARRIED FORWARD | `src/app/api/work-orders/[id]/route.ts` blob `e959a358` and `src/lib/wo-actions.ts` are byte-identical at `197926a`, `d01301a` and `afa12ba` (section 1 table: neither side touched them). Nothing in the merge can reach that code path |
| `#24` no-persist marker sweep | CARRIED FORWARD | Same reason: `src/app/api/work-orders/route.ts`, `src/lib/queries.ts`, `src/lib/db.ts` and every page under `src/app/app/**` are byte-identical in all three trees, and `Dockerfile` blob `910fae85` is unchanged, so the seed/reset behavior is bit-for-bit the same image logic |
| Closed-loop data CRUD (7 of 7) | CARRIED FORWARD | Same unchanged route and query files. One anonymous `PATCH` was exercised anyway under W3 and returned `200 {"id":"WO-1001","ok":true}` |
| Layer 5 (headed real Chrome), visual/accessibility/mobile/cross-browser | NOT RUN, as in the baseline | Unavailable by instruction; this PR renders no new UI and changes no markup. Nothing in this report rests on it |

"It passed before" is not used as a reason anywhere above.

Every path named as a carry-forward reason was confirmed to exist at
`197926a` with `git ls-tree`, not assumed: `src/lib/wo-actions.ts`,
`src/lib/queries.ts`, `src/lib/db.ts`, `src/app/api/work-orders/route.ts`,
`src/app/api/work-orders/[id]/route.ts`, and the 13 page files under
`src/app/app/`. None of them appears in the section 1 table of differing
blobs, which is what makes them byte-identical across `197926a`, `d01301a`
and `afa12ba`.

## 1. Tree equivalence: the merge is the union, with one docs-only exception

Method: blob-hash comparison of every path in all three trees, `197926a` (H),
`d01301a` (P, the PR head before the merge) and
`afa12bac3389824a53e11a2950912031266cf2b0` (M, `origin/main`). 128 distinct
paths. 118 are byte-identical in all three. The 10 that are not:

| File | Verdict |
|---|---|
| `.github/workflows/verify.yml` | `== main` (only the #33 side changed it) |
| `docs/demos/axlepoint/decisions.md` | NOVEL IN MERGE (the manual resolution) |
| `docs/ledger/2026-09-19-1748-portal-session-cookie-is-verified-not-just-checked-for-prese.md` | `== PR head` |
| `src/lib/portal-session.test.ts` | `== main` (#30's tests) |
| `src/lib/portal-session.ts` | NOVEL IN MERGE (auto-merged) |
| `src/lib/test-helpers/portal-session-tokens.ts` | `== PR head` |
| `src/middleware.test.ts` | `== PR head` |
| `src/middleware.ts` | `== PR head` |
| `verify/reports/DEEP_VERIFY_2026-09-19_pr30-customer-session-claims.md` | `== main` |
| `verify/reports/DEEP_VERIFY_2026-09-19_pr32-real-portal-session.md` | `== PR head` |

**Exactly one CODE file is novel in the merge: `src/lib/portal-session.ts`.**
It is a pure 3-way auto-merge with zero manual edits, proven mechanically
rather than by reading:

```
git merge-file auto.ts base.ts theirs.ts     # auto.ts started as d01301a's version
merge-file exit: 0  (0 = clean auto-merge, no conflicts)
IDENTICAL: committed portal-session.ts == pure 3-way auto-merge (zero manual edits)
```

(base = `d1602d7f8eaf31df9ac5b09965c19ab4aaa715fa`, the merge base; theirs =
`afa12ba`.)

Cross-check by diff-of-diffs, same conclusion from the other direction. The
main-side change applied over the PR head, versus the same change applied over
the merge base, differ only in `index` blob lines, hunk offsets, and two
context lines (`import { SignJWT, jwtVerify } from "jose"` versus the branch's
two subpath imports, and `const SESSION_TTL_SECONDS` versus main's
`export const SESSION_TTL_SECONDS`). No added or removed content line differs.
Same for the PR-side change applied over main versus over the merge base.

The merged `portal-session.ts` carries both features, confirmed by reading it
at `197926a`:

- this branch's Edge-safe subpath imports, `jose/jwt/sign` and `jose/jwt/verify`
- #30's `requiredClaims: ["sub", "iat", "exp"]`, `maxTokenAge: SESSION_TTL_SECONDS`,
  and the explicit `exp - iat` integer bound of `(0, SESSION_TTL_SECONDS]`

**Did the merge introduce anything beyond the docs resolution?** One thing,
and it is cosmetic. See F1 below. Nothing else: no code file outside
`portal-session.ts` differs from one parent, no file was added or removed
beyond the two sides' own additions.

The `decisions.md` resolution itself is what the branch owner described: both
appended entries kept, plus a four-line reconciliation note under D-014
retracting its "readPortalSession has no production caller today" line, which
this branch falsifies. Content only, no code.

### Surface enumeration, redone at `197926a`

`git grep` at the merged head for `request.cookies`, `.cookies.get`,
`cookies()`, `document.cookie`, `PORTAL_SESSION_COOKIE`, `readPortalSession`
and `axle_portal_session` across `src/`, excluding tests and test helpers:

- `src/middleware.ts` is still the only place that reads the portal cookie to
  decide access, and it verifies it.
- `src/lib/portal-handoff-handler.ts:85` writes it (mint path), never reads one.
- `src/components/paradigm-banner.tsx` reads an unrelated client banner cookie.

#30 added `src/lib/portal-session.test.ts`, which is a test file and adds no
production reader. The baseline's enumeration claim holds unchanged at this head.

## 2. Hostile matrix against an image built from the PUSHED head

Provenance, so the image is not "a working tree that looked right":

```
git -c core.autocrlf=false archive --format=tar -o head197926a.tar 197926a5b2e1ff1929bd594fd5f239067dc323e0
archive exit: 0   (1116160 bytes)

src\middleware.ts              bytes=2725 CR=0
src\lib\portal-session.ts      bytes=5261 CR=0

archive src/middleware.ts        -> a10873cbc54842458f45c29d043780afaf7cc79c
git    197926a:src/middleware.ts -> a10873cbc54842458f45c29d043780afaf7cc79c
archive src/lib/portal-session.ts        -> efc73308022fbd2bb122bb5ee1d9afdf2a3c94ef
git    197926a:src/lib/portal-session.ts -> efc73308022fbd2bb122bb5ee1d9afdf2a3c94ef
```

`git archive` on this machine has been observed emitting CRLF before, so the
CR count and the blob-hash identity are checked rather than assumed. The tar
was piped straight into `docker build` (`docker build ... - < head197926a.tar`),
so the build context is the commit and nothing else: no working-tree state, no
`node_modules`, no `.next`. The repo's root `.npmrc` is tracked (blob
`24740478`, byte-identical in all three trees) and is therefore in the archive
exactly as committed, same as it would be for any other build of this commit;
it was not opened here. The private `@paradigm-codes/auth` dependency was
installed through `--secret id=npmrc,src=<scratchpad npmrc>`, mounted at
`/root/.npmrc` in the `deps` stage only; that file was passed by path and never
opened. Image `demo-axlepoint:dv32d`, build exit 0.

Clock sanity before probing, because #30's `maxTokenAge` has zero tolerance and
a lagging container clock would make a valid control look like a failure:

```
host epoch:      1789860503
container epoch: 1789860503
```

Valid controls are minted with `iat = now - 60`, `exp = iat + 3600`.

Container `dvd32-a` on 18991 with a throwaway 41-char secret generated for this
run. Every probe is a single `curl -D -` with a hand-built `cookie:` header and
no redirect following. Run against `/app` and against the deep subpath
`/app/work-orders/WO-1001`; **the two tables came back identical**, so one is
shown.

```
URL: http://127.0.0.1:18991/app
CASE                                                 STATUS           LOCATION                   CLEARED?
----------------------------------------------------------------------------------------------------------
ZZ anonymous, no cookie at all                       307 Temporary Redirect /?signin=required          no
CONTROL valid (iat now-60, exp iat+3600)             200 OK           --                         no
CONTROL boundary accept (exp - iat = 28800)          200 OK           --                         no
old opaque value                                     307 Temporary Redirect /?signin=required          YES
empty value                                          307 Temporary Redirect /?signin=required          YES
unsigned (header.payload.)                           307 Temporary Redirect /?signin=required          YES
signature stripped (two segments)                    307 Temporary Redirect /?signin=required          YES
forged with another secret                           307 Temporary Redirect /?signin=required          YES
tampered payload, original signature                 307 Temporary Redirect /?signin=required          YES
expired                                              307 Temporary Redirect /?signin=required          YES
alg none                                             307 Temporary Redirect /?signin=required          YES
HS512 with the right secret                          307 Temporary Redirect /?signin=required          YES
missing sub                                          307 Temporary Redirect /?signin=required          YES
missing exp                                          307 Temporary Redirect /?signin=required          YES
missing exp and iat                                  307 Temporary Redirect /?signin=required          YES
exp in 2099                                          307 Temporary Redirect /?signin=required          YES
iat in the future                                    307 Temporary Redirect /?signin=required          YES
iat after exp                                        307 Temporary Redirect /?signin=required          YES
fractional exp                                       307 Temporary Redirect /?signin=required          YES
boundary reject (exp - iat = 28801)                  307 Temporary Redirect /?signin=required          YES
valid token signed with BRAVO                        307 Temporary Redirect /?signin=required          YES
valid token signed with 31-char secret               307 Temporary Redirect /?signin=required          YES
valid token signed with .env.example placeholder     307 Temporary Redirect /?signin=required          YES
COMBINED bad portal + valid demo cookie              200 OK           --                         YES
D-006 demo cookie only (arbitrary value)             200 OK           --                         no
```

All 13 must-pass hostile cases 307 to `/?signin=required` and clear the cookie,
on both paths. The three that the baseline recorded as ACCEPTED at `a02d3496`
(missing `exp`, missing `exp` and `iat`, `exp` in 2099) are now rejected,
because #30's bounds are in the tree. The baseline's W2 is therefore closed at
this head, and closed against a real image built from the actually pushed
commit rather than against somebody's throwaway merge.

Four extra cases were added beyond the required set, chosen because they only
exist as a consequence of #30 sitting behind the middleware and are exactly
where an interaction defect would hide: `iat` in the future (rejected by
`maxTokenAge`'s zero tolerance), `iat` after `exp`, a fractional `exp`, and the
`exp - iat = 28801` boundary. All four reject. The matching boundary-accept
control (`exp - iat = 28800`, exactly `SESSION_TTL_SECONDS`) returns 200, so
#30's bound is inclusive at the limit and does not lock out a full-length real
session.

The combined-cookie case, which the unit tests cannot fully prove because they
read `Set-Cookie` off the returned object rather than off the wire: a tampered
portal cookie plus a valid demo cookie returns a real 200 AND the clear header
still reaches the client through Next's `x-middleware-set-cookie` merge.

`Set-Cookie` on every rejection, verbatim and unchanged from the baseline:

```
set-cookie: axle_portal_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
```

### Runtime, not build-time, secret read

One image id, six containers, all `sha256:f65cee8127a2de4e44b23f90e8dfdb6a3bf8aacbcdedb5e4295cb56c25c6e5c0`:

```
dvd32-a  18991 (alpha) + alpha token : 200 OK / not cleared
dvd32-a  18991 (alpha) + bravo token : 307 Temporary Redirect / cleared
dvd32-b  18992 (bravo) + alpha token : 307 Temporary Redirect / cleared
dvd32-b  18992 (bravo) + bravo token : 200 OK / not cleared
```

### Fail closed

```
18993 secret UNSET        + alpha token       : 307 Temporary Redirect / cleared
18994 secret EMPTY        + alpha token       : 307 Temporary Redirect / cleared
18995 secret 31 CHARS     + 31-char token     : 307 Temporary Redirect / cleared
18995 secret 31 CHARS     + alpha token       : 307 Temporary Redirect / cleared
18996 secret PLACEHOLDER  + alpha token       : 307 Temporary Redirect / cleared
18996 secret PLACEHOLDER  + placeholder token : 200 OK / not cleared   <-- W1
```

Unchanged from the baseline in both directions, including W1: the committed
`.env.example` placeholder is 46 characters, `getSecret()` accepts it, and a
container running it accepts a token signed with it. Queued separately, not
fixed here.

### Edge bundle, re-measured

From the same build log (the image that the matrix ran against):

```
grep -i -E "edge runtime|compressionstream|not supported|unsupported|A Node.js API is used" build.log
(zero hits)

#11 26.22 f Middleware                             40.1 kB
```

The jose subpath imports still keep JWE out of the Edge bundle after the merge
with #30, which is the one thing that could plausibly have regressed in the
auto-merged file. Not carried forward, re-measured.

## 3. Mutation check, re-measured at this head

Pre-state, so "commit before mutating" is addressed rather than skipped: the
worktree was already clean at `197926a`, there was nothing to commit.

```
=== PRE: git status --short (empty = nothing to commit before mutating) ===
=== PRE: HEAD ===
197926a5b2e1ff1929bd594fd5f239067dc323e0
pristine copy sha256: 6CEF2E2B823E9DFDC28D41D2A19993E4994C0D795A514617ED77BB22A65309A4
pristine git hash-object: a10873cbc54842458f45c29d043780afaf7cc79c
```

Mutation: `git checkout afa12ba -- src/middleware.ts`, which is main's
presence-only version (the section 1 table shows main never touched this file,
so main's copy is the pre-fix one).

Proof the mutation is not a no-op, which would be a FAILURE rather than a pass:

```
post-mutation git hash-object: 2f9507f707245afa769a81cd6a7f07e226ebb2ac
git status --short -> M  src/middleware.ts
git diff HEAD --stat -- src/middleware.ts
 src/middleware.ts | 60 ++++++++++++-------------------------------------------
 1 file changed, 13 insertions(+), 47 deletions(-)

-import { PORTAL_SESSION_COOKIE, readPortalSession } from "@/lib/portal-session";
-export async function middleware(request: NextRequest) {
+export function middleware(request: NextRequest) {
-  const portalCookie = request.cookies.get(PORTAL_SESSION_COOKIE)?.value;
-  const portalSession = portalCookie
-    ? await readPortalSession(portalCookie)
```

Result:

```
 ❯ src/middleware.test.ts (10 tests | 4 failed) 18ms
     × rejects every hostile portal cookie value, redirects, and clears the cookie
     × with a bad portal cookie AND a valid demo cookie, still passes (demo path) but clears the bad portal cookie
     × fails closed when AXLE_PORTAL_SESSION_SECRET is missing, even for a well-formed token
     × fails closed when AXLE_PORTAL_SESSION_SECRET is under 32 characters, even for a token signed with that short secret
      Tests  4 failed | 6 passed (10)
```

**Still 4 of 10, and the same 4 test names as the baseline.** #30's bounds did
not change the count, and the reason is structural rather than lucky: the
mutation removes the `readPortalSession` call from the middleware entirely, so
whatever `readPortalSession` does internally becomes unreachable from
`middleware.test.ts`. The other 6 tests only exercise cookie presence and
absence, which main's code also handles.

Restore, and proof it was exact:

```
restored git hash-object: a10873cbc54842458f45c29d043780afaf7cc79c
restored sha256:          6CEF2E2B823E9DFDC28D41D2A19993E4994C0D795A514617ED77BB22A65309A4
pristine sha256:          6CEF2E2B823E9DFDC28D41D2A19993E4994C0D795A514617ED77BB22A65309A4
Compare-Object restored vs pristine copy: 0 differences
byte-for-byte: lengths 2790 vs 2790; identical bytes: True
git status --short  -> (empty)
git diff HEAD --stat -> (empty)
HEAD -> 197926a5b2e1ff1929bd594fd5f239067dc323e0
```

## 4. Suite, types, lint, ledger at `197926a`

```
Test Files  13 passed (13)
     Tests  128 passed | 2 skipped (130)
```

Measured twice, before and after the mutation exercise, identical both times.
This matches the count the branch owner reported for the merged tree.
`npx tsc --noEmit` exit 0. `npx eslint .` exit 0 with the same 7 pre-existing
warnings the baseline recorded (`src/lib/db.ts` unused disable directives,
`src/components/sensor-chart.tsx` `react-hooks/set-state-in-effect`), all in
files this PR does not touch. `npm run ledger:check` exit 0,
`ledger: 4 entries, 0 problem(s).`

## 5. Standing warnings, confirmed unchanged

Not re-litigated, just checked at this head as instructed.

- **W1 unchanged.** `.env.example` blob `29a5890f` is byte-identical in all
  three trees. The placeholder
  `AXLE_PORTAL_SESSION_SECRET=replace-with-a-real-32-plus-char-random-secret`
  is 46 characters, `getSecret()` accepts it, and container `dvd32-ph` running
  it returned 200 for a token signed with it. A deploy shipping the example
  verbatim has a signing secret published in the repo. Queued separately.
- **W3 unchanged.** Matcher at `197926a` is still `"/app/:path*"` only, and the
  data APIs are anonymous by D-012. Re-confirmed on the wire with no cookie at
  all: `PATCH /api/work-orders/WO-1001` with `{"action":"due","due_date":"2030-01-02"}`
  returned `200 {"id":"WO-1001","ok":true}`. So "the middleware is the whole
  session-required surface" is true partly because nothing else requires a
  session. Pre-existing design decision, not a regression.
- **W4 unchanged.** `POST /api/session?signout=1` with both cookies set:

```
HTTP/1.1 303 See Other
location: /
set-cookie: axle_demo_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
```

  Only the demo cookie is cleared. An immediate `GET /app` carrying only the
  surviving portal cookie returned 200. Queued separately.

- **W2 from the baseline is now CLOSED at this head**, not just predicted
  closed: missing `exp`, missing `exp` and `iat`, and `exp` in 2099 all reject
  against the image built from `197926a`.

## Findings from this delta

- **F1 (cosmetic, not a blocker). The merge dropped the trailing newline on
  `docs/demos/axlepoint/decisions.md`.** Both parents end with `0x0A`; `197926a`
  ends with `0x2E` (the `.` of "committing."). This is the one thing the merge
  commit introduced beyond the stated docs resolution. Nothing checks it:
  `.gitattributes` covers only `*.mjs` and `*.sh`, there is no markdown linter,
  and `npm run ledger:check` passes. Worth a one-character fix next time that
  file is edited, not worth a push on its own.

Nothing else. No code-level surprise, no behavior change against the baseline
except the three cases #30 was meant to close, which it does.

## Theater check on the delta claims

| Claimed | Found | Verdict |
|---|---|---|
| `a02d3496` stays an ancestor (merge, not rebase) | `git merge-base --is-ancestor` holds; graph shows a true merge with parents `d01301a` and `afa12ba` | CONFIRMED |
| Only conflict was `docs/demos/axlepoint/decisions.md` | Blob table: exactly one novel non-docs file, and it reproduces as a clean `git merge-file` with exit 0 | CONFIRMED |
| `portal-session.ts` auto-merged carrying both sides | `git merge-file` output is byte-identical to the committed file | CONFIRMED |
| Suite on the merged tree: 13 files, 128 passed, 2 skipped | Measured 13 / 128 / 2, twice | CONFIRMED |
| Reconciliation note added under D-014 | Present, four lines, retracts the stale "no production caller" claim | CONFIRMED |
| Merge introduced nothing else | One cosmetic exception, F1 | PARTLY CONFIRMED |

## Cleanup

All six `dvd32-*` containers removed, `demo-axlepoint:dv32d` image removed and
its layer deleted. No `dvd32` container or `dv32` image remains. The live
`demo-axlepoint` container on 8102 and `demo-proxy` on 8090 were never touched
and are both still `Up 3 hours`. The public URL and `cloudflare-config` were
not touched. Only throwaway secrets generated for this run were used; nothing
under `~/.secrets` was read, and the npmrc was passed to `docker build` by path
only. Working tree of `C:\dev\demo-axlepoint-wt-sess` clean apart from this
report.
