# AxlePoint Industrial (demo)

Asset health and maintenance operations for heavy industry. A fictional
product demo built by Paradigm Coding Solutions as a portfolio piece:
predictive failure risk scoring over synthetic sensor telemetry, work order
management, preventive scheduling, parts inventory, and reporting for a
100-asset industrial fleet.

Live at https://axlepoint.projectnexuscode.org. Everything in it is
synthetic: sites, machines, people, parts, and every sensor reading.

## Stack

- Next.js 14 (App Router, standalone output), TypeScript, Tailwind CSS
- SQLite via better-sqlite3, generated at build time by a seeded,
  deterministic data generator
- Recharts for telemetry and reporting charts
- Rolling EWMA + z-score anomaly detection feeding a 0-100 failure risk
  score per asset, with per-sensor explanations

## Run it

```powershell
npm ci
npm run db:generate   # builds data/axlepoint.db (~30s, deterministic)
npm run dev           # http://localhost:3000
```

Production container:

```powershell
docker build -t demo-axlepoint .
docker run -p 8102:3000 demo-axlepoint
```

## Layout

- `scripts/generate-db.ts` - synthetic fleet generator (assets, telemetry,
  anomalies, work orders, parts, technicians, PM schedule)
- `src/lib/anomaly.ts` - EWMA detector shared by the generator and the UI
- `src/lib/risk.ts` - risk score aggregation and explanation factors
- `src/lib/queries.ts` - all SQLite access
- `src/app/page.tsx` - marketing landing
- `src/app/app/**` - the authenticated demo application
- `docs/demos/axlepoint/decisions.md` - design decision log

## Authentication

AxlePoint supports two parallel sign-in paths. Both land on the same
authenticated `/app` surface; the difference is who vouches for the user.

1. **Demo cookie (no portal involved).** The "Sign in as demo user" button
   on the marketing page POSTs to `/api/session`, which sets the
   `axle_demo_session=demo-user` cookie. This is the legacy
   no-credentials path, intended for portfolio browsing. It still works.
2. **Paradigm Portal handoff.** The Paradigm Portal mints a 60-minute
   RS256 JWT, redirects the user to AxlePoint with the token in the URL
   fragment (`#portal_token=<JWT>`), and a client-side claim component
   scrubs the fragment, POSTs the token to `/api/auth/portal-handoff`, and
   navigates to `/app` on success. The handoff route verifies the token
   against the portal's JWKS (cached locally, 1h fresh + 10m
   stale-while-revalidate per the portal contract) and sets the
   `axle_portal_session` cookie (HS256, 8h TTL).

The middleware accepts either cookie at the edge. The portal path is the
real authenticated session; the demo path stays available so demo-day
bookmarks keep working until every public touchpoint flows through the
portal.

Required env for the portal path (defaults shown in `.env.example`):

- `PORTAL_JWKS_URL`
- `PORTAL_EXPECTED_ISSUER`
- `PORTAL_EXPECTED_AUD`
- `AXLE_PORTAL_SESSION_SECRET` (32+ chars, required in deployed envs)

The contract this app implements is in
`portal-shell/docs/PORTAL_GATE_CONTRACT.md`.

## Tests

```powershell
npm test
```

Vitest covers `verifyPortalToken` (15 unit tests, including rotation
grace and stale-while-revalidate semantics) and the
`/api/auth/portal-handoff` route (8 integration tests, including the
503 path when the portal's JWKS endpoint is unreachable or
rate-limiting). No real network calls; an in-memory fake JWKS serves
keys generated per-test.

## Verification

The `verify/` directory holds the Paradigm Verify suite for this repo. It covers
the marketing page, the authenticated app surfaces, and the session/auth layer
(tier 3 -- see `verify/tier_map.yml`).

### Quick smoke (every PR)

`verify/smoke.yml` declares the fast surface checks that CI runs on every pull
request via `.github/workflows/verify.yml`. To run locally:

```powershell
bash verify/ci/quick_smoke.sh verify/smoke.yml
```

This curls every surface in `smoke.yml` and asserts `http_status`,
`header_present`, and `text_present`. Browser-only assertions
(`selector_present`, `no_console_errors`, etc.) are skipped in the fast pass
and covered by the deep run.

### Deep verify (tier-3 PRs)

Any PR that touches `middleware.ts`, `src/app/api/session/`,
`src/app/api/auth/portal-handoff/`, or `src/lib/portal-session.ts` must carry
the `tier-3` label. CI then requires a committed `verify/reports/` entry that
records `Overall: PASS` before the PR can merge. Run the local deep pass first:

```powershell
# from the /verify skill inside Claude Code
/verify deep C:\dev\demo-axlepoint
```

Or drive it directly:

```powershell
bash verify/ci/deep_gate.sh
```

The deep pass runs all assertions in `verify/assertions/*.yml`, including
`no_console_errors`, `lcp_under_ms`, and `axe_no_critical` (headless), plus
layers 5-6 (headed Chrome via Windows MCP) when run locally.

### CI workflow

`.github/workflows/verify.yml` runs two jobs:

- `quick-verify` -- runs on every PR; executes `verify/ci/quick_smoke.sh`
- `deep-verify` -- runs only on PRs labeled `tier-3`; runs after
  `quick-verify` and enforces the committed report gate via
  `verify/ci/deep_gate.sh`

To block merges on a failing deep-verify, add `"deep-verify"` as a required
status check in the branch protection rule for `main`.

### Surface inventory

| Surface | Route | Tier |
|---|---|---|
| home | / | 1 |
| dashboard | /app | 1 |
| assets | /app/assets | 1 |
| work-orders | /app/work-orders | 2 |
| session-signin | POST /api/session | 3 |
| portal-handoff | POST /api/auth/portal-handoff | 3 |
| unauthenticated-redirect | /app (no cookie) | 3 |

---

## The ML story

The demo's detector is a rolling statistical model (EWMA mean and variance
per sensor channel, z-score thresholding at 3.5 sigma, severity-weighted
aggregation into an explainable risk score). A production deployment would
replace the detector with a trained sequence model on historical failure
data behind the same scoring interface; the UX, explanation panel, and
work-order drafting flow stay as they are.
