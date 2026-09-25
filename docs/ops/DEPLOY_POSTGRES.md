# Deploying AxlePoint on Postgres

Written ahead of the Neon project existing, so it is ready the moment it does.
**Nothing in here has been run against Neon.** Everything marked MEASURED was
verified against local Postgres 18; everything marked UNVERIFIED has not been,
and is called out where it matters.

**AxlePoint must not be redeployed until this has been completed once.** The
app has no SQLite fallback: `src/lib/pg.ts` throws without `DATABASE_URL`
rather than quietly using something else.

---

## 0. What you are building

| piece | where | why |
|---|---|---|
| `public.*` | the tenant tables, RLS forced | the live demo world |
| `pristine.*` | no RLS, no `tenant_id` | the copy the reset restores from |
| `ops.reset_log` | no RLS | survives the reset, so freshness is auditable |
| `axlepoint_app` | the app's role | neither superuser nor table owner |
| `demo_reset` | the scheduler's role | confined to the sample tenant by a RESTRICTIVE policy |

**No process runs as a superuser after step 2.** That is not hygiene: RLS does
not apply to a superuser at all -- not with `ENABLE`, not with `FORCE` -- so a
superuser connection makes every isolation policy in the schema inert
(MEASURED, D-022).

---

## 1. Create the Neon project (Drew)

Needs Drew's account. Nobody else can do this step.

- One project, one database.
- Keep the admin connection string for step 2 only. It is not a runtime
  credential and must not end up in an env file the app or sidecar reads.

**Neon's admin role is not a superuser.** That is fine and expected, and the
schema is written for it -- see the next step.

---

## 2. Apply the schema (as the Neon admin, once)

```bash
psql "$NEON_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
```

This creates the three schemas, both roles, the policies, and the pristine
tables. It is a **bootstrap for an empty database, not a migration**: it aborts
on a re-apply at `CREATE TABLE meta` (MEASURED). To re-run it you must drop the
schemas first:

```sql
DROP SCHEMA IF EXISTS ops CASCADE;
DROP SCHEMA IF EXISTS pristine CASCADE;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

### The one thing most likely to bite on Neon

`schema.sql` re-asserts the roles' security attributes with `ALTER ROLE`, and
**Postgres requires the altering role to HOLD each attribute it changes -- even
when setting the value it already has** (MEASURED: a `CREATEROLE`
non-superuser gets `Only roles with the SUPERUSER attribute may change the
SUPERUSER attribute`).

An unconditional `ALTER ROLE ... NOSUPERUSER NOBYPASSRLS` would therefore abort
the whole apply on a *correctly provisioned* Neon database. So the schema only
alters when something is actually wrong, and raises an actionable error when it
is wrong and cannot be fixed:

> `axlepoint_app holds privileges that defeat RLS (super=... bypassrls=...),
> and this role cannot remove them. Provision it without them, out of band,
> then re-apply.`

**UNVERIFIED on Neon.** If the apply fails here, the roles were created with
privileges Neon's admin cannot remove; create them without those privileges and
re-run. Do not "fix" it by granting the admin more rights.

### Set the role passwords out of band

`schema.sql` deliberately contains **no passwords** -- a credential in a
committed file is a credential in every clone and every CI log.

```sql
ALTER ROLE axlepoint_app PASSWORD '<generated>';
ALTER ROLE demo_reset    PASSWORD '<generated, different>';
```

Store them the way every other secret here is stored (`C:\Users\Drama\.secrets`,
owner-only ACL). Never in the repo, never in a compose file.

### Verify before moving on

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
 WHERE rolname IN ('axlepoint_app','demo_reset');
-- both rows must read f | f
```

---

## 3. Seed the data

```bash
DATABASE_URL="$NEON_ADMIN_URL" npm run db:generate
```

Writes `pristine.*`, then populates the live tenant **by running the demo
reset**. That is deliberate: seeding and resetting share one code path, so a
broken reset is visible now rather than six hours into production.

It prints what it stored, read back from the database rather than from what it
intended to write, and fails if any table's stored count differs from the count
it built.

Expect roughly (with a fresh time anchor the exact numbers move, the shape does
not):

```
assets 100, readings ~544k, anomalies ~1.2k, work orders 150,
parts 80, pm tasks 147, risk bands critical=4 high=8 medium=25 low=63
```

Sanity-check the distribution with the repo's own acceptance tools:

```bash
DATABASE_URL="$NEON_ADMIN_URL" npx tsx scripts/check-kpis.ts
DATABASE_URL="$NEON_ADMIN_URL" npx tsx scripts/inspect-db.ts
```

Sane is 3-6 critical assets, distinct top risk scores, MTBF delta within ±35%.

---

