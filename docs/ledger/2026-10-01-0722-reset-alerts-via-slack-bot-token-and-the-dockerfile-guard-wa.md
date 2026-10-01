# 2026-10-01 07:22 CDT - Reset alerts via Slack bot token; and the Dockerfile guard was CRLF-fragile
- **Who:** Claude (AxlePoint session)
- **Change:** Two things, one PR.
  (1) New `src/lib/reset-alert.ts` + `src/lib/reset-alert.test.ts`: resolves the
  alert destination from the environment and delivers over either a Slack
  incoming webhook or `chat.postMessage` with a bot token
  (`RESET_ALERT_SLACK_TOKEN` + `RESET_ALERT_SLACK_CHANNEL`). `scripts/reset-demo.ts`
  now uses it; its local webhook-only `alert()` and `OPTOUT` const are gone.
  (2) Fixed `scripts/dockerfile-stages.test.mjs`, which was silently
  platform-dependent, and added two regression tests for it.
- **Why:** (1) Drew chose "Slack via the Daedalus bot" as the reset alert
  destination, which was not directly implementable: the script POSTed the bare
  value of `RESET_ALERT_WEBHOOK` with `{text}` and NO auth header (an incoming
  webhook), while the credential on the host is a bot token and
  `_scripts\slack-daedalus.ps1` posts via `chat.postMessage` with
  `Authorization: Bearer` plus a `channel`. He was given the blast-radius argument
  (a leaked webhook URL posts to one channel; a leaked bot token posts as the bot
  anywhere it is a member and reads history with the scopes already on it) and
  chose the bot token anyway to avoid a Slack-admin step. Recorded as his call in
  D-031. Mitigated inside it: the token is never logged or put in an error string
  (asserted), stays out of the repo, and the channel is `D0C2YKLSTLM`, the DM with
  Drew the Daedalus wrapper already defaults to, so the alert lands where a human
  demonstrably reads. A chat:write-only token would be the real mitigation and
  cannot be minted without him.
  The transport is its own module because `chat.postMessage` refuses with **HTTP
  200** and `{"ok": false, "error": "..."}`. Checking `res.ok`, which is right for
  a webhook, would have reported a delivered alert for a revoked token, a wrong
  channel, or a bot removed from the channel -- a false pass in the one code path
  whose whole job is to speak up when something else failed.
  A half-set bot credential refuses by name rather than falling through to "no
  destination", including when the opt-out is also present, so a stray opt-out
  cannot mask a misconfiguration.
  (2) The Dockerfile guard added yesterday (PR #54) returned null from
  `lastStageCmd` on this machine. Cause: `file Dockerfile` reports **CRLF**
  terminators, git having normalised to LF in the index and converted back on
  checkout after the merge. The parser split on a bare newline, leaving a trailing
  carriage return; the CMD regex ends in `$` and in JavaScript `.` does not match a
  carriage return, so the capture never matched. The `FROM` regex has no `$`, which
  is why stage NAMES still parsed and only the CMD assertion broke. The Linux
  runner checks out LF, so **CI was green while the local run was red** -- the
  guard against a 2.5-day outage held on one platform only, and the platform that
  reported green was the one nobody doubted.
- **State after:** `npx tsc --noEmit` exit 0; `npm test` **178 passed / 18 files**
  (was 157/17); `npm run lint` 0 errors (5 pre-existing warnings in grandfathered
  files); `node scripts/check-decisions.mjs` 31 ids, 0 problems.
  Mutation-checked both ways: reverting `LINES` from `/\r?\n/` to `/\n/` failed
  exactly the 2 new CRLF tests, and the file was restored byte-identical (`cmp`).
  The alert tests carry the control that matters -- HTTP 200 with `ok:false` must
  read as UNDELIVERED -- plus `channel_not_found`, `not_in_channel`,
  `token_revoked`, a non-JSON 200, a 200 with no `ok` field, a thrown transport
  error, and an assertion that no reported detail ever contains the token.
  NOT DONE YET, and deliberately after the PR: `axlepoint-reset.env` is not
  written and the sidecar is not running, so `check:reset` is still RED (57.4h+
  against a 6h limit). Nothing is deployed by this entry.
  (3) Also in this PR, found while preparing to create the file: the sidecar's
  documented credential location was unsafe on this host. `ops/reset-sidecar/compose.yml`
  said `./axlepoint-reset.env`, i.e. inside the repo. `.gitignore` matches
  `.env*.local`, which does NOT match `axlepoint-reset.env` -- `git check-ignore`
  confirmed the path was not ignored, so the credential was one `git add -A` from
  being committed. And Google Drive for desktop two-way mirrors C:\dev, so anything
  secret under this tree is uploaded and the Drive copy outlives a local delete.
  Changed the compose fragment to read
  `${EDGE_SECRETS_DIR:-C:/Users/Drama/.secrets}/axlepoint_reset.local.txt`, the same
  indirection the edge compose already uses for demo_env_axlepoint.local.txt; added
  defensive .gitignore patterns so a file created in the old spot still cannot be
  committed; and corrected docs/ops/DEPLOY_POSTGRES.md, which was sending the next
  person to the unsafe path.
- **Refs:** src/lib/reset-alert.ts, src/lib/reset-alert.test.ts,
  scripts/reset-demo.ts, scripts/dockerfile-stages.test.mjs,
  docs/demos/axlepoint/decisions.md D-031, ops/reset-sidecar/compose.yml (credential path), .gitignore,
  docs/ops/DEPLOY_POSTGRES.md,
  _scripts/slack-daedalus.ps1 (the proven chat.postMessage shape and the
  D0C2YKLSTLM default), PR #54 (the guard this fixes)
