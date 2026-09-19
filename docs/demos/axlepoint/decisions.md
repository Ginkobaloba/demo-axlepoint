# AxlePoint design decisions

Decision log for the AxlePoint demo build. Format: ID, decision, rationale.

## D-001: Sensor history resolution is tiered, not uniform hourly

The brief calls for 6 months of hourly readings per asset (~26M rows). The
generated database instead stores hourly readings for the trailing 14 days
and 6-hour readings for the prior ~5.5 months (~544k rows, 41 MB SQLite).
Charts render identically at every zoom level the UI offers (24h, 7d, 30d,
6mo); a 6-month line chart cannot visually resolve hourly points anyway.
This keeps generation under 30 seconds and the container image small.

## D-002: Anomaly threshold is 3.5 sigma, not 3.0

The EWMA variance estimate is itself noisy, which fattens the z-score tails.
At 3.0 sigma the detector fired 2-3 false positives per asset-week across
the fleet and pushed half the healthy fleet into the medium risk band. At
3.5 sigma the healthy fleet sits in low band with occasional one-off minor
anomalies, which matches the operational story the demo tells.

## D-003: Risk scores saturate smoothly instead of hard-capping

Per-sensor contributions approach their 55-point cap via tanh, and the
total compresses above 70 toward an asymptote just under 98. Hard caps
produced multiple assets pinned at identical scores (98, 98, 98), which
reads as synthetic. Smooth saturation keeps distinct inputs distinct.

## D-004: Component primitives are hand-rolled, no shadcn CLI or Radix

The brief lists shadcn/ui. The shadcn CLI v4.x emits Tailwind-v4-only
components onto the create-next-app@14 Tailwind v3 template (confirmed
independently by the Slatewell session, their D-001). Rather than migrate
to Tailwind v4 mid-sprint, AxlePoint ships shadcn-style primitives (cards,
chips, buttons, tables as Tailwind component classes) with zero added
dependencies. Native selects and details/summary replace Radix overlays;
they are keyboard-accessible by default and SSR-safe.

## D-005: SQLite ships inside the image; runtime writes are ephemeral

The database is generated at image build time and copied into the runtime
layer. The only runtime write is demo work-order creation. Writes land in
the container layer and reset on redeploy, which is desirable: the demo
self-cleans. Multi-host HA serves independent copies; sessions are not
sticky, but the dataset is identical on both hosts and drafts are throwaway.

## D-006: Demo auth is a cookie, not a user system

"Sign in as demo user" sets an httpOnly session cookie via a POST route;
middleware guards /app. No credentials, no user table, no session store.
The interview story: swap the cookie issuer for the real IdP (Auth0,
Cloudflare Access) without touching the guarded surface.

## D-007: Fictional models, suppliers, and sites only

No real Fairbanks Morse engine families, customer names, or facility names
appear anywhere in data or copy. Asset models (Meridian V12T, Caldera C16V,
Voltaic G2500) and suppliers are invented. Sites are fictional but
geographically plausible for marine, power, mining, and rail narratives.
The Fairbanks Morse logo is deliberately absent from the marketing page.

## D-008: MTBF KPI windows tuned for comparability

Work order creation dates spread so the trailing-30d and prior-30d
corrective counts are comparable. Early drafts produced a -79% MTBF swing,
which no maintenance organization would survive; current data lands in the
minus-15-to-30 percent range, consistent with the "fleet under stress,
5 critical assets" narrative the dashboard tells.

## D-009: Paradigm banner is a TSX port of the canonical component

Phase 0's canonical banner (cloudflare-config/banner/) is vanilla JS and
JSX. AxlePoint ships a TypeScript port that follows the documented contract
exactly (32px, #1f5a44 on #f7f5f0, pn_banner_dismissed 7-day cookie,
role="region", labeled dismiss) and restyles with the project's Tailwind
tokens. If the contract changes, port the change and redeploy.

## D-010: Federate to Paradigm Portal via JWKS, keep demo cookie alive

Chunk 4b. AxlePoint now accepts two parallel authenticated paths:

1. The legacy `axle_demo_session=demo-user` cookie set by POST /api/session.
2. A new `axle_portal_session` cookie minted by /api/auth/portal-handoff
   after verifying a Paradigm Portal RS256 JWT against the portal's JWKS.

