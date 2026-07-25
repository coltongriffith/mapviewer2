# U.S. Federal Mining Claims (BLM MLRS) Integration

Status: v1 (proxy integration, feature-flagged). Last updated: 2026-07-25.

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
- **Company search is name-resolved, not claimant-resolved.** The BLM spatial
  service publishes no claimant names, so a company search matches the parent
  and its US-subsidiary variants against *claim names* and says so in the
  response (`resolution.resolvedAgainst = 'claim_name'`). See "Company
  resolution" below.
- **State scoping can be degraded.** Every US response declares how it was
  scoped (`meta.scopingMethod`); only `geo_state` is geographically precise.
  See "State scoping" below.

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
be scraping — brittle and deliberately avoided. Instead, a **Company** search
runs the parent→US-subsidiary alias ladder against claim names (US operators
typically name claims after themselves or their subsidiary) and reports that it
did so; the UI also links report 103 for exact claimant→serial lookup, feeding
the serial search here. See "Company resolution" below.

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
| State (geographic) | `GEO_STATE`     | STATE_GEO, GEOGRAPHIC_STATE                | `US_STATE` + precise query scoping (`scopingMethod: geo_state`) |
| State (administrative) | `ADMIN_STATE` | ADMIN_ST, ADM_ST, STATE                  | fallback scoping only (`scopingMethod: admin_state`) — administering BLM office, **not** where the land is |
| Claimant       | *(not published)*   | CLAIMANT_NAME, CLAIMANT, CLMNT_NAME, CLAIMANT_TXT, CUST_NAME, CUSTOMER_NAME | `OWNER_NAME` — activates automatically if BLM publishes one; until then company search resolves against `CSE_NAME` |
| Recorded date  | *(unverified)*      | CSE_RCRD_DT, RCRD_DT, CSE_FILE_DT, LOCATION_DT, LOC_DT | `RECORDED_DATE` — used only as the area tie-break when ranking jurisdictions; never mapped to `GOOD_TO_DATE` |
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

## State scoping — and why it is always declared

Every US attribute and bbox query is AND-ed with a state clause, and every US
response declares which clause produced it in `meta.scopingMethod`. There is no
silent fallback: a claim set scoped by anything other than `geo_state` also
carries `meta.scopingDegraded: true` and a human-readable `meta.scopingNote`,
and the UI renders a warning both in the results panel **and over the map**
(`layer.provenance.scopingWarning`). These maps go into NI 43-101 filings and
investor decks; a wrong-but-plausible claim set is the worst failure this
integration can produce.

| `scopingMethod` | Clause | Precision |
|-----------------|--------|-----------|
| `geo_state`     | `UPPER(GEO_STATE) = 'XX'` | Geographic. The only precise mode. |
| `admin_state`   | `UPPER(ADMIN_STATE) = 'XX'` | **Administrative.** Selects by administering BLM office, not claim location. |
| `serial_prefix` | `UPPER(CSE_NR) LIKE 'XX%'` (+ `UPPER(LGCY_CSE_NR) LIKE '<office>%'` when that field exists) | Administrative, and dependent on the serial format not having drifted. |

Only when no state field **and** no usable serial prefix resolves does the
request **fail closed** with a clear error — nationwide results must never be
mislabeled as one state.

### Serial prefixes: two different alphabets

MLRS serials and BLM legacy (LR2000) serials are prefixed differently and live
in different fields, so each prefix is only ever applied to its own field:

| Field | Format | Nevada example |
|-------|--------|----------------|
| `CSE_NR` (MLRS serial) | two-letter state code + digits | `NV105331298` |
| `LGCY_CSE_NR` (legacy serial) | state-office mining-claim code + digits | `NMC1026884` |

State-office codes (documentary, see Findings below): `AZ=AMC CA=CAMC CO=CMC
ID=IMC MT=MMC NM=NMMC NV=NMC OR=ORMC UT=UMC WY=WMC` (`ES=ESMC`, Eastern
States). Note the collision this avoids: `'NM%'` on a field carrying legacy
values would also match Nevada's `NMC…`, which is exactly why the two prefixes
are never OR'd against the same field.

