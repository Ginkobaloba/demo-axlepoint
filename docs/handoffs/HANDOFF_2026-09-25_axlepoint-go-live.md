# AxlePoint go-live: from Drew's two actions to a customer-usable demo

Written 2026-09-25 for a session starting with no context. Everything below is
either already merged or is a command to run. **Nothing here needs code
written.**

## Next Session Onboarding

1. Read `C:\dev\SESSION_PROTOCOL.md`.
2. Read `C:\dev\demo-axlepoint\CLAUDE.md`.
3. Read this handoff.
4. Read `docs/ops/DEPLOY_POSTGRES.md` -- the runbook this checklist drives.
5. Run `C:\dev\_scripts\session-start.ps1`.

---

## The state in one paragraph

AxlePoint is fully ported to Postgres and merged to main: schema with per-tenant
RLS (D-022), hardened after independent review (D-023), the query layer
type-driven async (D-024), the seed generator proven row-identical against the
old SQLite one (D-025), the demo reset with a confined role (D-026), and the
deploy runbook plus reset schedule (D-027). 122 unit tests and 61 integration
tests pass in CI. **It has never been deployed on Postgres**, because two things
are missing and both are Drew's.

## What is blocking, and it is only these two

| # | blocker | who | unblocks |
|---|---|---|---|
| 1 | `gh auth refresh -h github.com -s read:packages` | **Drew** | every demo image build (`npm ci` needs `@paradigm-codes/auth` from GitHub Packages) |
| 2 | A Neon project for AxlePoint (not the portal's) | **Drew** | everything below step 2 |

Nothing else is waiting on anything. There is no code left to write for go-live.

---

## The checklist

Each step says how to know it worked. **Stop at the first one that does not.**

### 1. Drew grants the packages scope

```powershell
gh auth refresh -h github.com -s read:packages
```

Verify: `gh auth status` lists `read:packages` in Token scopes.

> If you skip this, the image build fails at `npm ci` with `E401` on
> `@paradigm-codes/auth`. `deploy-demo.ps1` now catches it BEFORE the build
> starts (cloudflare-config #36) and prints this exact command.

### 2. Drew creates the Neon project

One project, one database. Keep the admin connection string for step 3 **only**;
it is not a runtime credential.

Verify: `psql "$NEON_ADMIN_URL" -c "select current_database()"` answers.

### 3. Apply the schema (once, as the Neon admin)

```bash
psql "$NEON_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
```

Verify:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
 WHERE rolname IN ('axlepoint_app','demo_reset');
-- both rows must read f | f
```

> **The step most likely to behave differently on Neon**, and it is UNVERIFIED
> there. Postgres requires the altering role to HOLD each attribute it changes,
> even when setting a value it already has, and Neon's admin is not a superuser.
> The schema only alters when something is actually wrong, so a correctly
> provisioned database should pass straight through. If it raises
> `axlepoint_app holds privileges that defeat RLS`, provision the roles without
> those privileges out of band and re-apply. **Do not grant the admin more
> rights to make it pass.**

### 4. Set the role passwords out of band

```sql
ALTER ROLE axlepoint_app PASSWORD '<generated>';
ALTER ROLE demo_reset    PASSWORD '<generated, different>';
```

Store in `C:\Users\Drama\.secrets` (owner-only ACL). `db/schema.sql` deliberately
contains no passwords.

### 5. Seed the data

```bash
DATABASE_URL="$NEON_ADMIN_URL" npm run db:generate
```

Verify: it prints counts read back **from the database** and fails if any table's
stored count differs from what it built. Expect roughly assets 100,
readings ~544k, anomalies ~1.2k, work orders 150, parts 80, pm tasks 147, and
`critical=4` in the risk bands.

Sanity-check the distribution (CLAUDE.md's own criteria: 3-6 critical, distinct
top scores, MTBF delta within +/-35%):

```bash
DATABASE_URL="$NEON_ADMIN_URL" npx tsx scripts/check-kpis.ts
```

### 6. Wire the reset schedule -- NOT OPTIONAL

**D-012 promises visitor text cannot outlive one interval. Until this runs, that
promise is not kept.**

Create `axlepoint-reset.env` **outside the repo**:

```
DATABASE_URL=postgres://demo_reset:<password>@<neon-host>/<db>?sslmode=require
RESET_ALERT_WEBHOOK=<somewhere a human actually reads>
```

Both are required; the script refuses to start without the webhook. Use the
`demo_reset` credential, never the app's and never the admin's -- the reset's
DELETE carries no WHERE clause and RLS is the only thing scoping it.

```powershell
docker compose -f edge/docker-compose.yml `
               -f edge/docker-compose.prod.yml `
               -f C:\dev\demo-axlepoint\ops\reset-sidecar\compose.yml `
               up -d --no-deps axlepoint-reset
```

> Adding a service to the edge stack is a **production change**. Both compose
> files, never one alone.
>
> **UNVERIFIED:** the sidecar image has never been built (blocked by #1).

### 7. Deploy the app

```powershell
cd C:\dev\cloudflare-config
.\scripts\deploy-demo.ps1 -Name axlepoint -ContextPath C:\dev\demo-axlepoint -InternalPort 3000 -VerifyContent "AxlePoint"
```

The container now **requires** `DATABASE_URL` (the `axlepoint_app` credential)
and ships no database of its own.

### 8. The gate decides whether you are finished

`deploy-demo.ps1` runs this itself and **fails the deploy** on `NEVER_RAN`,
`FAILED`, `STALE`, or "could not run" (cloudflare-config #40). To run it by hand:

```bash
DATABASE_URL=... npm run check:reset
```

**A green app with a red `check:reset` means the demo is serving data it
promised to delete.** Do not call the deploy done.

### 9. Confirm a customer can actually use it

```bash
curl -s https://axlepoint.projectnexuscode.org/app | grep -c "AST-"
```

Zero asset ids on a page that lists assets means the app reached a database with
**no rows** -- which renders as a clean, empty, working-looking UI. That is the
failure this check exists for.

---

## If something is wrong

| symptom | meaning |
|---|---|
| every page empty, nothing errors | connected to a database with no rows for the `sample` tenant; step 5 skipped, or a reset ran against an empty `pristine` |
| `permission denied for schema pristine` | correct and intended for `axlepoint_app`; only `demo_reset` may read it |
| `new row violates row-level security policy "reset_sample_only"` | the reset credential tried to touch a tenant other than `sample`. The confinement working, not a bug |
| `npm ci` fails `E401` | blocker #1 |
| `check:reset` says NEVER_RAN | step 6 was skipped |

## What go-live does NOT include

- **Only the `sample` tenant exists.** `src/lib/tenant.ts` resolves every
  request to it. Multi-tenant *enforcement* is done and tested; multi-tenant
  *onboarding* is not designed. See the backlog.
- **No migration story.** `db/schema.sql` is a bootstrap, not a migration tool.
- **No backups beyond Neon's own PITR.**
