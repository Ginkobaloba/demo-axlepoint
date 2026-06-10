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

## The ML story

The demo's detector is a rolling statistical model (EWMA mean and variance
per sensor channel, z-score thresholding at 3.5 sigma, severity-weighted
aggregation into an explainable risk score). A production deployment would
replace the detector with a trained sequence model on historical failure
data behind the same scoring interface; the UX, explanation panel, and
work-order drafting flow stay as they are.
