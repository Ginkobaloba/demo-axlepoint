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