**Oregon and Washington have no serial fallback at all.** One BLM state office
(Oregon/Washington, Portland) administers claims in both states, so no
office-derived prefix distinguishes Oregon ground from Washington ground:
`'WA%'` would return nothing and `'ORMC%'` would return Oregon claims labelled
Washington. Both states hard-error instead of guessing. The same shared-office
fact means that under `admin_state` scoping, **`us-wa` may legitimately return
zero rows** (Washington ground can carry an Oregon administering office) — this
is documented at the `resolveUsScoping` call site in `api/claims.js`.

## Findings — what was and wasn't verified against live data

Recorded here because the conclusions above depend on it. `gis.blm.gov` was
**unreachable from the environment these changes were written in** (egress
policy denied every host; `connect_rejected` 403 at the proxy, confirmed for a
control host too). Nothing below was confirmed against a live BLM record.

**Serial prefixes are NOT purely state-office codes — the original premise was
half right.** The `NMC`-style codes are the **legacy LR2000** prefixes; the
**MLRS** serial (which is what `CSE_NR` carries, and what the fallback queries)
uses the two-letter state code, e.g. `NV101561747` / `NV105331298`. So the
pre-existing `UPPER(CSE_NR) LIKE 'NV%'` fallback was **not** a silent total
failure for Nevada. Status: **verified documentary, not verified live.** Source:
BLM's MLRS serial-number-format article
(`mlrs.blm.gov/s/article/What-is-the-Mining-Claim-serial-number-format-in-MLRS`)
and the per-state prefix list republished by Western Mining History
(`westernmininghistory.com/3729/researching-mining-claims-with-the-blm-mlrs/`).
Only the Nevada pairing was corroborated by actual serial examples; the other
ten rows of `US_SERIAL_PREFIXES` are documentary and are flagged as such in the
code comment.

**Unverified: whether the MLRS two-letter prefix is geographic or
administrative.** Because it is unknown, `serial_prefix` is treated as
administrative (the conservative reading) and declared degraded.

**`ADMIN_STATE` can differ from `GEO_STATE`: verified structurally, NOT verified
against a live cross-office record.** The BLM Oregon/Washington State Office
administers mining claims for both Oregon and Washington
(`blm.gov/office/oregonwashington-state-office`,
`blm.gov/programs/energy-and-minerals/mining-and-minerals/about/oregon-washington`),
so administering office and claim location provably diverge for Washington
ground. **No live record was pulled** to demonstrate a specific case where the
two columns disagree. The limitation is documented at the call site regardless,
and serial-prefix scoping is treated as administrative rather than geographic.

**Still to confirm post-deploy** (see checklist): that `GEO_STATE` and
`ADMIN_STATE` both exist on the live layer with the names above; whether any
claimant or recording-date field is published; and one concrete
`GEO_STATE ≠ ADMIN_STATE` record. `GET /api/claims?schema=1&province=us-wa`
now reports the resolved `scoping` block, which answers the first directly.

## Company resolution (parent → US subsidiary)

US claims held by Canadian-listed issuers are rarely recorded under the parent's
name — they sit under a US holding company ("X Gold US Inc.", "X Nevada LLC"),
and BLM claimant fields often carry the *locator* rather than the beneficial
owner. Suffix stripping alone does not bridge that gap.

`api/_lib/us-aliases.js` resolves a company in three tiers, first hit wins:

1. **exact** — claimant/claim-name equals the company name.
2. **alias** — curated `parent → claimant` pairs (jurisdiction-tagged) plus
   deterministic subsidiary variants generated from the parent name
   (`<stem> US`, `<stem> USA`, `<stem> NEVADA`, `<stem> MINING`, …).
3. **fuzzy** — broad two-token stem query, then each row is scored with the
   pSEO pipeline's own scorer and threshold (`NAME_MATCH.auto = 92`, defined in
   `api/_lib/name-match.js`, which `scripts/pseo/lib.mjs` and `config.mjs` now
   re-export so runtime and pipeline cannot drift). No new thresholds were
   introduced. Rows below the threshold are dropped, not shown.

