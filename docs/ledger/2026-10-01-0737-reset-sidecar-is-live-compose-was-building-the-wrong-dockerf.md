# 2026-10-01 07:37 CDT - Reset sidecar is live; compose was building the wrong Dockerfile
- **Who:** Claude (AxlePoint session)
- **Change:** The reset sidecar is running and `check:reset` is green. Created
  `C:\Users\Drama\.secrets\axlepoint_reset.local.txt` (owner-only ACL, no BOM) with
  the `demo_reset` DATABASE_URL, `RESET_ALERT_SLACK_TOKEN` and
  `RESET_ALERT_SLACK_CHANNEL=D0C2YKLSTLM`. Built `demo-axlepoint-reset:latest` with
  `--target reset`. Changed `ops/reset-sidecar/compose.yml` from a `build:` to a
  prebuilt `image:` with `pull_policy: never`, removed the now-dead top-level
  `secrets:` block, and documented the build and both verification steps in
  `docs/ops/DEPLOY_POSTGRES.md`.
- **Why:** The fragment's `build: {context: ../.., target: reset}` does not work for
  the invocation the fragment itself documents, and it failed dangerously rather
  than cleanly. **Compose resolves `build.context` relative to the PROJECT
  DIRECTORY -- the directory of the first `-f` file -- not relative to the fragment
  that declares it.** Merged into the edge stack as documented, `../..` resolved to
  `C:\dev` instead of this repository, so the build read `C:\dev\Dockerfile` and
  died with "the Dockerfile cannot be empty".
  **That stray file being 0 bytes is the only reason this was loud.** Had it
  contained anything valid, compose would have built a completely different image
  and run it here -- as the process holding the `demo_reset` credential, whose
  `DELETE` carries no `WHERE` clause and relies on RLS to scope it. Do NOT tidy
  `C:\dev\Dockerfile` away: it is currently load-bearing, and deleting it makes the
  next fragment with a stale `build:` silent instead of noisy. Flagged to the
  cloudflare-config owner.
  Compose now never builds, which matches every other edge service: the image is
  built deliberately with an explicit context, and compose runs it.
  Also recorded, because it nearly produced a false "done": **`check:reset` green
  does not prove the alert path.** `alert()` fires only on failure, so a healthy
  reset is silent and a green freshness check is indistinguishable from completely
  dead alerting. The alert was therefore exercised on purpose, with a negative
  control first.
- **State after:** VERIFIED, measured:
  - sidecar `Up`, image `demo-axlepoint-reset:latest`, logs show
    `reset tenant "sample": removed 545927 rows, restored 545927, in 9924ms`
  - `check:reset` -> `ok: last reset 0.0h ago, restored 545927 rows (limit 6h)`,
    **exit 0** (was `STALE: 57.4h ago` against a 6h limit)
  - alert path, both controls:
    `negative control -> delivered=false, "chat.postMessage returned HTTP 200 but ok=false (invalid_auth)"`
    `positive control -> delivered=true, "chat.postMessage ok"`
    One real message landed in Drew's DM saying nothing is wrong and why it was
    sent. The negative control is the point: **Slack really does answer HTTP 200
    for an invalid token**, so code checking the HTTP status would have reported a
    dead token as a delivered alert. D-031's module exists for exactly this and it
    is now measured rather than argued.
  - the token was never printed; the control prints `<set, not printed>` and the
    delivery `detail` strings carry Slack error codes only
  Still open, unchanged by this entry: paradigm-site PR #117's own alert path. The
  uptime Worker expects `SLACK_WEBHOOK_ALERTS` as a `hooks.slack.com` URL POSTed
  with `{text}` and no auth -- the same protocol the reset script used to have, and
  there is no such URL on this host. So that Worker's alerting has probably never
  worked since its single deploy on 2026-09-17. The fix is the same conversion
  D-031 made here, as a separate PR, not started.
- **Refs:** ops/reset-sidecar/compose.yml, docs/ops/DEPLOY_POSTGRES.md,
  src/lib/reset-alert.ts, docs/demos/axlepoint/decisions.md D-031,
  scripts/check-reset-freshness.ts, scripts/deploy-demo.ps1 (the npmrc secret and
  its scope guard), PR #55, paradigm-site PR #117