The middleware accepts either. The demo path stays so existing bookmarks
keep working; the portal path is the real authenticated session and the
only one a user reaches when they click the AxlePoint tile on the portal.

Verification follows `portal-shell/docs/PORTAL_GATE_CONTRACT.md`:

- JWKS fetched on first call, cached per the response's Cache-Control
  (1h fresh + 10m stale-while-revalidate per the contract defaults).
- Token signature checked against the kid-matching JWK first, then any
  remaining JWK so a token minted right before a portal key rotation
  still verifies.
- Strict iss + aud equality. axlepoint accepts only
  `aud=axlepoint` from issuer `https://portal.projectnexuscode.org`.
- Typed errors (BadSignature, Expired, IssuedInFuture, WrongAudience,
  WrongIssuer, UnknownKid, MalformedToken, JwksFetchError) so the
  handoff route's HTTP mapping is precise: 401 for token failures,
  503 when the portal's JWKS endpoint itself is down or rate-limiting.

The app-side session cookie is HS256 signed with
`AXLE_PORTAL_SESSION_SECRET` (env, 32+ chars required in deployed
envs) carrying sub + customer_id + role, 8h TTL. Reading the cookie
goes through `readPortalSession` so the verification path is a
single function call.

Tier 2 additive: no existing behavior changes. Shipping is safe even
if the portal subdomain is mid-deploy because the JWKS fetch is
lazy-on-first-handoff and the demo cookie path is unaffected.

## D-006: Work-order titles are screened at the create endpoint

