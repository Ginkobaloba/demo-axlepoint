# 2026-09-25 07:32 CDT - Scratch-database identity guard, and a verified dev-db bring-up
- **Who:** Claude (Opus 5), at the Orchestrator's request after the harborbistro near-miss.
- **Change:** `src/lib/scratch-db-guard.ts` refuses to drop schemas in a
  database whose `public` schema holds tables this project does not define.
  Wired into every place that drops. `scripts/dev-db.mjs` (`npm run db:dev`)
  brings the dev database up and PROVES you are talking to it.
- **Why:** A `docker run -p` binding SILENTLY FAILED; the port belonged to
  another session's Postgres; the suite connected there over TCP and was
  refused only because the password differed. Had it matched, it would have run
  DROP SCHEMA public CASCADE on their data. **The old guard checked the URL for
  "prod"/"neon"/"portal" -- a SMELL, not an IDENTITY** -- and "another
  developer's scratch database on localhost" passes that perfectly.
- **State after:** guard proven by negative control -- planting one unfamiliar
  table makes every suite refuse, naming it, and the run exits non-zero; the
  suites pass normally against their own database.
  The table list is DERIVED from db/schema.sql, never hand-maintained: a
  hardcoded list is the same failure as the hand-copied DROP list that broke
  every caller twice, correct until someone adds a table.
- **The bring-up checks what actually failed.** `docker exec psql` kept
  working throughout the incident, because that uses the container's own
  socket; only TCP went elsewhere. So db:dev reads the PUBLISHED PORT back out
  of `.NetworkSettings.Ports` (a failed binding leaves the key present and
  empty), then connects over TCP and asks the database to identify itself.
  Verified against a container started with no -p flag: the check fires.
- **Refs:** demo-harborbistro #52; fleet memory shared-dev-postgres-identity-guard.
