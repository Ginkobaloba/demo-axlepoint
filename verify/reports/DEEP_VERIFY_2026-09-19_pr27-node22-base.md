# Deep Verify: PR #27 move to node:22-bookworm-slim base image (2026-09-19)

Overall: PASS
Tested-SHA: a954ef44e7ded45324df6c0a521e6c3306b29e58

Independent deep verify of `Ginkobaloba/demo-axlepoint` PR #27 (branch
`chore/node22-base`, label `tier-3`). The verifier did not write the PR and
attacked every claim in it rather than reading the diff for plausibility.

**Result: PASS.** Every claim in the PR body, D-013 and the ledger entry was
reproduced against images built from this commit. The headline claim nobody had
tested, that the retained python3/make/g++ toolchain is a working fallback for a
failed better-sqlite3 prebuild, was proven directly with a forced prebuild
failure, and proven load-bearing with a matched control that fails without it.

Totals:
- **1 production image** built from the PR head with the BuildKit npmrc secret
  (`dvaxle:dvn22`, manifest list `sha256:cc6c84f735569f5e...`, 767 MB).
- **Prebuild, not compile:** `npm ci` in the deps stage finished in 19.9 s with
  zero `gyp` output, and the deps-stage image contains no node-gyp artifacts.
- **Fallback proven:** with the prebuild host forced to fail, node-gyp compiled
  better-sqlite3 to completion (`gyp info ok`) and the module loaded and ran a
  query. The matched no-toolchain control failed the build outright.
- **Runtime image clean:** gcc, g++, cc, make, python3, python and node-gyp are
  all absent from the runtime image. Size delta against a node:20 image of the
  same app is +37 MB, exactly the base-image delta (329 MB vs 293 MB).
- **App works on node 22:** `/` 200, sign-in 303, 6 authenticated pages 200,
  full work-order closed loop 6 of 6 PATCHes 200, better-sqlite3 opens and reads
  the database at runtime.
- **Regression:** 105 of 105 unit tests pass on Linux under node 22 (including
  the 2 POSIX-only tests that skip on Windows), `tsc --noEmit` exit 0, `eslint .`
  0 errors, `next build` clean.
- **Diff:** 3 files, exactly the Dockerfile, decisions.md and the ledger entry.

Layer 5 (headed Chrome) was **not run**, by dispatch rule. It is listed as a gap,
not a pass.

## 1. Target and scope

- **Target:** PR #27, head `a954ef44e7ded45324df6c0a521e6c3306b29e58`, two
  commits on top of `2739306`. Worktree `C:\dev\_worktrees\axlepoint-node22`,
  branch `chore/node22-base`, `git status --porcelain` empty.
- **Mode:** deep. Layers 1, 2, 3 (local origin only), 4 (curl and raw page
  source) and 6 (edge and control matrix) ran. Layer 5 did not.
- **Repo assertions:** `verify/smoke.yml` and `verify/tier_map.yml` are present,
  so the tier-3 gate has something to gate against. Every smoke surface was
  exercised locally (HSTS is added at the edge and is N/A against a local
  container).
- **Base image resolved:**
  `node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9`.
- **Credential handling:** the npmrc was passed to BuildKit by path only
  (`--secret id=npmrc,src=<path>`). It was never opened, read, printed or
  hashed. No 401 occurred at any point.
- **Containers:** `dvn27-app` on 127.0.0.1:18961, plus throwaway build-stage and
  deps-stage runs. Nothing touched the live `demo-axlepoint` container,
  demo-proxy, the public URL or cloudflare-config. All containers and images
  created for this run were removed at the end.

## 2. Results by category

