# 2026-09-25 14:00 CDT - Go-live handoff and deferred-work backlog
- **Who:** Claude (Opus 5), on Drew's redirect to customer-facing completion.
- **Change:** `docs/handoffs/HANDOFF_2026-09-25_axlepoint-go-live.md` -- a
  9-step checklist from Drew's two actions to a customer-usable demo, each step
  with its own verification. Companion backlog at
  `C:\dev\DEMOS_POSTGRES_BACKLOG.md`.
- **Why:** Drew is compacting every session and restarting lean, so the path to
  live has to survive with no context carried over. **No code is needed for
  go-live** -- only `gh auth refresh -s read:packages` and a Neon project,
  both his.
- **State after:** every claim in it is either merged or a command. The two
  steps that are UNVERIFIED against Neon are marked as such in place rather
  than implied to work: the conditional `ALTER ROLE` (Neon's admin is not a
  superuser, and Postgres requires the altering role to hold each attribute it
  changes, even when setting a value it already has), and the reset sidecar
  image, which has never been built because `npm ci` is blocked on
  read:packages.
- **Also checked, at the Orchestrator's request:** trap 10
  (generateStaticParams over tenant data, which would silently make the build
  require a database). Only harborbistro had it, already fixed. axlepoint is
  clean and its database-free build re-verified at 25.5s.
- **Refs:** D-022..D-027, `docs/ops/DEPLOY_POSTGRES.md`, cloudflare-config #36
  and #40.
