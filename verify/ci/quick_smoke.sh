#!/usr/bin/env bash
# Quick smoke -- curl each surface in verify/smoke.yml and assert status, headers,
# and body text. Portable: no project runtime needed, so it runs in CI on
# ubuntu-latest and locally the same way. This is the real work behind the
# "quick verify on every PR" gate. Layers that need a browser (selector_present,
# axe, lcp) are skipped here and covered by the deep verify.
#
# redirects_to is NOT one of those layers. curl already follows redirects and
# reports the URL it ended on, so the assertion is checkable here, and it has
# to be: the gated surfaces assert that an anonymous client is bounced to the
# sign-in page, and an assertion that silently skips proves nothing. It used
# to fall through to the skip branch below.
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
  landed="${probe#* }"
  acount="$(yq -r ".surfaces[$i].assertions | length" "$SMOKE")"
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
        # Accept either convention already in use across the demo repos: a
        # bare path (this repo) or a fully-qualified URL (lumen-analytics,
        # demo-slatewell). A path is resolved against deploy_url.
        case "$exp" in /*) exp="${deploy_url}${exp}";; esac
        if [ "$landed" = "$exp" ]; then echo "  ok redirects_to $exp"; else echo "  FAIL redirects_to expected $exp got $landed"; fail=1; fi;;
      *) echo "  skip $atype (browser-layer, covered in deep verify)";;
    esac
  done
  rm -f "$hdr" "$bdy"
done
exit $fail
