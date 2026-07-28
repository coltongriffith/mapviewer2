#!/usr/bin/env bash
# Live verification for the US/BLM claim path. Run from a network that can reach
# gis.blm.gov and data-ndom.opendata.arcgis.com.
#
#   bash scripts/verify-us-claims-live.sh
#
# Every check prints VERIFIED / FAILED / INCONCLUSIVE and the evidence, so the
# result can be pasted into docs/us-claims.md ("Findings"). Nothing here writes
# to the repo or to any service — all four checks are read-only GETs.
#
# Why this exists as a script: these four facts currently rest on documentation
# rather than live data, and docs/us-claims.md marks them as such. They block
# merge. The environment the code was written in had all outbound hosts denied
# by egress policy, so they could not be settled there.

set -uo pipefail

# Resolve paths against THIS script's location, not the caller's cwd.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANARY="$HERE/live-schema-canary.mjs"

BLM="${BLM_MLRS_SERVICE_URL:-https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer}"
LAYER="$BLM/0"
UA='ExplorationMaps-verify/1.0'
pass=0; fail=0; inconc=0
hr() { printf '\n%s\n' '────────────────────────────────────────────────────────────'; }
ok()   { echo "✅ VERIFIED-LIVE: $1"; pass=$((pass+1)); }
bad()  { echo "❌ FAILED: $1"; fail=$((fail+1)); }
meh()  { echo "⚠️  INCONCLUSIVE: $1"; inconc=$((inconc+1)); }