The response reports `resolution.method` (`exact|alias|fuzzy`),
`resolution.resolvedAgainst` (`claimant|claim_name`) and `tiersAttempted`.

**Two zero-result outcomes, two messages — never merged:**

| Outcome | `resolution.status` | Means |
|---------|--------------------|-------|
| Company resolved, holds nothing here | `resolved` + `features: []` | "No active claims found for X in Nevada." |
| Company could not be linked to any holder | `unresolved` (`reason: no_claimant_field` / `no_claimant_match` / `no_claim_name_match`) | "We couldn't link X to a claim holder in Nevada." — explicitly *not* a statement that it holds no ground. |

Merging these was the original defect: a US issuer holding Nevada ground under a
subsidiary was indistinguishable from one holding no US ground at all. UI text
lives in `src/utils/scopingNotice.js`.

### Curating the alias table

- `data/pseo/aliases.csv` is the human-editable source. It gained a US
  dimension: `owner_raw,ticker,kind,jurisdiction,parent_name,source,verified`.
  Rows with `kind=us_subsidiary` / `jurisdiction=us*` are consumed at runtime
  and are skipped by the Canadian owner matcher (`04_match_owners.mjs`).
- `scripts/pseo/08_seed_us_aliases.mjs` pulls live BLM claimant strings
  containing subsidiary markers (`NEVADA`, `US INC`, `USA`, `LLC`, `CORP`, …),
  cross-matches them against `issuers.csv`, and writes
  `data/pseo/us_alias_review_queue.csv`. **Fuzzy hits are never auto-accepted** —
  every row lands in the queue with `verified` blank for a human to confirm.
- `CURATED_US_ALIASES` in `api/_lib/us-aliases.js` ships **empty**. Each row
  there asserts that a named public company holds claims through a named
  subsidiary, which is a factual claim that ends up on a filed map, so rows are
  added only from a confirmed queue entry. A test enforces that every shipped
  row is `verified: 'yes'` with a source.
- The review queue in this branch is **header-only**: the seeding script could
  not reach `gis.blm.gov` from this environment (see Findings). Run it once
  from an environment with BLM access. If the live layer still publishes no
  claimant field the script exits 3 without writing rows, and reports the live
  field list — feed it an export of MLRS report 103 via `--claimants <csv>`
  instead.

## Jurisdiction ranking for auto-adopted switches

When a company deep link lands on a jurisdiction with no claims, the app fans
out across the others and (for auto-searches only) adopts the strongest hit.
Ranking is by **materiality, not count** (`src/utils/claimRanking.js`): total
hectares descending, tie-broken on the most recent recording date, falling back
to claim count only when no candidate publishes area. Count alone was wrong
because US federal lode claims are ~20 acres each — forty dormant Nevada claims
outranked a four-claim BC flagship.