## 4. Wire the reset schedule -- NOT OPTIONAL

**D-012 promises that visitor-entered text cannot outlive one interval. Until
this step is live, that promise is not kept.** A reset that exists and is never
scheduled looks exactly like a reset that works: the pages render, the demo
behaves, and visitor data ages past its window in silence.

Create the sidecar's env file, **outside the repo**:

```
# axlepoint-reset.env  -- NEVER COMMIT THIS
DATABASE_URL=postgres://demo_reset:<password>@<neon-host>/<db>?sslmode=require
RESET_ALERT_WEBHOOK=<a destination a human actually reads>
```

Both are required. The script **refuses to start** without
`RESET_ALERT_WEBHOOK`, because the recurring version of this mistake is an
alert that fires correctly into a channel nobody reads. The opt-out exists and
is deliberately awkward; if you find yourself typing it in production, stop.

Use the `demo_reset` credential, **never the app's and never the admin's**. The
reset's `DELETE` carries no `WHERE` clause -- RLS is what scopes it -- so as a
superuser the same statement removes **every tenant's rows**. The script checks
`rolsuper`/`rolbypassrls` and refuses (MEASURED), but do not rely on that being
the only thing between you and a wipe.

Then bring the sidecar up as part of the edge stack:

```powershell
docker compose -f edge/docker-compose.yml `
               -f edge/docker-compose.prod.yml `
               -f <repo>/ops/reset-sidecar/compose.yml `
               up -d --no-deps axlepoint-reset
```

**Adding a service to the edge stack is a production change.** Both compose
files, never one alone. See `cloudflare-config/CLAUDE.md`.

**UNVERIFIED:** the sidecar image has not been built. `docker build` is
currently blocked earlier at `npm ci` with `E401` on `@paradigm-codes/auth`
(the `read:packages` scope, with Drew). Build it once before trusting it.

---

## 5. The gate: refuse to finish without a proven reset

```bash
DATABASE_URL=... npm run check:reset
```

This is the step that makes step 4 non-optional. It reads `ops.reset_log` and
**exits non-zero** unless the most recent run succeeded within
`RESET_MAX_AGE_HOURS` (default 6). It distinguishes three cases, because they
need different responses:

- **NEVER RAN** -- the schedule was never wired up. This is a deploy mistake
  and the deploy is not finished. Go back to step 4.
- **LAST RUN FAILED** -- the schedule works, the reset is broken. Read the
  recorded error.
- **STALE** -- the schedule stopped or is running too slowly. Visitor data is
  outliving its window right now.

**Do not mark the deploy complete while this fails.** A green app and a red
`check:reset` means the demo is serving data it promised to delete.

> Follow-up, not done here: `cloudflare-config/scripts/deploy-demo.ps1` should
> call this after a successful axlepoint deploy and fail the deploy on a
> non-zero exit. That is a change to another repo and belongs in its own PR.

---

## 6. Deploy the app

Unchanged from the existing demo procedure except that the container now
**requires** `DATABASE_URL` (the `axlepoint_app` credential) and ships no
database of its own. The image is stateless; there is no `data/` directory and
no seed file in it any more.

Verify the app is talking to Postgres at all, rather than rendering an empty
world convincingly:

```bash
curl -s https://axlepoint.projectnexuscode.org/app | grep -c "AST-"
# zero asset ids on a page that should list assets means the app reached a
# database with no rows -- which renders as a clean, empty, working-looking UI
```

---

## Troubleshooting

**Every page is empty and nothing errors.** The app connected to a database
with no rows for the `sample` tenant. Either step 3 was skipped, or a reset ran
against an empty `pristine` (the reset script fails on that, so check
`ops.reset_log` for a failure row).

**`permission denied for schema pristine`.** Correct and intended for
`axlepoint_app` -- it must not be able to read the pristine dataset. Only
`demo_reset` can.

**`new row violates row-level security policy "reset_sample_only"`.** The reset
credential tried to touch a tenant other than `sample`. That is the confinement
working, not a bug.

**A reset "succeeded" and the demo is blank.** The script fails on zero rows
restored, so this should be impossible; if it happens, `pristine` was emptied
after seeding. Re-run step 3.

---

## What this document does not cover

- **Migrations.** `db/schema.sql` is a bootstrap, not a migration tool. The
  first schema change against a database holding real tenants needs a migration
  story, and there is not one yet.
- **Backups.** Neon's own point-in-time recovery is the only thing standing
  behind this today. Nothing in this repo backs anything up.
- **More than one tenant.** The tenancy is real and enforced, but only the
  `sample` tenant is created. Provisioning a paying tenant is unwritten, and
  `src/lib/tenant.ts` still resolves every request to `sample`.