| Category | Result | Evidence |
|---|---|---|
| smoke | PASS | `/` 200, 44,570 bytes, all 3 smoke copy strings present, `form action="/api/session"` present |
| navigation | PASS | `/app`, `/app/assets`, `/app/work-orders`, `/app/schedule`, `/app/reports`, `/app/parts` all 200 with real content (assets page 272,958 bytes) |
| auth_lifecycle | PASS | `/app` anonymous 307 to `/?signin=required`; GET `/api/session` 405; POST 303 with `axle_demo_session=demo-user; Path=/; Max-Age=86400; HttpOnly; SameSite=lax` and a relative `location: /app` |
| data_crud | PASS | Create WO 200, then assign, status, due, add_part, close, 5 of 5 200; detail page renders "Marcus Webb" and "closed" |
| error_handling | PASS | 405 on GET `/api/session`, 400 on `/api/assets/AST-0001/readings` with no params, 400 on malformed PATCH JSON. See W5 for a pre-existing 500 on malformed POST JSON |
| performance | PASS (local) | `Ready in 91ms`; `/` served in 0.036 s |
| security_headers | N/A locally | HSTS is added at the edge; not assertable against a local container |
| visual_regression | SKIP | No baseline |
| accessibility | SKIP | axe not in the harness |
| mobile_responsive | SKIP | No headed or headless browser layer this run |
| cross_browser | SKIP | No browser layer this run |
| edge_cases | PASS | Forced-prebuild-failure matrix and no-toolchain control, section 4 |

### Layer 1: code

Run inside the image's own `build` stage (node 22, Linux, the exact condition
under test), not on the Windows host:

- `npx vitest run`: **11 files, 105 of 105 passed** in 1.77 s. The 2 POSIX-only
  `db.test.ts` cases that skip on Windows **ran and passed** here.
- `npx tsc --noEmit`: exit 0.
- `npm run lint` (`eslint .`): **0 errors**, 7 warnings, all pre-existing and
  none in the diff (4 `react-hooks` warnings in chart components, 3 unused
  `eslint-disable` directives in `src/lib/db.ts`).
- `next build`: succeeded inside the image build.
- CI on the head: Quick Verify **pass**, Socket Security Project Report **pass**,
  Socket Security Pull Request Alerts **pass**, Deep Verify **fail** because
  `verify/reports/` carried no report for pr27. That is correct gate behavior;
  this report is the thing it was waiting for.

### Layer 2: runtime

`dvn27-app` started with `Ready in 91ms`. The only non-startup lines in the
container log are recharts SSR warnings, which are pre-existing (see W4). Zero
`SqliteError`, zero unhandled rejections, zero restart loops.

`node --version` inside the running container: **v22.23.2**.

## 3. Claim 1: node:22 in every stage, toolchain kept in deps only

`grep FROM Dockerfile` on the PR head returns exactly three lines, all
`node:22-bookworm-slim` (`deps`, `build`, `run`). No `node:20` string remains in
the Dockerfile. A repo-wide scan found `node:20` only in prose: decisions.md and
the ledger entry (both describing the change), and one stale comment in
`scripts/update-coordination.ps1` (see W2).

The `apt-get install python3 make g++` line is in the `deps` stage only. The
`run` stage is a fresh `node:22-bookworm-slim` that copies only
`.next/standalone`, `.next/static`, `public` and `data` from `build`.

## 4. Claim 2: the prebuild is used normally, and the toolchain is a real fallback

This is the claim the PR rests on and the one nobody had tested. Four builds were
run to settle it.

### 4.1 Normal build uses the prebuild, not a compile

`docker build --no-cache --progress=plain`:

```
#9 [deps 5/5] RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
#9 2.444 npm warn deprecated prebuild-install@7.1.3: ...
#9 DONE 19.9s
```

19.9 s for the whole `npm ci`, and **zero** `gyp` lines in the log. A source
compile of better-sqlite3 takes roughly 50 s on this machine (measured in 4.2).

npm hides install-script output on success, so the log alone is weak evidence.
The forensic check is stronger. `docker build --target deps` then inspecting the
image:

```
better-sqlite3 version: 12.10.0
PRESENT gcc / PRESENT g++ / PRESENT make / PRESENT python3
/app/node_modules/better-sqlite3/build:
Release
/app/node_modules/better-sqlite3/build/Release:
better_sqlite3.node
gyp artifact absent: Makefile
gyp artifact absent: config.gypi
gyp artifact absent: binding.Makefile
gyp artifact absent: Release/obj.target
gyp artifact absent: deps
sqlite ok 3.53.1
```

