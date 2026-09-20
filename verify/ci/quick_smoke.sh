#!/usr/bin/env bash
# Quick smoke -- curl each surface in verify/smoke.yml and assert status, headers,
# and body text. Portable: no project runtime needed, so it runs in CI on
# ubuntu-latest and locally the same way. This is the real work behind the
# "quick verify on every PR" gate. Layers that need a browser (selector_present,
# axe, lcp) are skipped here and covered by the deep verify.
#
# redirects_to is NOT one of those layers. curl already follows redirects and
# reports the URL it ended on, so the assertion is checkable here, and it has
# to be: it used to fall through to the skip branch below, which meant every
# redirect assertion in verify/smoke.yml silently proved nothing.
#
# A surface that redirects but declares no redirects_to assertion is a
# structural gap, not a passing surface: curl -L quietly follows the
# redirect, and every text_present/header_present assertion below would then
# run against the page it landed on instead of the page the surface names.
# That is invisible from reading the config, and it stays green right up
# until the day a surface that used to be direct starts redirecting. Guard
# it here: if the landed URL differs from the requested one and this surface
# declares no redirects_to assertion, fail before any other assertion runs,
# so nothing downstream can pass against the wrong page.
set -uo pipefail

SMOKE="${1:-verify/smoke.yml}"
if [ ! -f "$SMOKE" ]; then echo "No $SMOKE found"; exit 1; fi
if ! command -v yq >/dev/null 2>&1; then echo "yq is required"; exit 1; fi

deploy_url="$(yq -r '.deploy_url' "$SMOKE")"
case "$deploy_url" in
  *example*|*"<"*|""|null)
    echo "deploy_url is a placeholder ($deploy_url) -- no public deploy configured."
    echo "Skipping live smoke (neutral pass). Fill deploy_url in verify/smoke.yml to enable."
    exit 0;;
esac
deploy_url="${deploy_url%/}"

fail=0
count="$(yq -r '.surfaces | length' "$SMOKE")"
for i in $(seq 0 $((count-1))); do
  name="$(yq -r ".surfaces[$i].name" "$SMOKE")"
  url="$(yq -r ".surfaces[$i].url" "$SMOKE")"
  case "$url" in http*) full="$url";; *) full="${deploy_url}${url}";; esac
  echo "== surface: $name ($full)"
  hdr="$(mktemp)"; bdy="$(mktemp)"
  # Capture the landing URL alongside the status. -L is already on, so
  # %{url_effective} is where the redirect chain ended; a URL never contains
  # a literal space, so a single space is a safe separator.
  probe="$(curl -sS -L -o "$bdy" -D "$hdr" -w '%{http_code} %{url_effective}' "$full")" || { echo "  FAIL curl error"; fail=1; rm -f "$hdr" "$bdy"; continue; }
  code="${probe%% *}"
  # `landed` is where the request ENDED UP, and the two fleets derive it
  # differently ON PURPOSE (agreed 2026-09-20, demos <-> portal-shell):
  #   - Here: `curl -L` follows redirects, so the body the assertions run
  #     against IS the final destination's, and %{url_effective} names the
  #     page that was actually tested.
  #   - portal-shell: `-L` was dropped because its `redirects_to`
  #     implementation needs the raw first response, so `landed` comes from
  #     the Location header and names the FIRST hop -- where the request
  #     would have gone, not where anything was tested.
  # Identical for a single hop; they differ on a redirect CHAIN (last hop
  # here, first hop there). This is a DECLARED divergence, not drift.
  # Converging the message strings without aligning the semantics would be
  # a surface match; true convergence means agreeing whether to follow, and
  # then the strings match for free.
  landed="${probe#* }"
  acount="$(yq -r ".surfaces[$i].assertions | length" "$SMOKE")"
  if yq -r ".surfaces[$i].assertions[].type" "$SMOKE" | grep -qx redirects_to; then redirect_declared=1; else redirect_declared=0; fi
  if [ "$redirect_declared" = "0" ] && [ "$landed" != "$full" ]; then
    echo "  FAIL undeclared redirect: requested $full, landed on $landed. Declare a redirects_to assertion for this surface's expected destination, or point its url at $landed directly."
    fail=1
    rm -f "$hdr" "$bdy"
    continue
  fi
  for j in $(seq 0 $((acount-1))); do
    atype="$(yq -r ".surfaces[$i].assertions[$j].type" "$SMOKE")"
    case "$atype" in
      http_status)
        exp="$(yq -r ".surfaces[$i].assertions[$j].expect" "$SMOKE")"
        if [ "$code" = "$exp" ]; then echo "  ok http_status=$code"; else echo "  FAIL http_status expected $exp got $code"; fail=1; fi;;
      header_present)
        h="$(yq -r ".surfaces[$i].assertions[$j].header" "$SMOKE")"
        if grep -iq "^$h:" "$hdr"; then echo "  ok header $h"; else echo "  FAIL missing header $h"; fail=1; fi;;
      text_present)
        t="$(yq -r ".surfaces[$i].assertions[$j].text" "$SMOKE")"
        if grep -qF "$t" "$bdy"; then echo "  ok text present"; else echo "  FAIL missing text: $t"; fail=1; fi;;
      redirects_to)
        exp="$(yq -r ".surfaces[$i].assertions[$j].expect" "$SMOKE")"
        # Accept either convention in use across the demo repos: a fully
        # qualified URL or a bare path, resolved against deploy_url.
        case "$exp" in /*) exp="${deploy_url}${exp}";; esac
        if [ "$landed" = "$exp" ]; then echo "  ok redirects_to $exp"; else echo "  FAIL redirects_to expected $exp got $landed"; fail=1; fi;;
      *) echo "  skip $atype (browser-layer, covered in deep verify)";;
    esac
  done
  rm -f "$hdr" "$bdy"
done
exit $fail
