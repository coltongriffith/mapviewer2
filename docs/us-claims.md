# U.S. Federal Mining Claims (BLM MLRS) Integration

Status: v1 (proxy integration, feature-flagged). Last updated: 2026-07-14.

## What this is

United States federal mining claims, searchable and mappable exactly like the
Canadian provinces, for 11 western states: **Nevada, Arizona, Utah, Idaho,
Montana, Wyoming, Colorado, New Mexico, California, Oregon, Washington.**

**Coverage honesty (repeat this anywhere coverage is described):**
- Federal BLM claims only. State-managed mineral tenure (state leases,
  state exploration permits, and especially **Alaska state mining claims**)
  is NOT included. Alaska is deliberately absent from the jurisdiction list
  for that reason — listing it would misrepresent coverage.
- Claim boundaries are **generalized** (PLSS-derived), not legal surveys.
  The verbatim user-facing disclaimer lives in
  `src/utils/jurisdictions.js` (`US_GEOMETRY_DISCLAIMER`) and renders in the
  registry search results, the nearby-claims panel, and claim popups.
- **No claimant/company search.** The BLM spatial service does not publish
  claimant names. See "Claimant data" below.

## Data source

- Primary: BLM MLRS **"Mining Claims Not Closed"** HUB FeatureServer, layer 0
  `https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer/0`
  Chosen because it is pre-filtered upstream to not-closed cases, so closed
  claims can never surface as active through this integration.
- Override with the server env var `BLM_MLRS_SERVICE_URL` (Vercel) if BLM
  moves the service. The alternative documented source is
  `https://gis.blm.gov/nlsdb/rest/services/Mining_Claims/MiningClaims/MapServer/1`.
- Active/pending distinction: the case **disposition** text is surfaced as
  `STATUS` on every feature (shown in result rows + popups) rather than
  filtered — the service itself excludes closed cases.

## Architecture (why there is no sync job)

US claims are served through the same server-side proxy engine
(`api/claims.js`) that already powers ON/SK/MB/NL/YT — self-configuring field
resolution, full pagination to a 10k ceiling with honest `meta.truncated`,
retry/backoff, per-IP rate limits, sanitized errors. Requests to BLM happen
only on explicit user searches or a bounded (area-capped) nearby-claims
action — never on map move, never nationwide. This is the codebase's proven
pattern; a parallel ingestion pipeline was deliberately not built for v1.

**Claimant search — why it isn't live, and the interim UX (researched July
2026):** no BLM GIS service publishes claimant/customer names — not the HUB
FeatureServers, not `Mining_Claims/MiningClaims/MapServer` (its layers/tables
are Case geometry + land-history attributes only). Claimant data exists only
in the MLRS Reporting Application (reports.blm.gov): report 103 "Mining
Claims — Customer Info Report" (search by customer name) and report 108
"Serial Register Page" (per-serial detail, parameterized URLs). That app is
human-facing (HTML output, no documented machine API), so live proxying would
be scraping — brittle and deliberately avoided. The registry-search UI
instead (a) suggests searching the company/person as a Claim Name (US
operators typically name claims after themselves, so this works surprisingly
often), and (b) links report 103 for exact claimant→serial lookup, feeding
the serial search here.

**v2 path (real claimant search):** mirror the QC pattern — a `us_claims`
Supabase table + scheduled loader script (`scripts/update-qc-claims.js` is
the template) + PostGIS bbox RPC, keyed by MLRS serial. Claimant data joins
from MLRS report extracts by case serial into separate `claimants` /
`claim_ownership` tables (original claimant text preserved; company
normalization as a reviewable enrichment layer, never auto-merged on loose
similarity). Nothing in v1 needs restructuring for this: `TAG_NUMBER`
already carries the MLRS serial and `OWNER_NAME` is reserved/null for US
records.

## Field mapping (candidates → resolved at runtime)

Field names are resolved at runtime against live layer metadata (the same
mechanism as the Canadian ArcGIS provinces), from candidate lists in
`api/claims.js` (`US_JURISDICTIONS`). The first name in each list is the
**verified live field** (checked July 2026 against the layer's documented
schema); the rest are drift tolerance:

| Purpose        | Verified live field | Fallback candidates                        | Normalized to |
|----------------|---------------------|--------------------------------------------|---------------|
| MLRS serial    | `CSE_NR`            | MLRS_CSE_NR, CASE_NR, SER_NR, SERIAL_NR    | `TAG_NUMBER` |
| Legacy serial  | *(not published)*   | LGCY_CSE_NR, LEGACY_CASE_NR, LGCY_SER_NR   | `LEGACY_NR` — activates automatically if BLM adds the field; until then serial search matches `CSE_NR` only |
| Claim name     | `CSE_NAME`          | CLAIM_NAME, MC_NAME, CASE_NAME, NAME       | `CLAIM_NAME` |
| State          | `GEO_STATE`         | ADMIN_STATE, STATE_GEO, ADMIN_ST, ADM_ST, STATE | `US_STATE` + query scoping (GEO_STATE = where the land is; ADMIN_STATE = administering office, differs near borders) |
| Claim type     | `BLM_PROD`          | CSE_TYPE_TXT, CASETYPE_TXT, CSE_TYPE, CASE_TYPE | `TITLE_TYPE_DESCRIPTION` (original) + `CLAIM_TYPE` (normalized) |
| Disposition    | `CSE_DISP`          | CSE_DISP_TXT, DISP_TXT, CASE_DISP, DISPOSITION | `STATUS` |
| Recorded acres | `RCRD_ACRS`         | ACRES, RECORD_ACRES                        | `AREA_IN_HECTARES` (÷2.47105; original preserved) |

Normalized claim types: `lode`, `placer`, `mill_site`, `tunnel_site`,
`other`, `unknown` — mapped from official case-type text (substring match on
lode/placer/mill/tunnel). Every original BLM attribute is preserved on the
feature for traceability.

Also always set on US features: `SOURCE_SYSTEM: 'BLM MLRS'`,
`GEOM_GENERALIZED: true`. Deliberately **not** set: `GOOD_TO_DATE` — BLM
assessment/anniversary semantics differ from Canadian expiry, and mislabeling
a date as "expires" would be worse than omitting it. A geometry-quality
category is only added if the live schema exposes an official quality field
(mapping must come from BLM's own metadata, not invented).

State scoping: every attribute and bbox query is AND-ed with
`UPPER(<state field>) = '<XX>'`. If no state field resolves (schema drift),
scoping degrades to serial-prefix matching (`UPPER(CSE_NR) LIKE 'XX%'` —
MLRS case serials begin with the two-letter admin state code; slightly
imprecise near borders but never nationwide). Only when neither a state nor
a serial field resolves does the request **fail closed** with a clear error —
nationwide results must never be mislabeled as one state.

## Post-deploy verification checklist (REQUIRED — sandbox could not reach BLM)

The integration self-configures against live metadata, but a human must
verify once after the first deploy with the flag on:

1. `GET /api/claims?schema=1&province=us-nv` with header
   `x-admin-secret: $ADMIN_API_SECRET` → confirm `number.numberField`,
   `number.legacyField`, `name.nameField`, and `stateField` all resolved
   (non-null). Record the resolved names in the table above.
2. Search a known claim name and serial in the app for **Nevada, Arizona,
   and Utah**; cross-check 3 claims per state against BLM's public MLRS map
   (claim name, serial, state, type, general location).
3. Run a nearby-claims search in Nevada; confirm polygons land where BLM's
   map shows them.
4. If a field did not resolve: add the real field name to the candidate list
   in `api/claims.js` (one-line change) and redeploy.

## Feature flag & rollout

- `VITE_ENABLE_US_CLAIMS=1` (Vercel env) shows the US jurisdictions in the
  registry search, the nearby-claims panel, and the landing-page/US
  marketing copy, and activates US deep links (`?intent=claims&region=nevada`).
  With the flag unset, all US UI is hidden and US region slugs fall through
  to the upload path. The server config ships regardless (harmless).
- Marketing copy (homepage hero note, SEO fallback bullet, blog deep links,
  welcome email) ships in the same deploy — **enable the flag at that deploy**
  so the site never advertises a switched-off feature.
- Adding another state = one entry in `US_STATE_CODES` (api/claims.js) + one
  in `US_STATES` (src/utils/jurisdictions.js) + the blog slug.

## Monitoring & troubleshooting

- Usage: admin dashboard → Product tab → searches by jurisdiction
  (`us-nv`, … flow through the existing `search_events` analytics).
- Failures: `/api/claims?schema=raw&province=us-nv` (admin secret) reports
  raw upstream status/latency to distinguish a WAF block from an outage.
- BLM outage: US searches return the standard "registry temporarily
  unavailable" error; all Canadian functionality is unaffected (separate
  services, separate code paths, shared engine only).

## Test coverage

`tests/us-claims.test.js` (handler-level, fully mocked BLM service): name and
serial search WHERE-clause shape incl. state scoping, serial formatting
tolerance + legacy OR, pagination past maxRecordCount, jurisdiction
validation, company-mode degradation, bbox scoping, claim-type normalization
matrix, Yukon regression (no state scoping leaks into Canadian queries).
`tests/registry-jurisdictions.test.jsx`: flag gating, US modes, type-filter
chips, disclaimer, Canadian selector unchanged.