`prebuild-install` extracts only `build/Release/better_sqlite3.node`. node-gyp
leaves `Makefile`, `config.gypi`, `binding.Makefile`, `Release/obj.target/` and
`Release/obj/`. None of those exist. **The prebuild was used. CONFIRMED.**

### 4.2 The fallback compiles, with the prebuild download forced to fail

A scratch Dockerfile (held in the session scratchpad, **not committed**, and the
worktree stayed clean) reproduces the deps stage verbatim and points
prebuild-install at the discard port so the download fails the way a flaky or
unavailable prebuild host would:

```
ENV npm_config_better_sqlite3_binary_host=http://127.0.0.1:9/better-sqlite3
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci --foreground-scripts
```

Result:

```
#9 17.67 > prebuild-install || node-gyp rebuild --release
#9 17.67 prebuild-install warn install connect ECONNREFUSED 127.0.0.1:9
#9 ...   gyp info find Python using Python version 3.11.2 found at "/usr/bin/python3"
#9 ...   CXX(target) Release/obj.target/better_sqlite3/src/better_sqlite3.o
#9 ...   SOLINK_MODULE(target) Release/obj.target/better_sqlite3.node
#9 ...   COPY Release/better_sqlite3.node
#9 65.07 gyp info ok
#10 0.357 FALLBACK_OK better-sqlite3 works, node v22.23.2 result 42
```

The compiled module loads and executes a query. The build directory afterwards
contains the full gyp artifact set (`Makefile`, `config.gypi`,
`Release/obj.target/better_sqlite3/src/better_sqlite3.o`, the bundled sqlite3
sources), which is the exact opposite fingerprint of 4.1. **CONFIRMED.**

### 4.3 Control: without the toolchain, the same failure is fatal

The identical scratch Dockerfile with the `apt-get install python3 make g++` line
deleted:

```
prebuild-install warn install connect ECONNREFUSED 127.0.0.1:9
gyp ERR! find Python Python is not set from command line or npm configuration
gyp ERR! stack Error: Could not find any Python installation to use
ERROR: failed to build: process "/bin/sh -c npm ci --foreground-scripts" did not
complete successfully: exit code: 1
```

The toolchain is load-bearing, not decorative. The PR's stated reason for keeping
it is correct. **CONFIRMED.**

## 5. Claim 3: the toolchain never reaches the runtime image

Run against the built runtime image:

```
node: v22.23.2
ABSENT  gcc
ABSENT  g++
ABSENT  cc
ABSENT  make
ABSENT  python3
ABSENT  python
ABSENT  node-gyp
```

`dpkg -l | grep -E ' (gcc|g\+\+|make|python3) '` returns nothing, and
`/var/lib/apt/lists` is empty of package lists. The compiled native module is
present and is the only better-sqlite3 artifact:

```
/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

**Size baseline.** A node:20 image of the same application was available for a
clean comparison: `dvaxle:dvn29`, built in this same run from
`fix/patch-due-type` (PR #29), which differs from this branch only in about 60
lines of `src/lib/wo-actions.ts` and still carries the node:20 Dockerfile.

| Image | Node | Size |
|---|---|---|
| `dvaxle:dvn29` (node:20 Dockerfile, same app) | v20.20.2 | 730 MB |
| `dvaxle:dvn22` (this PR) | v22.23.2 | 767 MB |
| `node:20-bookworm-slim` base | | 293 MB |
| `node:22-bookworm-slim` base | | 329 MB |

The runtime image grew by 37 MB; the base image alone accounts for 36 MB of
that. Nothing measurable came from the toolchain, because the toolchain is not
there. **CONFIRMED.**

For contrast, the deps stage that does carry the toolchain plus dev dependencies
is 2.22 GB. That cost stays entirely in the builder.

## 6. Claim 4: the app builds and serves on node 22

| Check | Result |
|---|---|
| `/` | 200, 44,570 bytes, 0.036 s |
| smoke copy "Asset health and maintenance operations for" | present |
| smoke copy "Open the live demo" | present |
| `form action="/api/session"` | present |
| `/app` anonymous | 307 to `/?signin=required` |
| GET `/api/session` | 405 |
| POST `/api/session` | 303, relative `location: /app`, httpOnly SameSite=lax cookie |
| `/app` | 200 (69,571 bytes) |
| `/app/assets` | 200 (272,958 bytes) |
| `/app/work-orders` | 200 (219,086 bytes, real ids WO-1023, WO-1065) |
| `/app/schedule` | 200 (112,318 bytes) |
| `/app/reports` | 200 (34,246 bytes) |
| `/app/parts` | 200 (107,471 bytes) |
| Closed loop: create, assign TCH-01, in_progress, due, add_part, closed | 200 on all 6 |
| Detail page after the loop | 200, renders "Marcus Webb" and "closed" |

Those page sizes are the proof that better-sqlite3 opens and reads the database
at runtime under node 22: an asset table of 272 KB and a work-order list carrying
real row ids cannot be served without a working native module. A direct read
through the image's own better-sqlite3 (`node -e`, since the slim image has no
sqlite3 CLI) also succeeded.

## 7. Claim 5: diff is only the Dockerfile, decisions.md and the ledger

`git diff <merge-base> HEAD --stat`:

```
 Dockerfile                                              | 18 ++++++++++++++----
 docs/demos/axlepoint/decisions.md                       | 18 ++++++++++++++++++
 docs/ledger/...-node-22-base-image-keep-build-toolchain-as-prebuild-fallback.md |  6 ++++++
 3 files changed, 38 insertions(+), 4 deletions(-)