The seed generator never produces junk, but POST /api/work-orders is open and
the running container persists drafts until the next redeploy (D-005). Ad-hoc
API pokes during deploys ("Test", "JSON API test order", "Test audit work
order") therefore leaked into the live work-order list where a prospect could
see them. `screenWorkOrderTitle` (src/lib/work-order-validation.ts) rejects
titles under 6 chars and obvious test/placeholder patterns, returning 422 to
JSON callers and a relative redirect back to the form (with the reason) for
form posts. The clean seed plus this guard means a redeploy clears the
existing junk and nothing of that shape can re-accumulate. Note: the junk was
runtime-only state, not a seed defect, so no generator change was needed.

## D-007: Work orders are writable end-to-end (closed loop)

The headline workflow drafts a predictive work order via "Recommend
Preventive Action", but the drafted order was a dead end -- no way to assign,
schedule, or action it. The detail page now PATCHes /api/work-orders/[id] to
move status, assign a technician, set a due date, and attach/detach parts.
Pure validation and the status->completed_at rule live in src/lib/wo-actions.ts
(unit-tested); the SQLite writes live in queries.ts; the editable UI is two
client components (work-order-controls, work-order-parts-editor) that refresh
the server-rendered detail after each change. Closing an order stamps
completed_at; reopening clears it. Attaching a part does NOT decrement
inventory stock -- consumption against on-hand is owned by the reorder/PO flow
so the two paths never double-count. Writes are container-local and reset on
redeploy, same contract as createWorkOrder (D-005).

## D-008: portal-handoff handler extracted out of the route file

The portal-handoff route exported a makeHandler factory (so tests could inject
a stub VerifierConfig). Next.js 14 App Router route modules may only export
HTTP method handlers plus a fixed config set, so that export failed the
production build's generated route-type check -- one of the pre-existing
"auth-chunk" breakers that left main unable to `next build`. The factory moved
to src/lib/portal-handoff-handler.ts; route.ts now exports only POST. Behavior
is unchanged and the existing integration tests pass against the moved module.
A second breaker (an unused UnknownKid import in portal-verify.test.ts) was
also removed. With both gone, main builds clean and the demo is redeployable.

## D-009: Big tables are client-side searchable/sortable/filterable

Work Orders (150+ rows) and Parts (80 SKUs) were read-only server tables with
no search, sort, or filtering. Both now render through client components
(work-orders-table, parts-table) that take the full row set from the server
page and filter/sort in memory -- no round-trips, instant interaction, and the
data sets are small enough that client-side is the simpler, faster choice than
server query params. Sorting is a shared pure utility (src/lib/table-sort.ts,
unit-tested): numeric-aware string compare, nulls always last, stable order,
non-mutating. The SortableTh header component is shared too. Work Orders gets
search (id/title/asset/tech), status tabs, and type/priority filters; Parts
gets search (name/sku/category/supplier), category, and stock-status filters.
A "Showing N of M" line keeps the active filter honest.

## D-010: Purchase-order entity closes the parts reorder loop

The Parts table flagged "Reorder needed" with nowhere to go. Added a real
purchase-order entity: two tables (purchase_orders, purchase_order_lines)
seeded with 13 historical/in-flight POs, a Purchase Orders nav section
(list + detail), and the reorder actions. "Create reorder PO" on the Parts
page drafts one PO per supplier covering all below-reorder parts, with
recommended quantities (recommendedReorderQty = reorder_point*2 - on_hand);
a per-part "Reorder this part" button does the same for one part. POs move
draft -> ordered -> received (pure transition rules in src/lib/po-actions.ts,
unit-tested); ordering projects an expected-arrival date from the longest line
lead time, and RECEIVING is the one place inventory stock is incremented (the
counterpart to attaching parts to work orders, which deliberately does not
touch stock -- D-007). The parts<->WO link is closed both ways: a part detail
page (/app/parts/[id]) lists the work orders consuming it and the POs that
include it; work orders already showed their parts. Verified end-to-end:
create reorder -> 5 low parts became 3 supplier POs -> receive one -> the 3
restocked parts dropped off the below-reorder list.

## D-011: Schedule is interactive (views + drag-to-reschedule)

The PM calendar was a read-only month grid. It is now a client board
(schedule-board.tsx) with four views -- Month, Week, Day, and By technician --
and prev/next/today navigation. Tasks are draggable: dropping a task on a
different day PATCHes /api/schedule/[id] with the new next_due and optimistically
moves the chip (reverting on failure). The By-technician view aggregates load
(task count + labor hours, sorted, Unassigned last) via the pure, unit-tested
technicianLoad helper; date validation (rejecting overflow dates like 02-30) is
the unit-tested isValidIsoDate in src/lib/schedule-view.ts. HTML5 drag-and-drop
is used directly (no dnd library) to keep the bundle small. Verified
in-browser: all four views render; a synthetic drag moved a task to a new day
and persisted; the API rejects bad dates (422) and unknown tasks (404).

## D-012: Anonymous by design -- visitor free text is never persisted, and the
shared database resets to seed on a schedule

Council item 1.2 (C:\dev\COUNCIL_COMPLIANCE_2026-09-19.md, section 1.2): the
demo's build-time SQLite database (D-005) is a singleton shared by every
visitor through one demo-user cookie (D-006) with no per-visitor concept.
Before this fix, anything a visitor typed into the "New work order" form or
the "Recommend Preventive Action" button (title, description) was written
straight into that shared file and shown to every later visitor until the
next redeploy.

Audited every visitor-writable surface first: work orders (POST
/api/work-orders, PATCH /api/work-orders/[id]) and purchase orders (POST
/api/purchase-orders, PATCH /api/purchase-orders/[id]). Only work_orders.title
and work_orders.description are visitor free text. Everything else a visitor
can write is structured/enum-constrained: status, due_at, work-order part
attachments (part id + qty), and PO status transitions. assigned_to
(technician id) is meant to be a foreign-key picklist, but at first pass of
this fix it was not enforced as one -- see the correction below. purchase_orders.notes
exists in the schema but is never visitor-supplied -- createReorderPurchaseOrders
(queries.ts) always writes the fixed string "Auto-drafted from a reorder
alert." There is no free-text input anywhere in the PO UI. So the fix is
scoped to work orders; POs needed no code change, just this record of why.

Design choice, from the three candidates the council direction offered
(client-side-only state, server writes with no free text persisted, or an
in-memory per-browser-id store): **server writes with no free text
persisted**, not client-side-only state. AxlePoint's work-order pages are
server-rendered SQL joins (queries.ts joins work_orders/assets/technicians);
making the closed-loop workflow (create -> assign -> schedule -> attach
parts -> close, D-007) client-side-only would mean duplicating that join
logic in the browser and inventing a client-only detail route -- a
rearchitecture, not a fix, for a two-column problem. Storing no free text
keeps every existing page, query, and test working unchanged.

Concretely (src/app/api/work-orders/route.ts, src/lib/work-order-validation.ts):
screenWorkOrderTitle still validates the shape of what a visitor typed (junk
titles like "Test" or "JSON API test order" still get rejected with the same
UX as before, D-006's screen), but the literal string is discarded either
way. What lands in the title column is deriveWorkOrderTitle(asset.name,
type) -- "Preventive - Meridian V12T #04" -- built only from the asset and
type the route already validated as real, structured values. The description
column gets a fixed, honest placeholder (DISCARDED_DESCRIPTION_NOTICE)
instead of an empty string, so a reader sees why the field looks blank
rather than a confusing gap. The New Work Order form keeps both inputs (the
demo still feels interactive, and the validation still gives real feedback)
with a short note next to each explaining nothing typed there is stored.
Seed rows (the original 150 work orders) are untouched -- this only affects
orders created at runtime.

Second half of the direction: reset the shared database to seed on a
schedule, so any other kind of drift (not just free text) cannot
accumulate indefinitely on a long-running container between redeploys.
scripts/generate-db.ts now writes data/axlepoint.seed.db, a byte-identical
snapshot, right after generating data/axlepoint.db, so `npm run db:generate`
stays the single source of truth for both files (regenerating after
touching anomaly.ts/risk.ts regenerates the seed too, with no separate step
to remember). src/lib/db.ts's getDb() calls resetDbIfDue() first, mirroring
how demo-harborbistro's getDb() triggers runRetentionIfDue()
(src/lib/retention.ts there): the first call after process boot always
resets (so a long-lived container gets a known-good state promptly, not
just at the next interval boundary), and after that resetDbIfDue() runs at
most once per RESET_INTERVAL_MS (default 6 hours, env-overridable). A due
reset closes the cached connection, deletes the live file's -wal/-shm
sidecars, copies the seed file over the live path, and lets getDb() reopen
a fresh connection -- safe only because every function in queries.ts calls
getDb() and uses the handle synchronously with no await in between; a
future async query function would need to re-call getDb() after its await
rather than hold a handle across one. If no seed snapshot exists (an old
dev checkout, or a test fixture that omits one on purpose) the reset is
skipped and logged once rather than bootstrapped from the live file --
bootstrapping would risk freezing a developer's freshly regenerated
database as "the seed" on the next interval.

Not done, and why: no per-visitor identity was added (candidate (c), an
in-memory store keyed by a random per-browser id). The direction is
anonymous by design -- adding a per-visitor id, even ephemeral and
in-memory, is the kind of identity concept this fix is explicitly removing,
and it was not needed once the free text itself is never stored.

Headline flow, preserved rather than flattened: "Recommend Preventive
Action" (D-007) is the one demo flow a prospect is walked through, and a
first pass of this fix would have reduced its drafted work order to the
same generic "Predictive - <asset>" title every other type gets, losing
the sensor-specific recommendation story. src/lib/predictive-action.ts
(ACTION_BY_SENSOR, deriveRecommendedWorkOrder) derives that title and
description from the asset's own risk_factors column -- server-computed,
not visitor input -- the same way recommend-action.tsx already previewed
it client-side; the route calls it for type "predictive" instead of the
generic deriveWorkOrderTitle/DISCARDED_DESCRIPTION_NOTICE pair, and
ignores whatever the button actually submitted, same as every other
field. recommend-action.tsx now imports ACTION_BY_SENSOR from that shared
module instead of keeping its own copy, so the client preview and the
stored result cannot drift apart.

Two hardening items in the reset path, since it runs unattended for
months at a time: AXLEPOINT_RESET_INTERVAL_MS is parsed through
parseResetInterval(), which falls back to the 6-hour default on anything
non-finite or non-positive (an unguarded Number() on a bad override would
produce NaN, and `nowMs - last < NaN` is always false, so every getDb()
call would think a reset was due and re-copy the ~40 MB database on every
request). And the seed-to-live copy lands via a temp file plus
fs.renameSync rather than copying directly onto DB_PATH, so a failure
mid-copy cannot leave a truncated, unopenable live database serving 500s
until the next redeploy.

Verified: src/lib/db.test.ts exercises resetDbIfDue's boot/interval/skip
behavior directly against temp fixture files (no seed present, has-seed
reset dropping a synthetic post-snapshot write, throttling to once per
interval). src/app/api/work-orders/route.test.ts posts distinctive marker
strings as title and description through both the form and JSON paths and
asserts, by reading back through the real queries.ts functions (getWorkOrders
/ getWorkOrder), that the markers never appear anywhere in the database --
covering "visitor A's text never reaches visitor B or a fresh client" the
only way that is true here: it never reaches anyone. A dedicated test
posts the JSON path with marker preview text on a predictive work order
and asserts the stored title/description match deriveRecommendedWorkOrder's
output exactly (not the markers), covering the headline-flow fix. Further
tests cover the create -> read flow and the existing junk-title rejection,
and drive PATCH /api/work-orders/[id] through assign -> in_progress ->
closed to confirm the technician-assignment and status-transition path
(D-007's closed loop) still works end to end.

## D-012 addendum (2026-09-19): assigned_to was not actually structured -- deep-verify blocker B1

Independent deep verify of the PR above (verify/reports/DEEP_VERIFY_2026-09-19_pr24-no-persist-visitor-text.md)
found the claim two sections up -- that assigned_to is "a foreign key
picklist" -- was false. work_orders.assigned_to is a plain TEXT column
with no FK and no lookup in either write route. POST /api/work-orders
(route.ts) stored `String(raw.assigned_to)` unchecked; PATCH's `assign`
action (wo-actions.ts, parseWorkOrderPatch) parsed the shape but never
checked existence, and the route wrote it through unvalidated. A marker
sweep posted arbitrary text in assigned_to through both routes (JSON,
multipart, and urlencoded bodies; seed rows and new rows) and confirmed
it landed in the raw database and was then served to a fresh visitor
(separate cookie jar) inside the RSC flight payload of /app/work-orders
and every affected work order's detail page -- not rendered as visible
text (the UI only shows the joined technician_name, which is null for a
bogus id), but present in the page source every visitor downloads. This
is exactly the leak class this PR exists to close, in the one field the
PR vouched for without testing.

Fixed by adding queries.ts's getTechnician(id) and calling it from both
write paths before the write: POST /api/work-orders rejects an unknown
assigned_to with 422 ("Unknown technician."), same pattern as the
existing title/asset/priority/type validation; PATCH's `assign` case in
[id]/route.ts checks getTechnician(action.assigned_to) the same way
add_part already checks getPart(action.part_id), also returning 422 on a
miss. Empty string or absent still clears the field to null in both
routes -- that behavior was already correct and is unchanged.
wo-actions.ts's parseWorkOrderPatch (tested in wo-actions.test.ts)
intentionally stays DB-free (it is unit-tested without a database, per
its own header comment); the existence check lives in the route layer
instead, matching how add_part's check already works, not in the parser.

Two more findings from the same deep verify, fixed alongside this since
they touch the same routes:

- **W2 (pre-existing on main, not introduced by this PR):**
  POST /api/work-orders built its redirect with `new URL(path,
  request.url)`, which behind the demo's reverse proxy ships `Location:
  http://0.0.0.0:3000/...` -- a real browser lands on a dead host after
  submitting the New Work Order form. api/session/route.ts already
  documents this exact trap and uses a relative Location; this route now
  matches it.
- **W4:** POST accepted an invalid due_date silently (200, due_at stored
  as NULL) while PATCH's `due` action already returned 422 for the same
  bad input. POST now parses and rejects the same way PATCH does.

Not fixed here, by the deep-verify report's own tiering (separate
follow-up, not Tier-3-blocking): W3, a pre-existing React hydration
error on /app/work-orders unrelated to this diff (work-orders-table.tsx,
not touched by D-012).

Hardening from the same report, applied here: a failed reset now logs one
line (`err instanceof Error ? err.message : String(err)`) instead of a
full stack on every due interval, since a misconfigured short interval
would otherwise spam the log; and the Dockerfile now chmods
data/axlepoint.seed.db read-only for the app user after the chown, since
nothing in the app writes to it. **This last item shipped with a real
defect -- see the round-3 addendum below; it does not "harden" anything
by itself, because fs.copyFileSync propagates the source file's
permission bits.**

Verified (round 2): src/app/api/work-orders/route.test.ts adds marker
tests for assigned_to on both POST (JSON and form) and PATCH `assign`
(seed row and a freshly created row), asserting absence via the same
queries.ts read-back the title/description tests use, plus 422 coverage
for an unknown technician id on both routes and for an invalid due_date
on POST. All existing tests continue to pass.

## D-012 addendum (2026-09-19, round 3): the chmod 444 seed broke every write -- blocker B2

Independent re-verify of the round-2 fix (same report file, "Re-verify
(round 2)" section) built the actual image and found the "harden the
seed" item above was not harmless: `fs.copyFileSync` preserves the
source file's permission bits, and `resetDbIfDue` copies
`data/axlepoint.seed.db` (mode 444, per the Dockerfile change) straight
into the temp file that then becomes the live database. Result: on every
container start, the first `getDb()` call reset the live database and
made it `-r--r--r--`. Every write route returned 500
(`SqliteError: attempt to write a readonly database`) for the rest of
the container's life -- creating a work order, every PATCH, purchase
orders, schedule drag, all of it. The privacy fix itself held completely
(0 markers anywhere, confirmed independently again), but the demo was
dead as built. A second, separate failure mode: if a reset ever crashed
mid-copy, the leftover temp file inherited the same read-only mode and
`fs.copyFileSync` cannot overwrite a read-only destination (it opens the
destination for writing rather than recreating it), so every later reset
failed with EACCES -- permanently, until a redeploy.

The 88 unit tests did not catch either failure because no test fixture
made the seed file itself read-only; the bug only exists once a real
filesystem enforces the Dockerfile's mode bits.

Kept the read-only seed (it is still worth having: it is a structural
guarantee nothing in the app can accidentally write to the one file the
reset depends on) and fixed resetDbIfDue instead, in src/lib/db.ts:
before copying, `fs.rmSync(tmp, { force: true })` clears any stale
leftover temp file regardless of its mode (deleting a file depends on
the containing directory's write permission, not the file's own mode, so
this works even against a read-only leftover); after the copy,
`fs.chmodSync(tmp, 0o644)` restores a normal writable mode before the
`fs.renameSync` that makes it live. The -wal and -shm sidecar files are
never copied (only DB_PATH itself is), so they were never part of this
bug; `removeSidecars` already clears any old ones before the copy, and
better-sqlite3 creates fresh ones against the now-writable DB_PATH once
the rename lands.

Verified (round 3): src/lib/db.test.ts adds two cases against a real
0o444 seed file -- a reset still leaves the live database writable
afterward, and a stale read-only leftover temp file from a simulated
crash does not block the next reset. Both use `it.skipIf(!isPosix)` with
the reason in the test name (`process.platform`), since POSIX mode bits
are not meaningful on win32 and a silent pass would be worse than no
test. Also spot-checked against a real Linux container (Docker Desktop):
built the image with the chmod 444 seed intact, ran it at
AXLEPOINT_RESET_INTERVAL_MS=1 (a reset before every request), and
confirmed the live DB was -rw-r--r-- after the boot reset (the seed
stayed -r--r--r--), four POST /api/work-orders calls returned 200, and a
simulated crash leftover (a hand-created, chmod 444'd
axlepoint.db.reset-tmp) was cleared by the next reset with the following
write still returning 200 and no [reset] errors in the logs. This was a
smoke check, not a repeat of the deep-verify report's full matrix; a
fresh deep verify against a built image is still the right next step
before merge, per the report's own "container-level changes need a
runtime check" note.

Also fixed this round, flagged by the same re-verify (W5, minor, not
persistence-related): POST /api/work-orders and PATCH's `due` action
disagreed on two edge cases. POST trimmed a whitespace-only due_date to
empty and cleared it (200); PATCH did not trim before its `=== ""` check,
so the same whitespace-only input fell through to `new Date()` and
422'd. Both also accepted a calendar-overflow date such as 2026-02-30,
because `new Date()` silently normalizes it to March 2 instead of
rejecting it -- neither route's NaN check catches that. Both now go
through isValidIsoDate (src/lib/schedule-view.ts, already used by the
schedule board), which does a round-trip check that rejects overflow,
and both trim first so whitespace-only means "clear" in both places.

## D-013: Node 22 base image (2026-09-19)

Node 20 is EOL; team standard is Node 22. All three Dockerfile stages
moved from node:20-bookworm-slim to node:22-bookworm-slim.

The apt-get install of python3/make/g++ stays. better-sqlite3@12.10.0
ships a prebuilt binary for node 22 linux-x64 (NODE_MODULE_VERSION 127),
so the toolchain is normally unused: a `docker build` with it removed
completed cleanly and a throwaway container served 200 on `/`. But the
same experiment, run against the lumen-analytics sibling repo on the
same day, hit a prebuild-install network timeout on its first attempt
with nothing to fall back to, and failed outright; an unchanged retry
then built cleanly. A build that fails on a flaky network is worse than
a slightly larger builder stage, and the toolchain only lives in the
build stage (never ships in the runtime image), so it was kept as a
fallback: better-sqlite3 normally installs from the prebuild, and
compiles from source only if that download fails or is unavailable.

## D-015: The portal session cookie is verified, not just checked for presence (2026-09-19)

The live gap: src/middleware.ts gated /app on
request.cookies.has(PORTAL_SESSION_COOKIE), presence only, with no
signature or claim check, so any cookie value opened the app. Meanwhile
readPortalSession, the real HS256 verifier in src/lib/portal-session.ts,
had no production caller anywhere in the app. Same finding class as
lumen-analytics L1 (tests/middleware-session.test.ts there), and this fix
mirrors that merged PR's shape.

middleware.ts now calls readPortalSession (jose, Edge-safe subpath
imports) on the portal cookie and treats a missing, invalid, or forged
value exactly as if none were sent, clearing it on the way out so a
forged value does not linger in the browser. portal-session.ts switched
its jose import from the root entry to jose/jwt/sign and jose/jwt/verify,
same reasoning as lumen-analytics: the root entry also pulls in JWE
(CompressionStream), which Next's Edge analyzer flags as unsupported even
though it is never called here. No new dependency: jose ^6.2.3 was
already a direct dependency.

The demo cookie path (axle_demo_session) is unchanged and deliberately
still presence-only: D-006 already establishes it as a bare marker with
no claims to check, not a portal-backed identity. This PR closes forged
*portal* identity. /app is still reachable with axle_demo_session set to
any value, by design.

No other route reads or requires the portal session cookie today: every
/api/* handler is either anonymous by design (D-012) or, for
portal-handoff, mints the cookie rather than checking an existing one. So
the middleware gate is the only session-required surface in the
fail-closed sense; fixing it closes the whole gap.

Fail-closed behavior (AXLE_PORTAL_SESSION_SECRET missing or under 32
characters) needed no new code: readPortalSession's getSecret() already
throws in that case, and the existing try/catch in readPortalSession
already turns that throw into a verification failure, the same outcome as
a bad signature.

Deliberately not duplicated here: PR #30 (fix/customer-session-claims,
branched earlier off main) adds requiredClaims, maxTokenAge, and an
explicit exp-iat bound to readPortalSession, closing a token that is
validly signed but missing exp/iat (verifies forever on main today) or
has an exp set arbitrarily far in the future. This PR's own hostile-token
tests do not depend on that hardening: the one "missing claims" case they
exercise (a hand-signed token missing sub) is already refused by main's
existing `typeof payload.sub !== "string"` check. If #30 merges first,
this branch rebases; if this merges first, #30's diff should still apply
cleanly (its hunks are further down portal-session.ts than this PR's
import-line change). Also flagged in #30, out of scope here: the role
fallback `?? "customer"` in readPortalSession does not validate against
the PortalSessionClaims role union.

Verified: 10 new tests in src/middleware.test.ts (hostile portal cookie
matrix: an inert opaque string that opened /app before this fix, an
empty value, a signature-stripped token, a token forged with another
secret, a tampered payload with the original signature, an expired
token, an alg-none token, and a token missing the sub claim; a demo
cookie set to any value still passes, by design; a hand-signed and a
mintPortalSession-minted valid portal session both pass; a bad portal
cookie alongside a valid demo cookie still passes but clears the bad
cookie; fail-closed when the secret is missing or short). Full suite 111
passed, 2 pre-existing skipped (up from 101 passed on the rebased base,
this branch's 10 new tests, after rebasing onto origin/main's #31
ledger-check fix); tsc, lint, and build all green, including a clean
production build of the Edge middleware bundle (40.1 kB, no Edge-runtime
warnings from the jose subpath imports).

Mutation check: reverted src/middleware.ts to the pristine
presence-only check from origin/main and reran src/middleware.test.ts;
4 of the 10 new tests went red (the hostile-cookie matrix, the
bad-portal-plus-valid-demo case, and both fail-closed cases), the other
6 stayed green (they only exercise cookie presence/absence, which the
old code also handled correctly). Restored src/middleware.ts from a
pristine copy taken before the mutation; diff against that copy showed
no difference; git status showed only the intended files changed before
committing.