An auto-adopted switch **always** renders attribution ("Showing Nevada — no
British Columbia claims found for X"), and that attribution is attached to
every imported layer as `layer.provenance.autoAdopted`, so it persists in
project state, survives save/reload, and is displayed over the map. Manual
"Switch & view" clicks are unchanged and produce no attribution — the user
chose that jurisdiction themselves.

**Limitation:** the provenance banners render in the editor chrome above the map
stage, so they are visible to whoever is building or reviewing the map, but they
are **not drawn into the exported PNG/SVG/PDF raster**. Rendering provenance
into the exported image itself is a separate change.

## Live-schema canary

`scripts/live-schema-canary.mjs` hits the real BLM endpoint and asserts that
every candidate list still resolves, naming any missing field. It exists because
the 177-test fixture suite *cannot* catch schema drift — its fixture field names
**are** the schema assumption, so MLRS can rename a field and every test stays
green while production breaks.

- Deliberately **not** under `tests/` and not named `*.test.js`: vitest's
  include glob is `tests/**/*.test.{js,jsx}`, so `npm test` and the CI build
  gate never run it. A government endpoint being down must not block a deploy.
- Scheduled weekly via `.github/workflows/blm-schema-canary.yml`
  (Mondays 09:00 UTC) plus `workflow_dispatch`.
- Exit codes: `0` schema intact · `1` **drift** — a required field is gone,
  names it and fails the run · `2` endpoint unreachable, reported as a workflow
  warning and explicitly *not* a schema verdict.
- Run locally: `node scripts/live-schema-canary.mjs` (or `--json`).

## Post-deploy verification checklist (REQUIRED — sandbox could not reach BLM)

The integration self-configures against live metadata, but a human must
verify once after the first deploy with the flag on:

1. `GET /api/claims?schema=1&province=us-nv` with header
   `x-admin-secret: $ADMIN_API_SECRET` → confirm `number.numberField`,
   `number.legacyField`, `name.nameField`, `geoStateField`, `adminStateField`,
   `recordDateField`, and the `scoping` block all resolved. **`scoping.method`
   must be `geo_state`** — anything else means US results are shipping under a
   degraded scope. Record the resolved names in the table above.
2. Run `node scripts/live-schema-canary.mjs` from anywhere with BLM access; it
   answers step 1 for every candidate list at once and exits non-zero on drift.
3. Search a known claim name and serial in the app for **Nevada, Arizona,
   and Utah**; cross-check 3 claims per state against BLM's public MLRS map
   (claim name, serial, state, type, general location).
4. Run a nearby-claims search in Nevada; confirm polygons land where BLM's
   map shows them.
5. **Close out the unverified findings above.** Query the live layer for one
   record where `GEO_STATE <> ADMIN_STATE` and record it here (start with
   Washington, whose administering office is Oregon). Confirm whether any
   claimant field exists; if one does, run
   `node scripts/pseo/08_seed_us_aliases.mjs` and work the review queue.
   Confirm the MLRS serial prefix on a Washington claim to settle whether that
   prefix is geographic or administrative.
6. If a field did not resolve: add the real field name to the candidate list
   in `api/claims.js` **and** to `CHECKS` in `scripts/live-schema-canary.mjs`
   (one line each), update the fixtures in `tests/us-claims.test.js`, redeploy.

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
validation, bbox scoping, claim-type normalization matrix, Yukon regression (no
state scoping or `resolution` block leaks into Canadian responses). Added with
this change:

- **Scoping declaration** — `geo_state` on the happy path; `admin_state` and
  `serial_prefix` each declared degraded with a note that says *administrative,
  not geographic*; the legacy office prefix applied to the legacy field only
  (never OR'd onto `CSE_NR`); Oregon/Washington hard-erroring instead of
  guessing; and the acceptance case — every US path (search, number, bbox,
  company) declaring its method.
- **Company alias ladder** — the acceptance case (parent name finds Nevada
  claims recorded under a subsidiary, via tier 2); exact short-circuiting tier
  2/3; fuzzy tier score-filtering a stem collision out; `unresolved` reported
  distinctly from empty with every tier attempted; `no_claimant_field` when the
  layer publishes neither claimant nor name; real claimant field used when
  present; state scope preserved on every tier.
- **Alias layer units** — jurisdiction-tagged variant generation, tier order,
  reuse of `NAME_MATCH.auto = 92`, short-stem refusal, and a guard that no
  unverified curated alias ever ships.
- **Ranking + messaging units** — four-claim flagship beating forty dormant
  claims, date tie-break, count fallback only when no area exists, attribution
  wording, and that `unresolved` and empty never share a message.

`tests/registry-jurisdictions.test.jsx`: flag gating, US modes (now including
Company), type-filter chips, disclaimer, Canadian selector unchanged, plus
auto-adoption attribution rendering + provenance reaching the imported layer,
and a regression that manual "Switch & view" produces no attribution.

Not covered by any test, by design: `scripts/live-schema-canary.mjs` (it exists
to test reality, so mocking it would defeat the point — its pass/drift/
unreachable paths were exercised against a local stub during development).