```

Exactly as claimed. No source, test, workflow or lockfile change. **CONFIRMED.**

D-013 in decisions.md accurately describes the change and the reason, including
that the toolchain lives in the build stage only. The ledger entry is accurate
except for one imprecise phrase, see W3.

## 8. Theater Check

| Builder claimed | Verification found | Verdict |
|---|---|---|
| All three Dockerfile stages move to node:22-bookworm-slim | 3 of 3 `FROM` lines are node:22; no node:20 left in the Dockerfile; containers report v22.23.2 | CONFIRMED |
| better-sqlite3@12.10.0 normally installs from a prebuild for node 22 linux-x64, not a compile | `npm ci` 19.9 s, zero gyp output, and the deps image has only `build/Release/better_sqlite3.node` with no gyp artifacts | CONFIRMED |
| The kept python3/make/g++ is a working fallback if the prebuild fails or is unavailable | Forced prebuild failure: prebuild-install ECONNREFUSED, node-gyp compiled to `gyp info ok`, module loaded and returned a query result | CONFIRMED (tested here for the first time) |
| Removing the toolchain leaves nothing to fall back to | Matched control build without the toolchain fails: `Could not find any Python installation to use`, exit 1 | CONFIRMED |
| The toolchain never reaches the runtime image | gcc, g++, cc, make, python3, python, node-gyp all absent; no apt lists; size delta versus a node:20 build of the same app is the base-image delta | CONFIRMED |
| The app builds and serves on node 22 | Image built clean; `/` 200; 6 authenticated pages 200; closed loop 6 of 6; DB reads work | CONFIRMED |
| Tests, tsc, lint and build are clean | 105 of 105 on Linux node 22 (the 2 POSIX-only cases included), tsc 0, eslint 0 errors, build clean | CONFIRMED |
| "a docker build with it removed hit a prebuild-install network timeout once (2026-09-19, observed on the lumen-analytics sibling repo)" | Not reproducible after the fact. A one-off historical event with no artifact. The conclusion it supports is independently true (4.3), so the decision stands on its own evidence | TAKEN AS REPORTED, not confirmed |
| Ledger: the run stage takes "no node_modules" from the build stage | Imprecise. `.next/standalone` contains a traced `node_modules`, including better-sqlite3's compiled `.node`. The claim that matters, that the toolchain does not ship, is true | PARTIAL (see W3) |

## 9. Blockers

None.

## 10. Warnings (non-blocking)

### W1. `@types/node` is still `^20` while the runtime is node 22
`package.json` devDependencies pin `"@types/node": "^20"` and there is no
`engines` field anywhere. `tsc --noEmit` is clean, so nothing is broken today,
but the type surface being checked is node 20's while the container runs node
22. **Fix:** bump to `^22` and consider adding `"engines": { "node": ">=22" }`.
**Tier:** Sonnet executor.

### W2. Stale node:20 comment in `scripts/update-coordination.ps1`
Line 38 still reads "better-sqlite3 needs python3/make/g++ on
node:20-bookworm-slim". It is now wrong twice: the base is node 22, and
better-sqlite3 does not need the toolchain there in the normal path. Comment
only, no behavior. **Fix:** update the comment. **Tier:** Sonnet executor.

### W3. Ledger wording: "no node_modules" in the runtime image
The ledger says the run stage takes ".next/standalone, .next/static, public, and
data from the build stage, no node_modules". `.next/standalone` ships its own
traced `node_modules` (that is where the verified
`/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node` comes
from). The intended claim, that the compiler toolchain does not ship, is true and
was verified. **Fix:** reword to "no build toolchain". **Tier:** Sonnet executor.

### W4. Pre-existing: recharts SSR warnings in the container log
The runtime log carries repeated `The width(-1) and height(-1) of chart should be
greater than 0` lines. **Controlled:** the node:20 image of the same app
(`dvaxle:dvn29`) emits the identical warning for the same pages, so node 22 did
not introduce it. Cosmetic log noise only. **Tier:** Sonnet executor, not
tier-3, and not this PR.

### W5. Pre-existing: malformed JSON to POST `/api/work-orders` returns 500
`PATCH /api/work-orders/[id]` wraps `request.json()` in try/catch and returns
400. `POST /api/work-orders` does not, so a malformed body throws a
`SyntaxError` and Next returns 500 with a stack in the log. **Controlled:** the
node:20 image behaves identically, so this is on `main` and not from this PR.
**Fix:** mirror the PATCH route's try/catch. **Tier:** Sonnet executor.

### W6. CI cannot catch a node-version regression here
`.github/workflows/verify.yml` runs only the offline gate test and the quick
smoke against `verify/smoke.yml`. It never runs `npm ci`, the unit tests or
`docker build`. A green CI on this PR says nothing about node 22. The only
evidence that this change works is a local run like this one. **Fix:** consider
adding a `docker build` job, noting that the private `@paradigm-codes/*` scope
needs a token in Actions (the lumen sibling documents the same 401 constraint).
**Tier:** Sonnet executor, with a workflow change Drew should see.

### W7. Observed during this run: `next build` reaches the network
The first `next build` attempt in the image hit
`connect ECONNREFUSED 108.177.122.94:443` (a Google Fonts address) and Next
retried and succeeded on its own (`Retrying 1/3...` then
`Compiled successfully in 30.4s`). Not a defect in this PR, and not node-22
specific, but it is an independent build-time network dependency worth knowing
about. It also happens to be the same class of flake the PR cites as its reason
for keeping the toolchain.

## 11. Coverage gaps (stated so the verdict is not overclaimed)

- **Layer 5 (headed Chrome) was not run**, by dispatch rule. No real-mouse pass
  over the demo flow.
- No headless browser layer either this round: the UI was exercised through curl
  and raw page source, not Playwright. Hydration and client-side behavior on
  node 22 were therefore not re-checked. The server render, the API surface and
  the database path were.
- No axe, no visual regression, no cross-browser.
- Latency was measured on local Docker Desktop, not the deployed host.
- The "prebuild-install network timeout" anecdote in D-013 and the Dockerfile
  comment is historical and could not be reproduced. It is recorded as taken on
  report; the decision it supports was proven independently.
- The node:20 size and log baseline came from `dvaxle:dvn29`, which is the same
  app on a sibling branch rather than a build of `origin/main` exactly.

## 12. Run artifacts

Scratch evidence (local, not committed), under
`...\scratchpad\verify-runs\`:
- `A-build.log`, `A-deps.log`, `A-buildstage.log`, `A-tests.log`;
- `A-fallback-withtc.log`, `A-fallback-notc.log`;
- `Dockerfile.fallback-withtc`, `Dockerfile.fallback-notc` (scratch only, never
  committed, and `git status` in the worktree stayed clean apart from this
  report).

Cleanup: `dvn27-app` and every `dvaxle:*` image created for this run were removed
at the end. The live `demo-axlepoint` container was never touched.
