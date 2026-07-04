# demo-axlepoint: Project-local AI instructions

Read these on top of the global CLAUDE.md and `C:\dev\SESSION_PROTOCOL.md`.

## What this repo is

AxlePoint Industrial: a fictional predictive maintenance product, built as
a Paradigm Coding Solutions portfolio demo. Live at
https://axlepoint.projectnexuscode.org (<HOST> host port 8102, deployed
via `cloudflare-config\scripts\deploy-demo.ps1`).

Origin spec: the demo handoff `HANDOFF_20260609_demomaintenancemanagement.md`
(Dispatch upload). Cross-demo coordination: `C:\dev\DEMOS_RUNNING_HANDOFF.md`.

## Hard constraints

- **All data is synthetic and must stay that way.** No real manufacturers,
  engine model names, customers, installations, or people. No Fairbanks
  Morse references anywhere in code, data, or copy.
- **No em dashes anywhere.** Double-dashes, parens, or commas.
- **Demo dates rule:** never let mock dates land near real personal dates
  (see the paradigm-site 2026-06-10 incident; fixtures there use 2098/2099).
  This repo's data is generated relative to build time, which is fine; any
  hardcoded date must be obviously synthetic.
- Brand system: forest green #1f5a44, cream #f7f5f0, ink #1a1a1a, gold
  #c89c47; risk colors low #2d8c5a / medium #c89c47 / high #b65d3e /
  critical #8c2e1f. IBM Plex Sans + Mono.
- Paradigm banner follows the contract in `cloudflare-config/banner/README.md`.

## Architecture notes

- DB is generated at build time (`npm run db:generate`), deterministic
  except the time anchor. Never commit `data/`.
- The EWMA detector (`src/lib/anomaly.ts`) and risk scoring
  (`src/lib/risk.ts`) are shared between the generator and the UI; if you
  change one, regenerate and re-check the band distribution with
  `npx tsx scripts/inspect-db.ts` and `npx tsx scripts/check-kpis.ts`
  (sane: 3-6 critical, distinct top scores, MTBF delta within +/-35%).
- Design decisions log: `docs/demos/axlepoint/decisions.md`. Add an entry
  for anything a reviewer would ask "why" about.

## Deploy

```powershell
cd C:\dev\cloudflare-config
.\scripts\deploy-demo.ps1 -Name axlepoint -ContextPath C:\dev\demo-axlepoint -InternalPort 3000 -VerifyContent "AxlePoint"
```

Local verification uses port 3105 (registered in `C:\dev\.claude\launch.json`;
3000 is contended with sibling demo sessions).

## Handoffs

End every session with a handoff in `docs/handoffs/HANDOFF_YYYY-MM-DD_*.md`
including the "Next Session Onboarding" section.
