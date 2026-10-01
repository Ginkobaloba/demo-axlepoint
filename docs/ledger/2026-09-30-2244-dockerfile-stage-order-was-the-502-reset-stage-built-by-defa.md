# 2026-09-30 22:44 CDT - Dockerfile stage order was the 502: reset stage built by default
- **Who:** Claude (AxlePoint session)
- **Change:** Moved the `reset` stage above `run` in the Dockerfile so `run` is the
  last stage again, and added `scripts/dockerfile-stages.test.mjs` to assert that
  ordering mechanically. No change to the stages themselves and none to
  cloudflare-config/scripts/deploy-demo.ps1.
- **Why:** `docker build` with no `--target` builds the LAST stage in the file.
  `deploy-demo.ps1:303` runs `docker build -q -t <image>:candidate <context>` with no
  target, because it is shared by four demos and cannot name a stage only this
  Dockerfile has. When the reset sidecar was added at the end of the file,
  `demo-axlepoint:latest` silently became the sidecar: the deployed container ran
  `while true; do npm run db:reset; done`, reported "Up", held 127.0.0.1:8102, and
  never listened on :3000. nginx and the tunnel returned a correct 502.
  Verified, not inferred: `docker inspect` showed
  `Cmd=["sh","-c","while true; do npm run db:reset ..."]` on the running container;
  the only listening socket inside was 127.0.0.11:43255 (Docker's DNS resolver);
  `curl http://127.0.0.1:8102/app` returned 000 while the proxy and the public URL
  both returned 502. Down since the 2026-09-28 13:31 CDT deploy, about 2.5 days.
  The "Up 27 hours" on all eleven edge containers is a Docker Desktop restart at
  2026-09-30 00:20 UTC, not the onset.
  Alternative considered and rejected: pass `--target run` from deploy-demo.ps1.
  That script deploys four demos and a sibling without a `run` stage would start
  failing, so the fix would move the fragility rather than remove it. Reordering
  makes the correct artifact the default, which is where a default belongs.
  The test carries a positive control: it parses a synthetic Dockerfile with the
  stages in the WRONG order and asserts the parser reports `reset`, so it would
  have caught this layout rather than merely agreeing with the current one. The
  real-file assertions were also mutation-checked: reordering the committed
  Dockerfile failed exactly 2 of 6 tests, and the file was restored byte-identical
  (`cmp`).
- **State after:** Dockerfile `run` is last; `npm test` 157 passed / 17 files;
  `npm run lint` 0 errors (5 pre-existing warnings in grandfathered files).
  The image has NOT been rebuilt or redeployed as of this entry, so the demo is
  still 502 -- the rebuild is the next step and this entry will not be edited to
  say otherwise.
  Separate and still open, NOT caused by this: (1) `deploy-demo.ps1` reported
  "Deploy failed: Container demo-axlepoint Recreate" and exited 1 although the
  recreate had succeeded, which aborted the run before `-VerifyContent` -- the one
  gate that would have caught the wrong image. PS 5.1 surfaces native stderr as
  NativeCommandError and compose writes progress to stderr. cloudflare-config
  scope, not fixed here. (2) The reset sidecar still has no
  `RESET_ALERT_WEBHOOK`, so it refuses to start and `check:reset` is red; the
  destination is Drew's call and has been put to him.
- **Refs:** Dockerfile, scripts/dockerfile-stages.test.mjs,
  cloudflare-config/scripts/deploy-demo.ps1:303, ops/reset-sidecar/compose.yml
  (pins `target: reset`, so it is unaffected), docs/demos/axlepoint/decisions.md