hr
echo "CHECK 1 — Nevada serial prefix: does UPPER(CSE_NR) LIKE 'NV%' return rows?"
echo "(Settles whether the degraded serial-prefix fallback actually works for NV,"
echo " and whether MLRS serials really carry the two-letter state code.)"
echo
URL1="$LAYER/query?where=$(printf "UPPER(CSE_NR) LIKE 'NV%%'" | sed 's/ /%20/g; s/(/%28/g; s/)/%29/g; s/'"'"'/%27/g')&returnCountOnly=true&f=json"
echo "GET $URL1"
R1=$(curl -sS -m 90 -A "$UA" "$URL1")
echo "$R1" | head -c 500; echo
C1=$(echo "$R1" | sed -n 's/.*"count"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
if [ -n "${C1:-}" ] && [ "$C1" -gt 0 ] 2>/dev/null; then
  ok "CSE_NR LIKE 'NV%' matched $C1 rows — MLRS serials are NV-prefixed."
elif [ -n "${C1:-}" ]; then
  bad "CSE_NR LIKE 'NV%' matched 0 rows — the MLRS serial prefix is NOT the postal code. Re-derive US_SERIAL_PREFIXES in api/claims.js."
else
  meh "no count in response (see body above) — endpoint may have moved."
fi
echo
echo "Sample serials for the record:"
URL1b="$LAYER/query?where=1%3D1&outFields=CSE_NR%2CGEO_STATE%2CADMIN_STATE&returnGeometry=false&resultRecordCount=5&f=json"
echo "GET $URL1b"
curl -sS -m 90 -A "$UA" "$URL1b" | head -c 800; echo

hr
echo "CHECK 2 — GEO_STATE vs ADMIN_STATE: find one record where they disagree."
echo "(Settles whether serial/admin scoping is administrative rather than"
echo " geographic. Washington ground is administered by the Oregon/Washington"
echo " state office, so WA is the most likely place to find a divergence.)"
echo
W2="GEO_STATE <> ADMIN_STATE"
URL2="$LAYER/query?where=$(printf '%s' "$W2" | sed 's/ /%20/g; s/<>/%3C%3E/g')&outFields=CSE_NR%2CCSE_NAME%2CGEO_STATE%2CADMIN_STATE&returnGeometry=false&resultRecordCount=5&f=json"
echo "GET $URL2"
R2=$(curl -sS -m 120 -A "$UA" "$URL2")
echo "$R2" | head -c 1200; echo
if echo "$R2" | grep -q '"attributes"'; then
  ok "found record(s) where GEO_STATE <> ADMIN_STATE (above) — divergence confirmed live."
elif echo "$R2" | grep -q '"features"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]'; then
  meh "no divergent record found. Either the columns never disagree on this layer, or the filter needs adjusting. Try the WA-specific query below."
else
  meh "query errored (see body) — field names may have drifted; run the canary (check 4) first."
fi
echo
echo "WA-specific cross-check:"
URL2b="$LAYER/query?where=UPPER%28GEO_STATE%29%3D%27WA%27&outFields=CSE_NR%2CGEO_STATE%2CADMIN_STATE&returnGeometry=false&resultRecordCount=5&f=json"
echo "GET $URL2b"
curl -sS -m 90 -A "$UA" "$URL2b" | head -c 900; echo
echo
echo "Also record what a WA serial actually looks like (settles whether the MLRS"
echo "prefix is office-derived — 'OR…' — or geographic — 'WA…'):"
echo "  If WA rows carry OR-prefixed serials, US_SERIAL_PREFIXES' refusal to"
echo "  scope OR/WA by serial is confirmed correct."

hr
echo "CHECK 3 — NDOM (Nevada Division of Minerals) county claim layer field list."
echo "(Does it publish a CLAIMANT / CUSTOMER field? That decides whether real"
echo " company search is unblocked, and it is the only thing alias seeding can"
echo " seed against. Also: is a snapshot date exposed?)"
echo
echo "3a. Discover the services NDOM publishes:"
echo "GET https://services.arcgis.com/ (NDOM org) — start from the Hub item search:"
NDOM_SEARCH='https://www.arcgis.com/sharing/rest/search?q=owner%3Andom_admin%20OR%20(mining%20claims%20Nevada%20Division%20of%20Minerals)&num=25&f=json'
echo "GET $NDOM_SEARCH"
curl -sS -m 90 -A "$UA" "$NDOM_SEARCH" \
  | tr ',' '\n' | grep -iE '"(title|url|type|modified)"' | head -60
echo
echo "3b. Then dump the field list of one county claim layer. Substitute the"
echo "    FeatureServer URL discovered above:"
echo '    NDOM_LAYER="https://services<N>.arcgis.com/<org>/arcgis/rest/services/<Service>/FeatureServer/0"'
echo '    curl -sS "$NDOM_LAYER?f=json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get(\"name\")); [print(f[\"name\"], f[\"type\"]) for f in d.get(\"fields\",[])]"'
echo
if [ -n "${NDOM_LAYER:-}" ]; then
  echo "NDOM_LAYER is set — dumping fields:"
  curl -sS -m 90 -A "$UA" "$NDOM_LAYER?f=json" \
    | python3 -c "import json,sys
d=json.load(sys.stdin)
print('layer:', d.get('name'))
fs=d.get('fields') or []
for f in fs: print(' ', f.get('name'), f.get('type'))
hit=[f['name'] for f in fs if any(k in f['name'].upper() for k in ('CLAIMANT','CUSTOMER','OWNER','HOLDER'))]
print('claimant-ish fields:', hit or 'NONE')"
else
  meh "NDOM_LAYER not set — run 3a, then re-run with NDOM_LAYER=<url> to auto-check for a claimant field."
fi

hr
echo "CHECK 4 — Live-schema canary against the real endpoint."
echo
if [ ! -f "$CANARY" ]; then
  meh "canary not found at $CANARY — cannot run check 4."
else
  echo "node $CANARY"
  node "$CANARY"
  C4=$?
  case "$C4" in
    0) ok "every required BLM field still resolves." ;;
    1) bad "schema drift — see the named field(s) above." ;;
    2) meh "endpoint unreachable — not a schema verdict." ;;
    # Any other code is node failing to run at all (missing file, syntax error,
    # bad node version). That is NOT a schema verdict and must never be
    # reported as drift.
    *) meh "canary could not run (exit $C4) — not a schema verdict." ;;
  esac
fi

hr
echo "SUMMARY: $pass verified-live, $fail failed, $inconc inconclusive"
echo
echo "Paste this output into docs/us-claims.md ('Findings') and flip the"
echo "corresponding rows from documentary to verified-live. Per the task,"
echo "do not merge on documentary evidence alone."
[ "$fail" -eq 0 ]
