// Multi-province Canadian mineral claims search proxy.
//
// Live-searchable provinces (public spatial APIs with attribute queries):
//   bc — BC WFS (openmaps.gov.bc.ca), WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW
//   on — Ontario MLAS operational map service (LIO ArcGIS REST)
//   sk — Saskatchewan Mineral Dispositions (gis.saskatchewan.ca ArcGIS REST)
//   mb — Manitoba Mineral Dispositions (gov.mb.ca ArcGIS REST)
//   nl — Newfoundland & Labrador Mineral Lands GeoAtlas (ArcGIS REST)
//   yt — Yukon quartz claims (GeoYukon GY_Mining ArcGIS REST)
//
// Self-hosted (no live API, loaded weekly into Supabase — see searchQc):
//   qc — GESTIM is login-gated and SIGÉOM serves WMS images only, but Quebec's
//        titres miniers are published as a free public shapefile refreshed every
//        Monday. scripts/update-qc-claims.js loads it into the qc_claims table.
//
// Not supported (no free public queryable API as of 2026):
//   ab — crown mineral agreements distributed via AltaLIS under license
//   ns — NovaROC viewer; mineral titles are download-only
//   nb — GeoNB has no documented public mineral claims query service
//   nt/nu — Geocortex viewers / federal (CIRNAC) snapshots, no stable query API
//   pe — no active mineral claim registry
//
// ArcGIS provinces are self-configuring: the layer is located by name within
// the map service and search fields are resolved against the layer's actual
// field list, so upstream schema changes degrade gracefully. Responses are
// normalized to the BC property names the UI renders (OWNER_NAME, TAG_NUMBER,
// AREA_IN_HECTARES, GOOD_TO_DATE, TITLE_TYPE_DESCRIPTION).

import { fetchAllPages, fetchWfsAll, MAX_TOTAL_FEATURES, MAX_PAGES } from './_lib/paging.js';
import { applyCors, handleMethods, queryTooLong, validateTerm, MAX_TERM_LENGTH, validateBbox, rateLimited, diagnosticsAllowed, publicErrorMessage } from './_lib/guard.js';
import { esriGeometryToGeoJSON } from './_lib/esri.js';
import { resolveUsCompanyTiers, matchesCompany } from './_lib/us-aliases.js';
import { parseClaimNumbers, cleanSingleNumber, MAX_CLAIM_NUMBERS, MAX_NUMBER_LIST_LENGTH } from '../shared/claimNumbers.js';
import { US_STATE_CODES, US_SERIAL_PREFIXES, legalDescriptionStates } from '../shared/usClaimStates.js';

export { legalDescriptionStates };

const ARCGIS_PROVINCES = {
  on: {
    service: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/MLAS/mlas_op/MapServer',
    layerMatch: /mining\s*claim/i,
    // Verified post-deploy: layer 1, fields HOLDER + TENURE_NUMBER_ID
    ownerFields: ['HOLDER', 'CLAIM_HOLDER', 'RECORDED_HOLDER', 'HOLDER_NAME', 'OWNER_NAME', 'OWNER', 'CLIENT_NAME'],
    numberFields: ['TENURE_NUMBER_ID', 'CLAIM_NUMBER', 'CLAIMNUM', 'CLAIM_NUM', 'TENURE_NUMBER', 'CLAIM_ID', 'CELL_CLAIM_NUMBER'],
    // Ontario converted every staked claim to grid cells in April 2018. People
    // still arrive with the old number (assessment reports, company filings),
    // and the current Mining Claim layer has never heard of it. MLAS keeps the
    // old outlines on this layer; see legacyClaimResult. Verified Sept 2026:
    // layer 8 "Legacy Claim", string CLAIM_NUM.
    legacyClaims: { layerId: 8, numberField: 'CLAIM_NUM' },
  },
  sk: {
    service: 'https://gis.saskatchewan.ca/arcgis/rest/services/Economy/P_Mineral_Tenure_Crown_Dispositions/MapServer',
    layerId: 0,
    // Verified post-deploy: shapefile-truncated names — OWNERS (string),
    // DISPOSIT_1 (string disposition number), GOODSTANDI (good standing date)
    ownerFields: ['OWNERS', 'HOLDER', 'HOLDER_NAME', 'DISPOSITION_HOLDER', 'OWNER_NAME', 'OWNER', 'CLIENT_NAME'],
    numberFields: ['DISPOSIT_1', 'DISPOSITIO', 'DISPOSITION_NUMBER', 'DISPOSITION_NUM', 'DISP_NUM', 'CLAIM_NUMBER'],
  },
  mb: {
    // Manitoba iMaQs (Integrated Mining and Quarrying System) — public ArcGIS
    // REST on rdmaps.gov.mb.ca. The long-standing maps.gov.mb.ca service now
    // returns a persistent gateway 502 (its ArcGIS backend is down), but the
    // same data is served healthily here, the host behind Manitoba's public
    // mineral-dispositions map viewer. imaqsMining layer 3 is the "Mining
    // Claim" leaf (4 Patent, 5 Exploration Licence, 8 Cancelled — excluded).
    // The layer publishes no holder/owner field, so company search is not
    // available for Manitoba (ownerFields empty → graceful "search by number");
    // claims are looked up by tenure number (TENURE_NUMBER_ID) or staking tag.
    service: 'https://rdmaps.gov.mb.ca/arcgis/rest/services/iMaQs/imaqsMining/MapServer',
    layerId: 3,
    ownerFields: [],
    numberFields: ['TENURE_NUMBER_ID', 'TAG_NUMBER'],
  },
  nl: {
    // Newfoundland & Labrador GeoAtlas Mineral Lands — public ArcGIS REST.
    // NL uses a licence-based system; the active layer may be named "Map Staked
    // Claims", "Mineral Claims", or "Mineral Licences" depending on server version.
    // The regex captures both "claims" and "licences" variants and excludes
    // "Historical". resolveLayerAndFields is tolerant of empty field lists so
    // bbox queries work even when the server doesn't expose field metadata.
    service: 'https://dnrmaps.gov.nl.ca/arcgis/rest/services/GeoAtlas/Mineral_Lands/MapServer',
    layerMatch: /(map[\s-]*staked\s*(claims?|licen[cs]e[sd]?)|(mineral|active|current)\s*(claims?|licen[cs]e[sd]?))/i,
    ownerFields: ['LICENSEE', 'LICENCE_HOLDER', 'LICENSE_HOLDER', 'OPERATOR', 'CLIENT_NAME', 'CLIENT', 'HOLDER', 'OWNER_NAME', 'OWNER', 'COMPANY', 'COMPANY_NAME'],
    numberFields: ['LICENCE_NO', 'LICENCE_NUMBER', 'LICENSE_NO', 'LICENSE_NUMBER', 'CLAIM_NO', 'CLAIM_NUMBER', 'MASTER_NO', 'MAP_NUMBER', 'NTS_CLAIM'],
  },
  yt: {
    service: 'https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon/GY_Mining/MapServer',
    layerMatch: /quartz\s*claims/i,
    ownerFields: ['OWNER', 'OWNER_NAME', 'CLAIM_OWNER', 'HOLDER', 'CLIENT_NAME', 'CLAIM_NAME'],
    numberFields: ['GRANT_NUMBER', 'GRANT_NUM', 'CLAIM_NUMBER', 'CLAIM_NUM'],
  },
};

// ── United States — federal mining claims (BLM MLRS) ────────────────────────
// One national ArcGIS map service, scoped per state (see resolveUsScoping).
// Source: BLM National Lands Spatial Database public service
// Mining_Claims/MiningClaims/MapServer, layer 1 "Active Mining Claims" — the
// equivalent of the old "Mining Claims Not Closed" HUB layer, so closed claims
// can never surface as active here (layer 2 is "Closed Mining Claims", layer 0
// "Case"). Service and layer are both overridable via env, because BLM moves
// this service without notice.
//
// MOVED 2026-10: the old HUB FeatureServer at
//   gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed
// started answering every request with a 301 to the bare REST root of
// nlsdbpubgis.blm.gov (path dropped), and the HUB folder now says "Token
// Required". fetch followed the redirect, got a catalogue page with no fields,
// and every US search failed. The HTTP layer now refuses a redirect that
// changes the path (see fetchJsonOnce), so the next move fails loudly.
//
// Field names are resolved at runtime against the live layer metadata from
// the candidate lists below (the same self-configuring mechanism used for
// ON/SK/MB/NL/YT — see resolveLayerAndFields). Verify post-deploy with the
// gated diagnostics: /api/claims?schema=1&province=us-nv (x-admin-secret),
// which also reports the resolved service, layer and field fill rates.
//
// No claimant/owner field: the BLM spatial service does not publish claimant
// names (those live in separate MLRS reports keyed by serial number — see the
// us_claim_claimants store below).
//
// Alaska is deliberately not listed: Alaska has extensive STATE-managed
// mining claims that this federal dataset does not cover, and listing it
// would misrepresent coverage. Any other state is one line to add.
const BLM_MLRS_SERVICE = process.env.BLM_MLRS_SERVICE_URL
  || 'https://nlsdbpubgis.blm.gov/arcgis/rest/services/Mining_Claims/MiningClaims/MapServer';
const BLM_MLRS_LAYER_ID = /^\d+$/.test(String(process.env.BLM_MLRS_LAYER_ID ?? '').trim())
  ? Number(process.env.BLM_MLRS_LAYER_ID)
  : 1;


// ── Serial-prefix scoping table (degraded fallback only) ─────────────────────
// MLRS case serials and BLM legacy (LR2000) serials both carry a state-scoped
// prefix, but they use DIFFERENT alphabets, and they live in different fields:
//
//   CSE_NR       MLRS serial          two-letter state code + digits   NV105331298
//   LEG_CSE_NR   legacy LR2000 serial state-office claim code + digits NMC1026884
//                (published as LGCY_CSE_NR before August 2026)
//
// The office codes (verified July 2026 against the BLM MLRS serial-number-format
// article at mlrs.blm.gov/s/article/What-is-the-Mining-Claim-serial-number-format-in-MLRS
// and the per-state prefix list republished at
// westernmininghistory.com/3729/researching-mining-claims-with-the-blm-mlrs/):
//   AZ=AMC  CA=CAMC  CO=CMC  ID=IMC  MT=MMC  NM=NMMC  NV=NMC
//   OR=ORMC UT=UMC   WY=WMC  (ES=ESMC, Eastern States)
// Only the Nevada pairing (NV…/NMC…) was confirmable against actual serials
// from that source; the other rows are documentary. See docs/us-claims.md.
//
// The two prefixes are never OR'd into the same field: 'NM%' on a serial field
// carrying legacy values would also match Nevada's NMC…, so each prefix is
// only ever applied to the field whose format it belongs to.
//
// OREGON AND WASHINGTON SHARE ONE PREFIX. A single BLM state office
// (Oregon/Washington, in Portland) administers claims in both states, so every
// Washington claim carries an Oregon serial: on the live layer (Oct 2026)
// CSE_NR LIKE 'WA%' matches nothing, and all 2,636 claims whose legal
// description is in Washington have OR… serials. The prefix therefore only
// NARROWS the query to the shared office (sharedOffice: true); which of the two
// states a claim is in is decided per row from its geographic state or its PLSS
// legal description (see usRowState), and a claim with neither is left out
// rather than guessed. A wrong-but-plausible claim set is the worst outcome
// this product can produce, so it is not on the menu.
// The prefix table itself lives in shared/usClaimStates.js (US_SERIAL_PREFIXES),
// shared with the mirror loader.

const US_JURISDICTIONS = Object.fromEntries(US_STATE_CODES.map((code) => [
  `us-${code.toLowerCase()}`,
  {
    service: BLM_MLRS_SERVICE,
    layerId: BLM_MLRS_LAYER_ID,
    provider: 'blm-mlrs',
    usState: code,
    // BLM's database compares text case-insensitively (verified Oct 2026:
    // CSE_NAME <> UPPER(CSE_NAME) matches no rows although names such as
    // "Jericho" are stored mixed-case, and LIKE '%JERICHO%' finds them).
    // Serials are stored in capitals. So the raw column is compared against an
    // upper-cased term, which lets the server use its index: CSE_NR = 'X'
    // answers in ~0.5 s where UPPER(CSE_NR) LIKE '%X%' took ~25 s.
    valuesUpperCase: true,
    // Offset paging (resultOffset + orderByFields) is pathologically slow on
    // this layer: ~35 s for 500 rows of a small bbox, with or without geometry.
    // returnIdsOnly answers the same bbox in ~3-5 s and objectIds batches of
    // 250 in ~1 s each, so US queries always run ids-first, batches in parallel.
    paging: { strategy: 'ids', chunk: 250, concurrency: 6, timeoutMs: 45000 },
    // Only what the app renders or scopes on. CSE_META (the PLSS legal
    // description) carries the geographic state; QLTY and the Salesforce id are
    // large and unused, so '*' would only make every response slower.
    outFields: ['OBJECTID', 'CSE_NR', 'LEG_CSE_NR', 'CSE_NAME', 'BLM_PROD', 'CSE_DISP',
      'CSE_TYPE_NR', 'RCRD_ACRS', 'LOC_DT', 'GEO_STATE', 'ADMIN_STATE', 'CSE_META'],
    // Legal land description, e.g. "NV 21 0330N 0510E 033 A SE|NV 21 …": one
    // PLSS description per aliquot, each led by the state the land is in.
    legalDescriptionFields: ['CSE_META'],
    // Candidate field names, resolved against live metadata at runtime.
    // First names verified against the live layer (Oct 2026, MapServer/1):
    // GEO_STATE / ADMIN_STATE / CSE_DISP / BLM_PROD / CSE_NR / LEG_CSE_NR /
    // CSE_NAME / RCRD_ACRS / LOC_DT / CSE_META. GEO_STATE and ADMIN_STATE exist
    // but are mostly NULL (12% and 36% filled), so neither is trusted on its
    // own — see resolveUsScoping.
    //
    // Geographic and administrative state candidates are kept in SEPARATE
    // lists because which one answered decides whether the result set is
    // geographically scoped or merely administratively scoped — that
    // distinction is reported to the client (see resolveUsScoping).
    geoStateFields: ['GEO_STATE', 'STATE_GEO', 'GEOGRAPHIC_STATE'],
    adminStateFields: ['ADMIN_STATE', 'ADMIN_ST', 'ADM_ST', 'STATE'],
    nameFields: ['CSE_NAME', 'CLAIM_NAME', 'MC_NAME', 'CASE_NAME', 'NAME'],
    numberFields: ['CSE_NR', 'MLRS_CSE_NR', 'CASE_NR', 'SER_NR', 'SERIAL_NR'],
    // LEG_CSE_NR is what the layer actually publishes as of August 2026 — the
    // schema canary caught it. The older LGCY_* spellings are kept behind it so
    // a rollback on BLM's side resolves without a code change.
    legacyNumberFields: ['LEG_CSE_NR', 'LGCY_CSE_NR', 'LEGACY_CASE_NR', 'LGCY_SER_NR'],
    // Claimant candidates. The Not Closed spatial layer published none as of
    // July 2026 (claimant names live in separate MLRS reports keyed by serial),
    // so company search resolves through the alias layer against the claim-NAME
    // field instead — see searchUsCompany. Listed anyway so an exact claimant
    // search lights up automatically the day BLM publishes one.
    ownerFields: ['CLAIMANT_NAME', 'CLAIMANT', 'CLMNT_NAME', 'CLAIMANT_TXT', 'CUST_NAME', 'CUSTOMER_NAME'],
    // Recording-date candidates, used to break ties when ranking jurisdictions
    // by area (see normalizeProps → RECORDED_DATE). Unverified against the live
    // layer — absent fields simply mean no tie-breaker is available.
    recordDateFields: ['CSE_RCRD_DT', 'RCRD_DT', 'CSE_FILE_DT', 'LOCATION_DT', 'LOC_DT'],
  },
]));

// Unified lookup: Canadian ArcGIS provinces + US BLM state jurisdictions.
function getArcgisJurisdiction(province) {
  return ARCGIS_PROVINCES[province] || US_JURISDICTIONS[province] || null;
}

const FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; ExplorationMaps/1.0; +https://explorationmaps.com)',
  Referer: 'https://explorationmaps.com/',
  Origin: 'https://explorationmaps.com',
};

// Some provincial WAFs/CDNs (notably dnrmaps.gov.nl.ca) block our identifying
// bot UA + Referer/Origin combo and return an HTML challenge page instead of
// JSON. Retry once looking like a plain browser before giving up.
const FALLBACK_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Upgrade-Insecure-Requests': '1',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Registry-proxy error → HTTP response. Distinguishes a slow upstream (the
// query itself is too broad — a narrower term usually succeeds) from an
// unreachable one, instead of labeling both "failed to reach".
function upstreamErrorResponse(res, e, fallback) {
  if (e?.registryMoved) {
    // Loud in the function logs (the full from → to is what an operator needs),
    // short and honest for the user.
    console.error('[claims] registry moved:', e.message);
    return res.status(502).json({
      error: 'The registry service has moved, so this search is temporarily unavailable. Try again later.',
      code: 'registry_moved',
    });
  }
  if (e?.name === 'TimeoutError' || /timed?\s?out/i.test(String(e?.message || ''))) {
    return res.status(504).json({
      error: 'The registry is responding slowly right now — try a more specific search (full claim name or exact serial number), or try again shortly.',
    });
  }
  return res.status(502).json({ error: publicErrorMessage(e, fallback) });
}

function looksLikeHtml(body, contentType) {
  return /html/i.test(contentType || '') || /^\s*<(!doctype|html)/i.test(body || '');
}

// Module-scope metadata cache (persists across warm invocations).
//
// EVERY ENTRY EXPIRES, and a degraded one expires fast. Without a TTL this Map
// turns a momentary upstream problem into a lasting one: if a provincial
// service is slow or blocking for the few seconds we resolve its layer,
// resolveLayerAndFields falls back to a layer that has no usable search field,
// caches that, and every later request on the same warm instance answers
// "search is not available here" until the instance recycles. A thirty-second
// blip becomes hours of "no results" — with nothing in the logs, because from
// the handler's point of view it answered successfully.
//
// So a good resolution is cached for a while, and anything degraded is cached
// only long enough to avoid hammering a struggling service.
const metaCache = new Map();
const META_TTL_MS = 10 * 60 * 1000;         // healthy metadata
const META_DEGRADED_TTL_MS = 60 * 1000;     // a fallback we would rather retry

function cacheGet(key) {
  const hit = metaCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    metaCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value, ttl = META_TTL_MS) {
  metaCache.set(key, { value, expires: Date.now() + ttl });
}

async function fetchJson(url, opts = {}) {
  // Try the URL as given, then (only if it fails outright) upgraded to https.
  // Some provincial gov ArcGIS hosts answer on https even when http is the
  // documented endpoint — notably maps.gov.mb.ca. The reverse downgrade is
  // deliberately NOT attempted: falling back to plaintext when https fails
  // would let anyone able to break a TLS connection substitute the registry's
  // answer, and every configured service speaks https today.
  const variants = [url];
  if (/^http:\/\//i.test(url)) variants.push(url.replace(/^http:/i, 'https:'));

  let lastErr;
  for (const u of variants) {
    try {
      return await fetchJsonOnce(u, opts);
    } catch (e) {
      lastErr = e;
      // A moved service is not fixed by trying the other scheme.
      if (e?.registryMoved) break;
    }
  }
  throw lastErr;
}

/**
 * A redirect is only followed when it keeps the request's path.
 *
 * BLM moved its national claims service in October 2026 by answering every
 * request with a 301 to the bare REST root of a new host — path and query
 * dropped. fetch followed it, got a service catalogue instead of a layer, and
 * the failure surfaced as "the schema changed", far from its cause. A redirect
 * that keeps the path (http → https, a host rename) is harmless and followed;
 * one that changes it means the thing we asked for is not there any more, and
 * it is reported as exactly that.
 */
export class RegistryMovedError extends Error {
  constructor(from, location, status) {
    let to = location || '(no Location header)';
    try { to = new URL(location, from).href; } catch { /* keep raw */ }
    let fromShort = from;
    try { const f = new URL(from); fromShort = `${f.origin}${f.pathname}`; } catch { /* keep raw */ }
    super(`The registry service has moved (HTTP ${status} from ${fromShort} to ${to}). Try again later.`);
    this.name = 'RegistryMovedError';
    this.registryMoved = true;
    this.from = from;
    this.location = to;
    this.status = status;
  }
}

/** null = not a redirect; {follow} = same path elsewhere; {error} = moved. */
export function redirectTarget(fromUrl, response) {
  const status = Number(response?.status);
  if (!(status >= 300 && status < 400)) return null;
  const location = response.headers?.get?.('location') || null;
  let target = null;
  try { target = location ? new URL(location, fromUrl) : null; } catch { target = null; }
  const from = new URL(fromUrl);
  const trim = (p) => p.replace(/\/+$/, '');
  if (target && trim(target.pathname) === trim(from.pathname)) {
    // Same resource elsewhere: follow, keeping our query if the target dropped it.
    if (!target.search) target.search = from.search;
    return { follow: target.href };
  }
  return { error: new RegistryMovedError(fromUrl, location, status) };
}

async function fetchFollowingSafeRedirects(url, init) {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    const r = await fetch(current, { ...init, redirect: 'manual' });
    const redirect = redirectTarget(current, r);
    if (!redirect) return r;
    if (redirect.error) throw redirect.error;
    current = redirect.follow;
  }
  throw new RegistryMovedError(url, current, 310);
}

async function fetchJsonOnce(url, { timeoutMs = 20000 } = {}) {
  // Transient gateway errors (502/503/504) are common on older provincial
  // ArcGIS stacks — notably maps.gov.mb.ca, whose front-end reverse proxy
  // intermittently returns "502 invalid response while acting as a gateway"
  // when its backend is busy. Retry a couple of times with backoff before
  // giving up so a flaky upstream doesn't surface as a hard failure.
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    r = await fetchFollowingSafeRedirects(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (r.ok) return r.json();

    let body = await r.text().catch(() => '');
    // Some provincial WAFs block our bot UA outright (403/406) regardless of
    // whether the block page is HTML or a bare error status — retry once with
    // a generic browser identity before surfacing anything as unavailable.
    const looksBlocked = looksLikeHtml(body, r.headers.get('content-type')) || r.status === 403 || r.status === 406;
    if (looksBlocked) {
      const retry = await fetchFollowingSafeRedirects(url, { headers: FALLBACK_FETCH_HEADERS, signal: AbortSignal.timeout(timeoutMs) })
        .catch((e) => { if (e?.registryMoved) throw e; return null; });
      if (retry?.ok) return retry.json();
      if (retry) { r = retry; body = await retry.text().catch(() => ''); }
    }

    // Retry transient gateway 5xx; fall through to throw on anything else.
    if (r.status === 502 || r.status === 503 || r.status === 504) continue;

    if (looksLikeHtml(body, r.headers.get('content-type'))) {
      throw new Error(`Upstream ${r.status}: the registry is blocking automated requests or is temporarily unavailable. Try again later.`);
    }
    throw new Error(`Upstream ${r.status}: ${body.slice(0, 500)}`);
  }
  throw new Error(`Upstream ${r?.status || 502}: the registry's gateway is returning errors right now. Try again shortly.`);
}

async function resolveFields(layerUrl) {
  const cacheKey = `fields:${layerUrl}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const meta = await fetchJson(`${layerUrl}?f=json`);
  const fields = (meta?.fields || []).map((f) => ({ name: f.name, type: f.type }));
  if (!fields.length) throw new Error('Layer has no queryable fields');
  cacheSet(cacheKey, fields);
  // Stash the paging-relevant layer capabilities under a sibling key so the
  // pagination code can respect the server's own limits.
  cacheSet(`layermeta:${layerUrl}`, {
    maxRecordCount: Number(meta?.maxRecordCount) || 1000,
    supportsPagination: Boolean(meta?.advancedQueryCapabilities?.supportsPagination),
    objectIdField: meta?.objectIdField || (meta?.fields || []).find((f) => f.type === 'esriFieldTypeOID')?.name || 'OBJECTID',
  });
  return fields;
}

// Layer paging capabilities; safe defaults when metadata was unreadable.
async function resolveLayerMeta(layerUrl) {
  const key = `layermeta:${layerUrl}`;
  if (cacheGet(key) === undefined) {
    try { await resolveFields(layerUrl); } catch { /* url-only fallback layers */ }
  }
  return cacheGet(key) || { maxRecordCount: 1000, supportsPagination: false, objectIdField: 'OBJECTID' };
}

// Fetch EVERY page of an ArcGIS query (attribute or spatial), honoring the
// server's maxRecordCount and pagination support, deduplicating by object id,
// and reporting honest completeness metadata. Strategy ladder:
//  1. supportsPagination → resultOffset/resultRecordCount loop
//  2. otherwise         → returnIdsOnly (authoritative total) + objectIds batches
//  3. ids query failed  → single legacy capped query, marked truncated if full
// A config may force strategy 2 (`paging: { strategy: 'ids' }`) where offset
// paging is supported but unusably slow — see arcgisQueryByIds.
async function arcgisQueryAll(layerUrl, baseParams, maxTotal = undefined, paging = null) {
  if (paging?.strategy === 'ids') return arcgisQueryByIds(layerUrl, baseParams, maxTotal, paging);
  const layerMeta = await resolveLayerMeta(layerUrl);
  const pageSize = Math.min(Math.max(layerMeta.maxRecordCount, 1), 1000, maxTotal || Infinity);
  const idField = layerMeta.objectIdField;

  if (layerMeta.supportsPagination) {
    return fetchAllPages({
      provider: 'arcgis',
      pageSize,
      // A large holder's LIKE search costs the registry ~5s a page, paged in
      // order that is 15-20s; three at a time is about one page's wait.
      concurrency: 3,
      ...(maxTotal ? { maxTotal } : {}),
      idField,
      fetchPage: async (offset, count) => {
        const url = `${layerUrl}/query?${new URLSearchParams({
          ...baseParams,
          // Deterministic paging: without an explicit sort, ArcGIS offset
          // pages can repeat/skip rows under load on large layers (the BLM
          // national layer especially), which surfaces as flaky errors.
          orderByFields: idField,
          resultOffset: String(offset),
          resultRecordCount: String(count),
          f: 'geojson',
        })}`;
        const data = await fetchQueryGeoJSON(url);
        if (!Array.isArray(data.features)) throw new Error('Unexpected response from provincial map service');
        return { features: data.features };
      },
    });
  }

  // No pagination support: object-ids two-phase fetch.
  try {
    const idsUrl = `${layerUrl}/query?${new URLSearchParams({ ...baseParams, returnIdsOnly: 'true', f: 'json' })}`;
    const idResp = await fetchJson(idsUrl);
    const ids = Array.isArray(idResp?.objectIds) ? idResp.objectIds : null;
    if (!ids) throw new Error('no objectIds');
    // Honour the caller's ceiling here too. Without this a widened near-miss
    // rung would fetch thousands of ids from a layer that cannot paginate, only
    // for the caller to keep fifty.
    const capped = ids.slice(0, Math.min(MAX_TOTAL_FEATURES, maxTotal || MAX_TOTAL_FEATURES));
    const features = [];
    let pagesFetched = 0;
    let failedLate = false;
    const CHUNK = 100;
    for (let i = 0; i < capped.length && pagesFetched < MAX_PAGES * 4; i += CHUNK) {
      const chunk = capped.slice(i, i + CHUNK);
      const url = `${layerUrl}/query?${new URLSearchParams({
        objectIds: chunk.join(','),
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        f: 'geojson',
      })}`;
      try {
        const data = await fetchQueryGeoJSON(url);
        pagesFetched += 1;
        for (const f of data.features || []) features.push(f);
      } catch (e) {
        if (pagesFetched === 0) throw e;
        failedLate = true;
        break;
      }
    }
    const truncated = failedLate || ids.length > capped.length || features.length < capped.length;
    return {
      features,
      meta: { totalKnown: ids.length, returned: features.length, truncated, pagesFetched: pagesFetched + 1, provider: 'arcgis' },
    };
  } catch {
    // Ids phase unavailable — single legacy query, honestly flagged when full.
    const url = `${layerUrl}/query?${new URLSearchParams({ ...baseParams, resultRecordCount: String(maxTotal || 2000), f: 'geojson' })}`;
    const data = await fetchQueryGeoJSON(url);
    if (!Array.isArray(data.features)) throw new Error('Unexpected response from provincial map service');
    const limit = maxTotal || 2000;
    return {
      features: data.features,
      meta: { totalKnown: null, returned: data.features.length, truncated: data.features.length >= limit, pagesFetched: 1, provider: 'arcgis' },
    };
  }
}

// Short-lived, per-process cache of ids-first query results. A US search is
// usually followed within a minute by the nearby-claims overlay or a re-run
// with a filter, and every one of those costs BLM seconds. Five minutes keeps
// the answer current enough for an active-claims layer that changes daily.
const queryCache = new Map();
const QUERY_TTL_MS = 5 * 60 * 1000;
const QUERY_CACHE_MAX = 60;

function queryCacheGet(key) {
  const hit = queryCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { queryCache.delete(key); return null; }
  return hit.value;
}

function queryCacheSet(key, value) {
  if (queryCache.size >= QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value);
  queryCache.set(key, { value, expires: Date.now() + QUERY_TTL_MS });
}

/**
 * Ids first, then the rows in parallel objectIds batches.
 *
 * Measured against BLM's MapServer/1 (Oct 2026), for one 0.3° bbox of 3,013
 * claims near Carlin NV:
 *   resultOffset page of 500, with or without geometry   31-36 s
 *   returnIdsOnly for the whole bbox                       3-5 s
 *   2,000 rows as 8 objectIds batches of 250, in parallel  ~1.2 s
 * so the same answer costs ~5 s instead of minutes. Batches are fetched
 * `concurrency` at a time; a batch that fails after the first succeeded marks
 * the result truncated rather than failing the search.
 */
async function arcgisQueryByIds(layerUrl, baseParams, maxTotal, paging) {
  const cacheKey = `${layerUrl}|${JSON.stringify(baseParams)}|${maxTotal || ''}`;
  const cached = queryCacheGet(cacheKey);
  if (cached) return { features: cached.features, meta: { ...cached.meta, cached: true } };

  const timeoutMs = paging.timeoutMs || 20000;
  const { outFields = '*', returnGeometry = 'true', outSR = '4326', geometryPrecision, ...filter } = baseParams;
  const idsUrl = `${layerUrl}/query?${new URLSearchParams({ ...filter, returnIdsOnly: 'true', f: 'json' })}`;
  let idResp = await fetchJson(idsUrl, { timeoutMs });
  if (idResp?.error) {
    // Same intermittent in-body SDE error fetchQueryGeoJSON retries once.
    await sleep(700);
    idResp = await fetchJson(idsUrl, { timeoutMs });
  }
  if (idResp?.error) throw new Error(`ArcGIS error: ${JSON.stringify(idResp.error).slice(0, 480)}`);
  // ArcGIS answers "no matches" with objectIds: null (not []), next to the
  // objectIdFieldName that marks it as a real ids response.
  const ids = Array.isArray(idResp?.objectIds) ? [...idResp.objectIds].sort((a, b) => a - b)
    : (idResp && 'objectIdFieldName' in idResp && idResp.objectIds == null ? [] : null);
  if (!ids) throw new Error('Unexpected response from the registry (no object ids).');
  const ceiling = Math.min(MAX_TOTAL_FEATURES, maxTotal || MAX_TOTAL_FEATURES);
  const capped = ids.slice(0, ceiling);

  const chunkSize = paging.chunk || 250;
  const chunks = [];
  for (let i = 0; i < capped.length; i += chunkSize) chunks.push(capped.slice(i, i + chunkSize));
  const results = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const idx = next++;
      const url = `${layerUrl}/query?${new URLSearchParams({
        objectIds: chunks[idx].join(','),
        outFields,
        returnGeometry,
        outSR,
        ...(geometryPrecision ? { geometryPrecision } : {}),
        f: 'geojson',
      })}`;
      try {
        results[idx] = { features: (await fetchQueryGeoJSON(url, { timeoutMs })).features || [] };
      } catch (error) {
        results[idx] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(paging.concurrency || 4, chunks.length) }, worker));

  const ok = results.filter((r) => r && !r.error);
  if (chunks.length && !ok.length) throw results.find((r) => r?.error)?.error || new Error('Registry query failed');
  const features = ok.flatMap((r) => r.features);
  const failed = results.length - ok.length;
  const meta = {
    totalKnown: ids.length,
    returned: features.length,
    truncated: failed > 0 || ids.length > capped.length || features.length < capped.length,
    pagesFetched: ok.length + 1,
    provider: 'arcgis',
  };
  if (!failed) queryCacheSet(cacheKey, { features, meta });
  return { features, meta };
}

/**
 * The service's real layer catalogue, for diagnostics only.
 *
 * Never used to resolve a query — a wrong guess here must not change what a
 * user gets back. It exists so `?schema=1` can answer "is layer 3 still the
 * Mining Claim leaf?" without anybody having to open the ArcGIS endpoint by
 * hand, which is the check that would have caught a silent reindex.
 */
async function describeServiceLayers(cfg) {
  try {
    const svc = await fetchJson(`${cfg.service}?f=json`);
    return (svc?.layers || []).map((l) => `${l.id}: ${l.name}${l.subLayerIds ? ' (group)' : ''}`);
  } catch (e) {
    return [`unavailable: ${String(e?.message || e).slice(0, 200)}`];
  }
}

async function listCandidateLayers(cfg) {
  if (cfg.layerId != null) return [{ id: cfg.layerId, name: `layer ${cfg.layerId}` }];
  const svc = await fetchJson(`${cfg.service}?f=json`);
  const matches = (svc?.layers || []).filter((l) => cfg.layerMatch.test(l.name || ''));
  if (!matches.length) throw new Error(`No layer matching ${cfg.layerMatch} in service`);
  // Prefer leaf layers over group layers
  return matches.sort((a, b) => (a.subLayerIds ? 1 : 0) - (b.subLayerIds ? 1 : 0));
}

// Some services expose several layers with similar names (e.g. GeoYukon has
// multiple "Quartz Claims" layers at different scales, some with only an ID
// field, and owner vs. number fields may live on different layers). Resolve
// against the field list for the *requested* search type so a layer that only
// has the owner field is never cached for a number search, and vice versa.
// Cached separately per search type for the same reason.
async function resolveLayerAndFields(cfg, type) {
  const wanted = type === 'number' ? cfg.numberFields
    : type === 'name' ? (cfg.nameFields || [])
    : cfg.ownerFields;
  const variant = type === 'number' ? 'number' : type === 'name' ? 'name' : 'owner';
  const cacheKey = `resolved:${cfg.service}:${cfg.layerMatch || cfg.layerId}:${variant}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const candidates = await listCandidateLayers(cfg);
  let fallback = null;       // layer that resolved fields but didn't have the wanted field
  let urlOnlyFallback = null; // layer whose field metadata failed — URL still usable for bbox
  for (const layer of candidates.slice(0, 6)) {
    const layerUrl = `${cfg.service}/${layer.id}`;
    let fields;
    try {
      fields = await resolveFields(layerUrl);
    } catch (e) {
      // A moved service is not a layer with unreadable metadata: carrying on
      // with an empty field list is exactly how the October 2026 BLM move
      // surfaced as "the schema changed" instead of "the service moved".
      if (e?.registryMoved) throw e;
      // Keep the layer URL even if field metadata is unavailable — the bbox path
      // only needs a valid query endpoint, not field names.
      if (!urlOnlyFallback) urlOnlyFallback = { layerUrl, layerName: layer.name, fields: [] };
      continue;
    }
    const resolved = { layerUrl, layerName: layer.name, fields };
    if (pickField(wanted, fields)) {
      cacheSet(cacheKey, resolved);
      return resolved;
    }
    if (!fallback) fallback = resolved;
  }
  // Nothing carried the field we wanted. Answer with the best we have, but
  // cache it only briefly and mark it: this is the state that used to stick for
  // the life of the instance and report "search is not available here" long
  // after the service recovered.
  const best = fallback || urlOnlyFallback;
  if (best) {
    cacheSet(cacheKey, { ...best, degraded: true }, META_DEGRADED_TTL_MS);
    return { ...best, degraded: true };
  }
  throw new Error('No usable claims layer found in service');
}

function pickField(candidates, fields) {
  for (const cand of candidates) {
    const hit = fields.find((f) => f.name.toUpperCase() === cand.toUpperCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * Every candidate that exists on the layer, in candidate order.
 *
 * pickField answers "which one field do we search", which is right for an owner
 * or a claim name — those are one value with several possible column names.
 * A claim NUMBER is not that. A title routinely carries more than one
 * identifier, published in more than one column, and the registry's users know
 * it by whichever one they were given.
 *
 * Manitoba is the case that showed this up: numberFields is
 * ['TENURE_NUMBER_ID', 'TAG_NUMBER'], both exist on the layer, and pickField
 * returns the first — so TAG_NUMBER was unreachable, while the search box
 * placeholder told people to type exactly a staking tag ("e.g. CB12345").
 * BLM had already needed the same thing and got it as a hard-coded special
 * case for its legacy serial; this generalizes that rather than repeating it.
 */
function pickFields(candidates, fields) {
  const out = [];
  for (const cand of candidates) {
    const hit = fields.find((f) => f.name.toUpperCase() === cand.toUpperCase());
    if (hit && !out.some((o) => o.name.toUpperCase() === hit.name.toUpperCase())) out.push(hit);
  }
  return out;
}

function escapeSql(term) {
  return term.replace(/'/g, "''");
}

/**
 * Legal-entity suffixes, which identify the WRAPPER rather than the company.
 *
 * Deliberately short. Every entry here is a word that carries no identifying
 * information, so dropping it can only widen a search. Words like HOLDINGS,
 * MINING, RESOURCES, METALS or GOLD are NOT here even though they are common:
 * they distinguish real companies from each other, and discarding them would
 * make a search less precise rather than more forgiving.
 */
const LEGAL_SUFFIX_TOKENS = new Set([
  'ltd', 'ltee', 'limited', 'limitee',
  'inc', 'incorporated', 'incorporee',
  'corp', 'corporation',
  'co', 'company',
  'ulc', 'llc', 'lp', 'llp', 'plc', 'pty', 'gmbh',
]);

/**
 * Split a company name into the words a search should actually require.
 *
 * WHY THIS EXISTS — the numbers, from search_events on the live site:
 *
 *   query length      searches   returned nothing
 *   1-8 chars (one word)    35         26%
 *   9-15 chars              12         50%
 *   16-24 chars             10         10%
 *   25+ chars (full name)   10        100%
 *
 * EVERY search of a full legal company name failed. All ten of them. Matching
 * was one contiguous `ILIKE '%term%'`, so the whole string — spacing,
 * punctuation, word order and legal suffix — had to appear verbatim in the
 * registry's own rendering of the name. Against the B.C. mirror:
 *
 *   'ximen mining corp.'  →  0 hits   (registry holds "XIMEN MINING CORP", no dot)
 *   'ximen'               →  543 hits
 *
 * So the product punished users for being precise: type the company's real
 * name and get nothing, type one word and it works. Nobody could have guessed
 * that rule, and the drop-off report shows people leaving rather than retrying.
 *
 * Requiring each word separately fixes punctuation, spacing, word order and
 * suffix mismatch in one move, and does NOT make the search vaguer: a name is
 * still matched on all of its meaningful words.
 *
 * Returns [] when the term has nothing but suffixes in it (somebody searching
 * "Ltd"), so callers fall back to the raw term rather than matching everything.
 */
export function ownerSearchTokens(term) {
  const tokens = String(term || '')
    // Punctuation to spaces: "B.C. LTD." and "BC LTD" become the same words,
    // and a trailing comma in "SCOTT, STEVEN" stops gluing itself to a name.
    //
    // Apostrophes and hyphens are deliberately NOT in this set. They sit inside
    // a word rather than between two, and both sides render them the same way,
    // so splitting on them would turn "O'Brien" into a useless single letter
    // plus "brien" — and searching for `%obrien%` instead would match nothing
    // at all, since the registry holds O'BRIEN with the apostrophe.
    .replace(/[.,"()/\\&]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Case is preserved in the tokens themselves. Both callers are already
  // case-insensitive — CQL `ILIKE` for B.C., `UPPER(f) LIKE UPPER(...)` for the
  // ArcGIS provinces — so lowercasing would change nothing about what matches
  // while making the generated filter harder to read against a server log.
  // Only the suffix comparison is case-folded.
  const meaningful = tokens.filter((t) => !LEGAL_SUFFIX_TOKENS.has(t.toLowerCase()));
  // "Ltd" alone is all suffix — keep what was typed rather than dropping to a
  // match-everything query.
  return meaningful.length ? meaningful : tokens;
}

/**
 * Build a case-insensitive LIKE clause with the pattern metacharacters escaped.
 *
 * escapeSql only doubles quotes, which stops injection but leaves `%` and `_`
 * live as wildcards. A term of `%` therefore became `LIKE UPPER('%%%')` — a
 * match-everything pattern that asks a provincial server for its entire claim
 * layer, from an endpoint anonymous callers can reach. Not an injection, but an
 * amplifier: one short request turning into a full-layer scan upstream.
 *
 * searchBc in this same file has always escaped these (`.replace(/%/g, '\\%')`
 * for its CQL filter) and so does api/tenure-search.js. The ArcGIS path simply
 * never did, so this brings it in line rather than inventing a convention.
 *
 * THE ESCAPE CLAUSE IS ONLY EMITTED WHEN THE TERM ACTUALLY NEEDS IT. Support
 * for `ESCAPE` varies across the seven provincial ArcGIS servers this talks to,
 * none of which are reachable from CI, and appending it unconditionally would
 * risk turning every working search into a 400 to fix a case that almost never
 * occurs. A term with no metacharacter produces byte-identical SQL to before.
 */
function likeClause(fieldName, rawTerm, { prefix = false, storedUpper = false } = {}) {
  const raw = String(rawTerm);
  const escaped = raw.replace(/[\\%_]/g, '\\$&');
  const body = escapeSql(escaped);
  const pattern = prefix ? `${body}%` : `%${body}%`;
  const esc = escaped === raw ? '' : " ESCAPE '\\'";
  // A registry that stores identifiers in capitals and compares text
  // case-insensitively (BLM — cfg.valuesUpperCase) gets the column compared
  // raw against an upper-cased pattern: wrapping the column in UPPER()
  // stops the server from using its index, which on BLM's national layer turns
  // a one-second prefix lookup into a 25-second scan.
  if (storedUpper) return `${fieldName} LIKE '${pattern.toUpperCase()}'${esc}`;
  return `UPPER(${fieldName}) LIKE UPPER('${pattern}')${esc}`;
}

/** Exact match on an identifier, index-friendly where the column is stored upper-case. */
function equalsClause(fieldName, rawTerm, { storedUpper = false } = {}) {
  const v = escapeSql(String(rawTerm).toUpperCase());
  return storedUpper ? `${fieldName} = '${v}'` : `UPPER(${fieldName}) = '${v}'`;
}

function isStringType(field) {
  return field.type === 'esriFieldTypeString';
}

// Convert ArcGIS esri JSON (f=json) to GeoJSON. Used as fallback when a server
// returns 500 for f=geojson (ArcGIS Server < 10.3 doesn't support that format).
// Ring classification (exterior vs hole vs separate polygon) lives in
// _lib/esri.js — see that file for the algorithm.
function esriToGeoJSON(esriResult) {
  const features = (esriResult?.features || []).map((f) => ({
    type: 'Feature',
    geometry: esriGeometryToGeoJSON(f.geometry),
    properties: f.attributes || {},
  }));
  return { type: 'FeatureCollection', features };
}

// Fetch a query URL, trying f=geojson first and falling back to f=json + convert
// if the server returns a non-2xx (older ArcGIS servers pre-10.3).
async function fetchQueryGeoJSONOnce(queryUrl, opts = {}) {
  try {
    const data = await fetchJson(queryUrl, opts);
    if (data.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error).slice(0, 480)}`);
    // Real GeoJSON has a `type` key; esri JSON has `objectIdFieldName` etc.
    if (data.type === 'FeatureCollection') return data;
    // Server returned esri JSON even though we asked for geojson — convert it
    return esriToGeoJSON(data);
  } catch (firstErr) {
    // Only retry on 4xx/5xx (upstream errors), not on parse/in-body errors
    if (!firstErr.message?.startsWith('Upstream')) throw firstErr;
    // Replace f=geojson with f=json in the URL and retry
    const fallbackUrl = queryUrl.replace(/([?&])f=geojson(&|$)/, '$1f=json$2');
    if (fallbackUrl === queryUrl) throw firstErr; // no replacement → rethrow
    const data = await fetchJson(fallbackUrl, opts);
    if (data.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error).slice(0, 480)}`);
    return esriToGeoJSON(data);
  }
}

// SDE-backed ArcGIS servers (BLM's national layer especially) intermittently
// return HTTP 200 with an in-body {error} on expensive scans; a single retry
// after a short pause recovers most of them, so one flaky page doesn't fail
// the whole search.
async function fetchQueryGeoJSON(queryUrl, opts = {}) {
  try {
    return await fetchQueryGeoJSONOnce(queryUrl, opts);
  } catch (e) {
    if (!/^ArcGIS error/.test(e?.message || '')) throw e;
    await sleep(700);
    return fetchQueryGeoJSONOnce(queryUrl, opts);
  }
}

// Map raw ArcGIS properties onto the BC-style keys the UI renders.
// Map official BLM case-type text onto the app's normalized claim types.
// Based on MLRS case-type wording (LODE CLAIM / PLACER CLAIM / MILL SITE /
// TUNNEL SITE); anything else is preserved verbatim and classified 'other'.
function normalizeUsClaimType(text) {
  if (!text) return 'unknown';
  const t = String(text).toLowerCase();
  if (t.includes('lode')) return 'lode';
  if (t.includes('placer')) return 'placer';
  if (t.includes('mill')) return 'mill_site';
  if (t.includes('tunnel')) return 'tunnel_site';
  return 'other';
}

const ACRES_PER_HECTARE = 2.47105;

// BLM render-field candidates (normalizeProps), also used to build the US
// outFields projection so a renamed column is still fetched.
const US_TYPE_FIELDS = ['BLM_PROD', 'CSE_TYPE_TXT', 'CASETYPE_TXT', 'CSE_TYPE', 'CASE_TYPE', 'CASE_TYPE_TXT'];
const US_DISP_FIELDS = ['CSE_DISP', 'CSE_DISP_TXT', 'DISP_TXT', 'CASE_DISP', 'DISPOSITION'];
const US_ACRES_FIELDS = ['RCRD_ACRS', 'ACRES', 'RECORD_ACRES', 'RCRD_ACRES'];

function normalizeProps(props, cfg = null) {
  if (!props) return {};
  const keys = Object.keys(props);
  const findKey = (re, requireString = false) =>
    keys.find((k) => re.test(k) && (!requireString || typeof props[k] === 'string'));

  const out = { ...props };

  // ── BLM MLRS (US federal claims): explicit mapping FIRST, so US records
  // are never forced through Canadian-convention inference. Original BLM
  // values stay on the object untouched (spread above) for traceability.
  if (cfg?.provider === 'blm-mlrs') {
    const pick = (cands) => {
      for (const c of cands || []) {
        const k = keys.find((key) => key.toUpperCase() === c.toUpperCase());
        if (k && props[k] != null && props[k] !== '') return props[k];
      }
      return null;
    };
    const serial = pick(cfg.numberFields);
    const legacy = pick(cfg.legacyNumberFields);
    const name = pick(cfg.nameFields);
    // BLM_PROD ("BLM Product", e.g. lode/placer claim wording) and CSE_DISP
    // ("Case Disposition") are the names on the live layer; the rest are
    // drift tolerance.
    const typeText = pick(US_TYPE_FIELDS);
    const disp = pick(US_DISP_FIELDS);
    const acres = pick(US_ACRES_FIELDS);
    const stateVal = pick([...(cfg.geoStateFields || []), ...(cfg.adminStateFields || [])]);
    const recordDate = pick(cfg.recordDateFields);

    if (serial != null) out.TAG_NUMBER = String(serial);
    if (legacy != null) out.LEGACY_NR = String(legacy);
    if (name != null) out.CLAIM_NAME = String(name);
    if (typeText != null) out.TITLE_TYPE_DESCRIPTION = String(typeText);
    out.CLAIM_TYPE = normalizeUsClaimType(typeText);
    if (disp != null) out.STATUS = String(disp);
    if (acres != null && Number.isFinite(Number(acres))) {
      out.AREA_IN_HECTARES = Number(acres) / ACRES_PER_HECTARE;
    }
    // Recording date — used only to break ties when ranking jurisdictions by
    // area. Kept under its own key, never mapped onto GOOD_TO_DATE: this is
    // when the case was recorded, not when anything expires.
    if (recordDate != null) {
      out.RECORDED_DATE = typeof recordDate === 'number' && recordDate > 1e10
        ? new Date(recordDate).toISOString().slice(0, 10)
        : String(recordDate);
    }
    out.US_STATE = stateVal != null ? String(stateVal) : cfg.usState;
    out.SOURCE_SYSTEM = 'BLM MLRS';
    // PLSS-derived boundaries: generalized representations, not legal surveys.
    out.GEOM_GENERALIZED = true;
    // Deliberately NO GOOD_TO_DATE inference for US records — BLM assessment/
    // anniversary semantics differ from Canadian expiry and mislabeling a
    // date as "expires" would be worse than omitting it.
    return out;
  }
  if (out.OWNER_NAME == null) {
    // Second pass covers licence-based registries (NL licensee, MB claimant)
    // without changing how existing provinces resolve — those hit the first match.
    const k = findKey(/OWNER|HOLDER|CLIENT/i, true)
      || findKey(/LICENSEE|LICEN[CS]E_HOLDER|OPERATOR|CLAIMANT|COMPANY/i, true);
    if (k) out.OWNER_NAME = props[k];
  }
  if (out.TAG_NUMBER == null) {
    // DISPOSIT_1 is Saskatchewan's string disposition number (truncated name)
    const k = findKey(/TAG_NUMBER|GRANT_NUM|DISPOSITION_NUM|CLAIM_NUM|TENURE_NUM|DISPOSIT_1/i)
      || findKey(/NUMBER|DISPOSIT/i)
      || findKey(/LICEN[CS]E_NO|LICEN[CS]E_NUM|CLAIM_NO|MASTER_NO|GRANT_NO/i);
    if (k) out.TAG_NUMBER = props[k];
  }
  if (out.AREA_IN_HECTARES == null) {
    const k = findKey(/HECTARE|_HA$/i);
    if (k && Number.isFinite(Number(props[k]))) out.AREA_IN_HECTARES = Number(props[k]);
  }
  if (out.GOOD_TO_DATE == null) {
    // GOODSTANDI is Saskatchewan's good-standing date (truncated name)
    const k = findKey(/GOOD_TO|GOODSTAND|EXPIR|END_DATE|ANNIVERS/i)
      || findKey(/GOOD.?STAND|DUE_DATE|RENEW|VALID_TO|RECORDED_TO/i);
    if (k && props[k] != null) {
      const v = props[k];
      // ArcGIS GeoJSON emits dates as epoch milliseconds
      out.GOOD_TO_DATE = typeof v === 'number' && v > 1e10
        ? new Date(v).toISOString().slice(0, 10)
        : String(v);
    }
  }
  // A layer can expose GOOD_TO_DATE literally (e.g. Manitoba iMaQs), in which
  // case the spread above kept the raw epoch-ms number — convert it too.
  if (typeof out.GOOD_TO_DATE === 'number' && out.GOOD_TO_DATE > 1e10) {
    out.GOOD_TO_DATE = new Date(out.GOOD_TO_DATE).toISOString().slice(0, 10);
  }
  if (out.TITLE_TYPE_DESCRIPTION == null) {
    // Prefer human-readable *_DESC fields over *_CODE fields (e.g. Ontario
    // has both TITLE_TYPE_CODE and TITLE_TYPE_DESC)
    const k = findKey(/TYPE_DESC/i, true)
      || findKey(/TENURE_TYPE|DISPOSITION_TYPE|CLAIM_TYPE|TITLE_TYPE|_TYPE$|^TYPE$/i, true);
    if (k) out.TITLE_TYPE_DESCRIPTION = props[k];
  }
  return out;
}

// Resolve the per-jurisdiction scoping clause (US: state filter). Returns null
// when the jurisdiction needs no scoping (Canadian provinces), or throws a
// user-facing error when scoping is required but unresolvable — returning
// nationwide results labeled as one state would be worse.
//
// The returned `method` is reported to the client verbatim and drives the UI's
// degraded-scoping banner. NOTHING may scope a US claim set without declaring
// which of these three it used:
//
//   geo_state     GEO_STATE — where the land actually is. The only precise mode.
//   admin_state   ADMIN_STATE — which BLM office administers the case. This is
//                 ADMINISTRATIVE, NOT GEOGRAPHIC. The two diverge: one state
//                 office can administer cases in another state (the Oregon/
//                 Washington office covers both states, so Washington ground
//                 carries an Oregon administering office). Under this mode a
//                 state's claim set can therefore both omit claims inside its
//                 borders and include claims outside them.
//   serial_prefix Prefix of the case serial. Same administrative caveat, plus
//                 it depends on the serial format itself not having drifted.
//
//   legal_description  Per row, from the claim's own location: GEO_STATE where
//                 BLM filled it in, otherwise the state that leads each PLSS
//                 legal description in CSE_META ("NV 21 0330N 0510E 033 A SE").
//                 Geographic, like geo_state. See usRowState.
//
// Both degraded modes are surfaced to the user rather than silently applied.
//
// A FIELD THAT EXISTS IS NOT A FIELD THAT IS FILLED. The October 2026 layer
// publishes GEO_STATE and ADMIN_STATE, but GEO_STATE is NULL on 88% of rows and
// ADMIN_STATE on 64% (GEO_STATE = 'NV' matched one claim out of ~280,000).
// Filtering on either in SQL returned an almost empty, perfectly plausible
// Nevada. So when the layer carries a geographic field or a legal description,
// the state is decided per row instead (resolveUsRowScoping), where a NULL
// simply falls through to the next source of truth, and SQL only narrows the
// query by serial prefix. The whole-set SQL modes below remain for a layer
// that carries neither.
function resolveUsScoping(cfg, fields) {
  if (!cfg.usState) return null;
  const perRow = resolveUsRowScoping(cfg, fields);
  if (perRow) return perRow;
  const stateCode = escapeSql(cfg.usState).toUpperCase();
  const usable = (f) => f && /^[A-Za-z0-9_.]+$/.test(f.name);

  const geoField = pickField(cfg.geoStateFields || [], fields);
  if (usable(geoField)) {
    return { where: `UPPER(${geoField.name}) = '${stateCode}'`, method: 'geo_state', field: geoField.name, degraded: false };
  }

  const adminField = pickField(cfg.adminStateFields || [], fields);
  if (usable(adminField)) {
    return {
      where: `UPPER(${adminField.name}) = '${stateCode}'`,
      method: 'admin_state',
      field: adminField.name,
      degraded: true,
      note: `Scoped by administering BLM office (${adminField.name}), not by claim location — the geographic state field is unavailable. Claims just inside or outside the state line may be missing or extra.`,
    };
  }

  // Degraded fallback when the state fields drift away entirely: scope by the
  // state prefix on the case serial. Applied per field format — MLRS prefix on
  // the MLRS serial, office prefix on the legacy serial (see US_SERIAL_PREFIXES).
  const prefixes = US_SERIAL_PREFIXES[stateCode];
  // A shared-office prefix cannot tell Oregon from Washington on its own.
  if (prefixes && !prefixes.sharedOffice) {
    const clauses = [];
    const serialField = pickField(cfg.numberFields, fields);
    if (usable(serialField) && isStringType(serialField) && prefixes.mlrs) {
      clauses.push(`UPPER(${serialField.name}) LIKE '${prefixes.mlrs}%'`);
    }
    const legacyField = pickField(cfg.legacyNumberFields || [], fields);
    if (usable(legacyField) && isStringType(legacyField) && prefixes.legacyOffice) {
      clauses.push(`UPPER(${legacyField.name}) LIKE '${prefixes.legacyOffice}%'`);
    }
    if (clauses.length) {
      return {
        where: clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0],
        method: 'serial_prefix',
        field: clauses.length > 1 ? `${serialField.name}+${legacyField.name}` : (serialField?.name || legacyField.name),
        degraded: true,
        note: 'Scoped by case-serial prefix because the BLM state fields are unavailable. Serial prefixes follow the administering BLM office, not the claim location, so claims near a state line may be missing or extra.',
      };
    }
  }
  // No field list at all means the layer metadata could not be read — an
  // outage, not a schema change, and the user should be told which.
  if (!fields?.length) throw new Error('The BLM registry is temporarily unavailable. Try again shortly.');
  throw new Error('The BLM registry schema changed and state filtering is unavailable. Try again later.');
}

/**
 * Where one row is, as far as the layer can say, and how we know.
 * Returns { in: boolean|null, via } — `in: null` means nothing on the row
 * locates it (the caller then decides between a serial prefix and leaving it out).
 */
export function usRowState(props, scoping) {
  const p = props || {};
  if (scoping.geoField) {
    const v = p[scoping.geoField];
    if (v != null && String(v).trim()) {
      return { in: String(v).trim().toUpperCase() === scoping.stateCode, via: 'geo_state' };
    }
  }
  if (scoping.legalField) {
    const states = legalDescriptionStates(p[scoping.legalField]);
    if (states.length) return { in: states.includes(scoping.stateCode), via: 'legal_description' };
  }
  if (!scoping.prefixes || scoping.prefixes.sharedOffice) return { in: null, via: null };
  const serial = scoping.serialField ? String(p[scoping.serialField] ?? '').toUpperCase() : '';
  const legacy = scoping.legacyField ? String(p[scoping.legacyField] ?? '').toUpperCase() : '';
  if (serial) return { in: serial.startsWith(scoping.prefixes.mlrs), via: 'serial_prefix' };
  if (legacy) return { in: legacy.startsWith(scoping.prefixes.legacyOffice), via: 'serial_prefix' };
  return { in: null, via: null };
}

function resolveUsRowScoping(cfg, fields) {
  const ident = (f) => (f && /^[A-Za-z0-9_.]+$/.test(f.name) ? f : null);
  const geo = ident(pickField(cfg.geoStateFields || [], fields));
  const legal = ident(pickField(cfg.legalDescriptionFields || [], fields));
  if (!geo && !legal) return null;
  const stateCode = String(cfg.usState).toUpperCase();
  const prefixes = US_SERIAL_PREFIXES[stateCode] || null;
  const serial = ident(pickField(cfg.numberFields || [], fields));
  const legacy = ident(pickField(cfg.legacyNumberFields || [], fields));
  const storedUpper = Boolean(cfg.valuesUpperCase);

  // SQL narrowing by administering office. Every MLRS case has an MLRS serial,
  // so the serial column alone is enough; the legacy column is the fallback for
  // a layer without one. Not a scope on its own — rows are still placed by
  // usRowState — but it keeps a common claim name from paging back the nation.
  let where = null;
  if (prefixes && serial && isStringType(serial)) {
    where = likeClause(serial.name, prefixes.mlrs, { prefix: true, storedUpper });
  } else if (prefixes && legacy && isStringType(legacy)) {
    where = likeClause(legacy.name, prefixes.legacyOffice, { prefix: true, storedUpper });
  }

  // The projection is the fixed allowlist PLUS whatever each candidate list
  // actually resolved to, so a layer that publishes an alias (STATE_GEO,
  // LGCY_CSE_NR, CLAIM_NAME …) still returns the column that scoping and
  // normalizeProps read. Deduplicated, case-insensitively, against the layer.
  const byUpper = new Map(fields.map((f) => [f.name.toUpperCase(), f.name]));
  const resolvedNames = [
    ...(cfg.outFields || []),
    fields.find((f) => f.type === 'esriFieldTypeOID')?.name,
    geo?.name, legal?.name, serial?.name, legacy?.name,
    ...[cfg.nameFields, cfg.ownerFields, cfg.adminStateFields, cfg.recordDateFields,
      US_TYPE_FIELDS, US_DISP_FIELDS, US_ACRES_FIELDS]
      .map((list) => pickField(list || [], fields)?.name),
  ];
  const outFields = [...new Set(resolvedNames
    .filter(Boolean)
    .map((n) => byUpper.get(String(n).toUpperCase()))
    .filter((n) => n && /^[A-Za-z0-9_.]+$/.test(n)))];

  return {
    perRow: true,
    where,
    stateCode,
    prefixes,
    geoField: geo?.name || null,
    legalField: legal?.name || null,
    serialField: serial?.name || null,
    legacyField: legacy?.name || null,
    outFields: outFields.length ? outFields.join(',') : '*',
    // Declared before any row is seen; withScopingMeta refines it from the rows.
    method: legal ? 'legal_description' : 'geo_state',
    field: [geo?.name, legal?.name].filter(Boolean).join('+'),
    degraded: false,
  };
}

/**
 * How full the US state fields actually are, for ?schema=1 and the canary.
 *
 * Count queries cost BLM 2-20 s each (a NULL test is a full scan), so this
 * never runs on a search: it runs on the gated diagnostics only, in parallel,
 * and is cached per process for six hours. Searches do not need it — they
 * place each row individually (usRowState) and so cannot be fooled by a field
 * that exists but is empty.
 */
async function usFieldFillRates(cfg, layerUrl, fields) {
  const key = `fill:${layerUrl}:${cfg.usState}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };
  const scoping = resolveUsRowScoping(cfg, fields) || {};
  const has = (n) => n && fields.some((f) => f.name.toUpperCase() === n.toUpperCase());
  const geo = pickField(cfg.geoStateFields || [], fields)?.name;
  const admin = pickField(cfg.adminStateFields || [], fields)?.name;
  const legal = pickField(cfg.legalDescriptionFields || [], fields)?.name;
  const st = String(cfg.usState).toUpperCase();
  const queries = {
    total: '1=1',
    ...(has(geo) ? { geoStateFilled: `${geo} IS NOT NULL`, geoStateIsThisState: `${geo} = '${st}'` } : {}),
    ...(has(admin) ? { adminStateFilled: `${admin} IS NOT NULL` } : {}),
    ...(has(legal) ? { legalDescriptionFilled: `${legal} IS NOT NULL AND ${legal} <> ''`, legalDescriptionInThisState: `${legal} LIKE '${st} %'` } : {}),
    ...(scoping.where ? { serialPrefixMatches: scoping.where } : {}),
  };
  const started = Date.now();
  const entries = await Promise.all(Object.entries(queries).map(async ([name, where]) => {
    try {
      const r = await fetchJson(`${layerUrl}/query?${new URLSearchParams({ where, returnCountOnly: 'true', f: 'json' })}`, { timeoutMs: 40000 });
      return [name, Number.isFinite(Number(r?.count)) ? Number(r.count) : { error: JSON.stringify(r?.error || r).slice(0, 200) }];
    } catch (e) {
      return [name, { error: String(e?.message || e).slice(0, 200) }];
    }
  }));
  const counts = Object.fromEntries(entries);
  const rate = (n) => (typeof counts[n] === 'number' && typeof counts.total === 'number' && counts.total > 0
    ? Math.round((counts[n] / counts.total) * 1000) / 10 : null);
  const out = {
    counts,
    percentOfLayer: {
      geoStateFilled: rate('geoStateFilled'),
      adminStateFilled: rate('adminStateFilled'),
      legalDescriptionFilled: rate('legalDescriptionFilled'),
    },
    ms: Date.now() - started,
  };
  const complete = entries.every(([, v]) => typeof v === 'number');
  cacheSet(key, out, complete ? 6 * 60 * 60 * 1000 : META_DEGRADED_TTL_MS);
  return out;
}

function mergeUsScope(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Object.fromEntries(Object.keys({ ...a, ...b }).map((k) => [k, (a[k] || 0) + (b[k] || 0)]));
}

/** Keep the rows that are in the state; count how each was placed. */
function applyUsRowScope(features, scoping) {
  const counts = { geo_state: 0, legal_description: 0, serial_prefix: 0, unplaced: 0, otherState: 0 };
  const kept = [];
  for (const f of features) {
    const r = usRowState(f.properties, scoping);
    if (r.in === null) { counts.unplaced += 1; continue; }
    if (!r.in) { counts.otherState += 1; continue; }
    counts[r.via] += 1;
    kept.push(f);
  }
  return { kept, counts };
}

/**
 * One query against a claims layer, with the jurisdiction's scoping applied.
 *
 * Canadian layers: exactly arcgisQueryAll. US layers: the scoping's SQL
 * narrowing is ANDed in (unless `narrow` is false — a bbox is already
 * geographic), only the fields the app uses are requested, and rows are then
 * placed in or out of the state one by one (applyUsRowScope). The per-row
 * counts travel on meta.usScope for withScopingMeta to turn into a declaration.
 */
async function queryLayer(cfg, layerUrl, params, { maxTotal, scoping = null, narrow = true } = {}) {
  let { where } = params;
  if (scoping?.where && narrow) where = where ? `(${where}) AND ${scoping.where}` : scoping.where;
  const p = { ...params, ...(where ? { where } : {}) };
  if (scoping?.perRow) {
    if (!p.outFields || p.outFields === '*') p.outFields = scoping.outFields;
    p.geometryPrecision = p.geometryPrecision || '6';   // ~0.1 m; claims are 20-acre rectangles
  }
  const result = await arcgisQueryAll(layerUrl, p, maxTotal, cfg.paging || null);
  if (!scoping?.perRow) return result;
  const { kept, counts } = applyUsRowScope(result.features, scoping);
  const dropped = result.features.length - kept.length;
  return {
    ...result,
    features: kept,
    meta: {
      ...result.meta,
      returned: kept.length,
      // The upstream total counted rows we have now placed outside the state.
      totalKnown: result.meta?.truncated ? result.meta.totalKnown : (result.meta?.totalKnown != null ? result.meta.totalKnown - dropped : kept.length),
      usScope: counts,
    },
  };
}

// Attach the scoping declaration to a response's meta. Canadian provinces pass
// scoping=null and their meta is left exactly as it was.
//
// Per-row scoping is declared from what the rows actually needed: geo_state
// when every kept claim had GEO_STATE, legal_description when some needed the
// PLSS description (both geographic), and serial_prefix — degraded, with the
// count — when any claim could only be placed by its administering office. A
// shared-office state (OR/WA) never falls back to a prefix; a claim there with
// no location on record is left out and the set is declared degraded for it.
function withScopingMeta(meta, scoping) {
  if (!scoping) return meta;
  const { usScope, ...rest } = meta || {};
  if (scoping.perRow && usScope) {
    const kept = usScope.geo_state + usScope.legal_description + usScope.serial_prefix;
    let method = scoping.method;
    let degraded = false;
    let note = null;
    if (usScope.serial_prefix > 0) {
      method = 'serial_prefix';
      degraded = true;
      note = `${usScope.serial_prefix} of ${kept} claims have no geographic state or legal description on record at BLM and were placed by case-serial prefix, which follows the administering BLM office rather than the claim location.`;
    } else if (usScope.unplaced > 0 && scoping.prefixes?.sharedOffice) {
      degraded = true;
      note = `${usScope.unplaced} claims administered by the Oregon/Washington BLM office have no location on record and were left out, because the serial cannot tell Oregon ground from Washington ground.`;
    } else if (kept > 0 && usScope.legal_description === 0 && scoping.geoField) {
      method = 'geo_state';
    }
    return {
      ...rest,
      scopingMethod: method,
      scopingField: scoping.field,
      scopingDegraded: degraded,
      ...(note ? { scopingNote: note } : {}),
    };
  }
  return {
    ...rest,
    scopingMethod: scoping.method,
    scopingField: scoping.field,
    scopingDegraded: Boolean(scoping.degraded),
    ...(scoping.note ? { scopingNote: scoping.note } : {}),
  };
}

// ── US claimant store (ownership, joined to BLM geometry by serial) ─────────
// BLM's spatial layer publishes geometry but no claimant names, so ownership
// lives in the us_claim_claimants table (supabase-us-claimants-setup.sql,
// loaded by scripts/update-us-claimants.mjs from an MLRS report 120 export or
// an equivalent extract). This resolves company → claimant rows → MLRS serials;
// the caller then fetches geometry for those serials from BLM.
//
// Returns null when the store isn't configured or holds nothing for this state,
// which is the shipped default: the whole path is inert until an operator loads
// a snapshot, and until then US company search degrades to claim names exactly
// as before.
async function resolveClaimantSerials(cfg, company, tiers) {
  const creds = qcSupabaseCreds();   // same project/env vars as the QC store
  if (!creds) return null;
  const { base, key } = creds;
  const stateCode = String(cfg.usState || '').toUpperCase();

  const select = 'serial,claimant_name,claimant_role,state,source,snapshot_date';
  const get = async (qs) => {
    const r = await fetch(`${base}/rest/v1/us_claim_claimants?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    // 404 = table not created yet (setup SQL not run). Treated as "not
    // configured", never as an error: the claim-name path still works.
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`US claimant store ${r.status}`);
    return r.json();
  };

  // PostgREST treats * as the ilike wildcard; strip user-supplied wildcards so
  // a term can only ever match literally.
  const clean = (t) => String(t).replace(/[*%,()]/g, ' ').trim();

  for (const tier of tiers) {
    const terms = tier.terms.map(clean).filter((t) => t.length >= 2);
    if (!terms.length) continue;
    // or=(claimant_name.ilike.*a*,claimant_name.ilike.*b*)
    const or = terms.map((t) => `claimant_name.ilike.*${encodeURIComponent(t)}*`).join(',');
    const qs = `select=${select}&or=(${or})&state=eq.${encodeURIComponent(stateCode)}&limit=5000`;
    let rows;
    try {
      rows = await get(qs);
    } catch {
      return null;   // store unreachable — fall through to the claim-name path
    }
    if (rows === null) return null;   // table absent
    const kept = tier.scored
      ? rows.filter((row) => matchesCompany(company, row.claimant_name, `us-${stateCode.toLowerCase()}`))
      : rows;
    if (!kept.length) continue;
    const serials = [...new Set(kept.map((r) => String(r.serial || '').trim().toUpperCase()).filter(Boolean))];
    if (!serials.length) continue;
    // Newest snapshot among the matched rows — what the export credit shows.
    const snapshotDate = kept.map((r) => r.snapshot_date).filter(Boolean).sort().pop() || null;
    return {
      serials,
      method: tier.method,
      snapshotDate,
      sources: [...new Set(kept.map((r) => r.source).filter(Boolean))],
      claimants: [...new Set(kept.map((r) => r.claimant_name).filter(Boolean))].slice(0, 25),
      roles: [...new Set(kept.map((r) => r.claimant_role).filter(Boolean))],
      matchedRows: kept.length,
    };
  }
  return { serials: [], method: null, snapshotDate: null, sources: [], claimants: [], roles: [], matchedRows: 0 };
}

// ── US company search ───────────────────────────────────────────────────────
// Two paths, and which one ran is always reported:
//
//   claimant    the claimant store answered — an OWNERSHIP record. This is the
//               only result the UI may title as a company's claims.
//   claim_name  no claimant store (the shipped default), so the alias ladder
//               runs against the claim-NAME field. US operators overwhelmingly
//               name claims after themselves, which makes this useful, but a
//               name is chosen by whoever located the claim and establishes
//               NOTHING about ownership.
//
// Both use the same ladder from _lib/us-aliases.js: exact → alias table +
// generated subsidiary variants → suffix-stripped fuzzy (score-filtered with
// the pipeline's own NAME_MATCH.auto threshold). First tier with rows wins.
//
// A company that produces no rows in ANY tier comes back as
// resolution.status='unresolved' — a different outcome from a company that
// resolved and holds no ground here, and the UI must not merge the two.
async function searchUsCompany(cfg, company, res, { layerUrl, fields, scoping }) {
  const province = `us-${String(cfg.usState).toLowerCase()}`;
  const ladder = resolveUsCompanyTiers(company, province);

  // Ownership first, when a snapshot is loaded.
  const claimantHit = await resolveClaimantSerials(cfg, company, ladder).catch(() => null);
  if (claimantHit && claimantHit.serials.length) {
    const serialField = pickField(cfg.numberFields, fields);
    if (serialField && /^[A-Za-z0-9_.]+$/.test(serialField.name)) {
      // Chunk the IN list so a large holding can't build an unbounded WHERE.
      const CHUNK = 500;
      const all = [];
      let metaAcc = null;
      for (let i = 0; i < claimantHit.serials.length && i < 5000; i += CHUNK) {
        const chunk = claimantHit.serials.slice(i, i + CHUNK)
          .map((s) => `'${escapeSql(s)}'`).join(',');
        // An extract may carry legacy LR2000 serials (NMC…) rather than MLRS
        // ones; both columns are indexed, so match either.
        const legacyField = pickField(cfg.legacyNumberFields || [], fields);
        const cols = [serialField, legacyField && /^[A-Za-z0-9_.]+$/.test(legacyField.name) && isStringType(legacyField) ? legacyField : null]
          .filter(Boolean)
          .map((f) => (cfg.valuesUpperCase ? `${f.name} IN (${chunk})` : `UPPER(${f.name}) IN (${chunk})`));
        const where = cols.length > 1 ? `(${cols.join(' OR ')})` : cols[0];
        const { features, meta } = await queryLayer(cfg, layerUrl, {
          where, outFields: '*', returnGeometry: 'true', outSR: '4326',
        }, { scoping });
        for (const f of features) all.push(f);
        metaAcc = metaAcc
          ? {
            ...meta,
            returned: all.length,
            truncated: metaAcc.truncated || meta.truncated,
            pagesFetched: (metaAcc.pagesFetched || 0) + (meta.pagesFetched || 0),
            ...(meta.usScope ? { usScope: mergeUsScope(metaAcc.usScope, meta.usScope) } : {}),
          }
          : { ...meta, returned: all.length };
      }
      return res.status(200).json({
        type: 'FeatureCollection',
        features: all.map((f) => ({ ...f, properties: normalizeProps(f.properties || {}, cfg) })),
        meta: withScopingMeta({ ...(metaAcc || {}), provider: cfg.provider, returned: all.length }, scoping),
        resolution: {
          status: 'resolved',
          company,
          method: claimantHit.method,
          // The one value that permits titling a layer as a company's claims.
          resolvedAgainst: 'claimant',
          claimants: claimantHit.claimants,
          claimantRoles: claimantHit.roles,
          serialsMatched: claimantHit.serials.length,
          // A snapshot, not live data — carried into the export credit so a
          // stale extract can never read as current ownership.
          snapshotDate: claimantHit.snapshotDate,
          claimantSources: claimantHit.sources,
        },
      });
    }
  }

  const claimantField = pickField(cfg.ownerFields || [], fields);
  const nameField = pickField(cfg.nameFields || [], fields);
  const field = claimantField || nameField;
  if (!field || !/^[A-Za-z0-9_.]+$/.test(field.name) || !isStringType(field)) {
    return res.status(200).json({
      type: 'FeatureCollection',
      features: [],
      meta: withScopingMeta({ provider: cfg.provider, returned: 0, totalKnown: 0, truncated: false, pagesFetched: 0 }, scoping),
      resolution: {
        status: 'unresolved',
        reason: 'no_claimant_field',
        company,
        resolvedAgainst: null,
        method: null,
      },
    });
  }

  const tiers = ladder;
  const attempted = [];

  for (const tier of tiers) {
    const clauses = tier.terms.map((t) => likeClause(field.name, t, { storedUpper: Boolean(cfg.valuesUpperCase) }));
    if (!clauses.length) continue;
    const where = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
    attempted.push({ method: tier.method, terms: tier.terms.length });

    const { features, meta } = await queryLayer(cfg, layerUrl, {
      where,
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
    }, { scoping });

    // The fuzzy tier queries broadly on a two-token stem, so its rows are
    // scored against the parent + every alias variant and anything below the
    // pipeline's auto threshold is dropped rather than shown to the user.
    const kept = tier.scored
      ? features.filter((f) => {
          const p = f.properties || {};
          const candidate = (claimantField ? p[claimantField.name] : null) ?? p[field.name];
          return matchesCompany(company, candidate, province);
        })
      : features;

    if (!kept.length) continue;
    if (cfg.provider) meta.provider = cfg.provider;
    return res.status(200).json({
      type: 'FeatureCollection',
      features: kept.map((f) => ({ ...f, properties: normalizeProps(f.properties || {}, cfg) })),
      meta: withScopingMeta({ ...meta, returned: kept.length }, scoping),
      resolution: {
        status: 'resolved',
        company,
        method: tier.method,
        resolvedAgainst: claimantField ? 'claimant' : 'claim_name',
        field: field.name,
        tiersAttempted: attempted,
      },
    });
  }

  return res.status(200).json({
    type: 'FeatureCollection',
    features: [],
    meta: withScopingMeta({ provider: cfg.provider, returned: 0, totalKnown: 0, truncated: false, pagesFetched: attempted.length }, scoping),
    resolution: {
      status: 'unresolved',
      reason: claimantField ? 'no_claimant_match' : 'no_claim_name_match',
      company,
      resolvedAgainst: claimantField ? 'claimant' : 'claim_name',
      field: field.name,
      method: null,
      tiersAttempted: attempted,
    },
  });
}

// ── US claims mirror (public.us_claims, loaded weekly) ──────────────────────
// scripts/update-us-claims.mjs copies BLM's Active Mining Claims into Supabase
// every week (supabase/migrations/20261031100000_us_claims_mirror.sql). When
// that copy is populated and fresh, US searches are answered from it — indexed
// Postgres, independent of BLM's uptime and of its 13-20 s name scans — and
// every response says so (meta.source = 'mirror', with the copy's date). When
// it is empty, stale, unconfigured or failing, the live BLM path below answers
// instead (meta.source = 'live'). The mirror never makes a search fail.
//
// Rows carry the states each claim is in and how that was known, computed at
// load time by the same shared/usClaimStates.js the live path uses, so both
// paths place a claim identically and declare scoping the same way.

const US_MIRROR_MAX_AGE_DAYS = Number(process.env.US_CLAIMS_MAX_AGE_DAYS) > 0 ? Number(process.env.US_CLAIMS_MAX_AGE_DAYS) : 10;
const US_MIRROR_SELECT = 'id,serial,legacy_serial,claim_name,states,state_source,claim_type,disposition,case_type_nr,acres,location_date,geometry';

/**
 * The mirror's freshness, or null when it should not be used. Cached per
 * process: ten minutes when it answered, one when it did not.
 */
async function usMirrorStatus() {
  if (process.env.US_CLAIMS_MIRROR === 'off') return null;
  const cached = cacheGet('us-mirror-status');
  if (cached !== undefined) return cached?.usable ? cached : null;
  const creds = qcSupabaseCreds();
  if (!creds) return null;
  let status;
  try {
    const r = await fetch(`${creds.base}/rest/v1/us_claims?select=source_updated_at&limit=1`, {
      headers: { apikey: creds.key, Authorization: `Bearer ${creds.key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    // 404 = migration not applied yet: simply "no mirror".
    const rows = r.ok ? await r.json() : [];
    const date = rows?.[0]?.source_updated_at || null;
    const ageDays = date ? Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86400000) : null;
    status = {
      usable: Boolean(date) && ageDays != null && ageDays <= US_MIRROR_MAX_AGE_DAYS,
      retrievedAt: date,
      ageDays,
      reason: !r.ok ? `store ${r.status}` : !date ? 'empty' : ageDays > US_MIRROR_MAX_AGE_DAYS ? `stale (${ageDays} days)` : null,
    };
  } catch (e) {
    status = { usable: false, reason: String(e?.message || e).slice(0, 120) };
  }
  cacheSet('us-mirror-status', status, status.usable ? META_TTL_MS : META_DEGRADED_TTL_MS);
  return status.usable ? status : null;
}

function usMirrorMeta(status) {
  return { source: 'mirror', mirrorRetrievedAt: status.retrievedAt, mirrorAgeDays: status.ageDays };
}

/** A mirror row as the raw BLM attributes normalizeProps already knows. */
function usMirrorRowToFeature(row, cfg) {
  return {
    type: 'Feature',
    geometry: row.geometry,
    properties: normalizeProps({
      OBJECTID: row.id,
      CSE_NR: row.serial,
      LEG_CSE_NR: row.legacy_serial,
      CSE_NAME: row.claim_name,
      BLM_PROD: row.claim_type,
      CSE_DISP: row.disposition,
      CSE_TYPE_NR: row.case_type_nr,
      RCRD_ACRS: row.acres == null ? null : Number(row.acres),
      LOC_DT: row.location_date,
      US_STATE_SOURCE: row.state_source,
    }, cfg),
  };
}

// Scoping as withScopingMeta expects it, counted from how each row was placed.
function usMirrorScoping(cfg) {
  return {
    perRow: true,
    method: 'legal_description',
    field: 'us_claims.states',
    prefixes: US_SERIAL_PREFIXES[String(cfg.usState).toUpperCase()] || null,
    geoField: null,
  };
}

function usMirrorScopeCounts(rows) {
  const counts = { geo_state: 0, legal_description: 0, serial_prefix: 0, unplaced: 0, otherState: 0 };
  for (const r of rows) if (counts[r.state_source] != null) counts[r.state_source] += 1;
  return counts;
}

// PostgREST filter values: identifiers are capitals and digits only; free text
// loses every character PostgREST's or=() grammar or ilike gives meaning to.
const mirrorIdent = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');
const mirrorText = (v) => String(v ?? '').replace(/[*%,()"\\]/g, ' ').replace(/\s+/g, ' ').trim();

/** Every page of a us_claims filter (state-scoped), as rows. */
async function usMirrorRows(cfg, filter, { maxTotal } = {}) {
  const { base, key } = qcSupabaseCreds();
  const st = encodeURIComponent(`{${String(cfg.usState).toUpperCase()}}`);
  const rows = [];
  const { meta } = await fetchAllPages({
    provider: 'us-mirror',
    pageSize: Math.min(1000, maxTotal || 1000),
    ...(maxTotal ? { maxTotal } : {}),
    idField: 'OBJECTID',
    fetchPage: async (offset, count) => {
      const url = `${base}/rest/v1/us_claims?select=${US_MIRROR_SELECT}&states=cs.${st}&${filter}&order=id&limit=${count}&offset=${offset}`;
      const r = await fetch(url, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`US claims mirror ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
      const page = await r.json();
      rows.push(...page);
      return { features: page.map((row) => ({ properties: { OBJECTID: row.id } })) };
    },
  });
  return { rows, meta };
}

function usMirrorResponse(res, cfg, rows, meta, extraMeta = {}, extra = {}) {
  const scoping = usMirrorScoping(cfg);
  return res.status(200).json({
    type: 'FeatureCollection',
    features: rows.map((row) => usMirrorRowToFeature(row, cfg)),
    meta: {
      ...withScopingMeta({ ...meta, provider: cfg.provider, returned: rows.length, usScope: usMirrorScopeCounts(rows) }, scoping),
      ...extraMeta,
    },
    ...extra,
  });
}

async function searchUsMirror(cfg, term, type, res, { numberList = null } = {}) {
  const st = String(cfg.usState).toUpperCase();
  const pre = US_SERIAL_PREFIXES[st] || {};
  const inList = (vals) => `(${vals.map((v) => `"${v}"`).join(',')})`;
  const serialIn = (vals) => `or=${encodeURIComponent(`(serial.in.${inList(vals)},legacy_serial.in.${inList(vals)})`)}`;

  if (type === 'number' && numberList) {
    const tokens = [...new Set(numberList.numbers.map(mirrorIdent).filter((t) => /^[A-Z0-9]+$/.test(t)))];
    const { rows, meta } = tokens.length ? await usMirrorRows(cfg, serialIn(tokens)) : { rows: [], meta: {} };
    const features = rows.map((row) => ({ properties: { TAG_NUMBER: row.serial, LEGACY_NR: row.legacy_serial } }));
    return usMirrorResponse(res, cfg, rows, meta, {
      numberList: numberListMeta({ ...numberList, numbers: numberList.numbers.map(mirrorIdent) }, features,
        (f) => [f.properties.TAG_NUMBER, f.properties.LEGACY_NR]),
    });
  }

  if (type === 'number') {
    const t = mirrorIdent(term);
    if (!/^[A-Z0-9]+$/.test(t)) return res.status(400).json({ error: 'Enter a BLM serial number (letters and digits), e.g. NV105222372.' });
    // As typed first, then (bare digits) the state's own prefixed forms.
    const forms = [t, ...(/^\d{5,}$/.test(t) ? [pre.mlrs, pre.legacyOffice].filter(Boolean).map((p) => `${p}${t}`) : [])];
    for (const form of forms) {
      const { rows, meta } = await usMirrorRows(cfg, serialIn([form]));
      if (rows.length) {
        return usMirrorResponse(res, cfg, rows, meta,
          form === t ? {} : relaxationMeta({ kind: 'number', match: 'exact', from: term, to: form }) || {});
      }
    }
    // Not in the copy. It may be a claim BLM has not mapped yet (the mirror
    // only stores claims with geometry — ~2.4% are not), or one recorded since
    // the last load. Live BLM answers a serial in about half a second and runs
    // the full near-miss ladder, so the caller asks it instead.
    return null;
  }

  if (type === 'name') {
    const steps = claimNameFallbacks(term).map((set) => (set.length ? set.join(' ') : term));
    for (let i = 0; i < steps.length; i += 1) {
      const needle = mirrorText(steps[i]);
      if (needle.length < 2) continue;
      const { rows, meta } = await usMirrorRows(cfg, `claim_name=ilike.${encodeURIComponent(`*${needle}*`)}`);
      if (rows.length || i === steps.length - 1) {
        return usMirrorResponse(res, cfg, rows, meta,
          i > 0 ? relaxationMeta({ kind: 'name', match: 'tokens', from: term, to: steps[i] }) || {} : {});
      }
    }
    return usMirrorResponse(res, cfg, [], { totalKnown: 0, truncated: false, pagesFetched: 0 });
  }

  // Company: ownership from the claimant store when it holds a match, else the
  // subsidiary alias ladder against claim names — exactly as searchUsCompany.
  const province = `us-${st.toLowerCase()}`;
  const ladder = resolveUsCompanyTiers(term, province);
  const claimantHit = await resolveClaimantSerials(cfg, term, ladder).catch(() => null);
  if (claimantHit?.serials.length) {
    const serials = claimantHit.serials.map(mirrorIdent).filter((s) => /^[A-Z0-9]+$/.test(s)).slice(0, 5000);
    const rows = [];
    let truncated = false;
    for (let i = 0; i < serials.length; i += 150) {
      const r = await usMirrorRows(cfg, serialIn(serials.slice(i, i + 150)));
      rows.push(...r.rows);
      truncated = truncated || r.meta?.truncated;
    }
    return usMirrorResponse(res, cfg, rows, { totalKnown: rows.length, truncated, pagesFetched: Math.ceil(serials.length / 150) }, {}, {
      resolution: {
        status: 'resolved',
        company: term,
        method: claimantHit.method,
        resolvedAgainst: 'claimant',
        claimants: claimantHit.claimants,
        claimantRoles: claimantHit.roles,
        serialsMatched: claimantHit.serials.length,
        snapshotDate: claimantHit.snapshotDate,
        claimantSources: claimantHit.sources,
      },
    });
  }
  const attempted = [];
  for (const tier of ladder) {
    const terms = tier.terms.map(mirrorText).filter((t) => t.length >= 2);
    if (!terms.length) continue;
    attempted.push({ method: tier.method, terms: terms.length });
    const or = `or=${encodeURIComponent(`(${terms.map((t) => `claim_name.ilike."*${t}*"`).join(',')})`)}`;
    const { rows, meta } = await usMirrorRows(cfg, or);
    const kept = tier.scored ? rows.filter((r) => matchesCompany(term, r.claim_name, province)) : rows;
    if (!kept.length) continue;
    return usMirrorResponse(res, cfg, kept, { ...meta, returned: kept.length }, {}, {
      resolution: { status: 'resolved', company: term, method: tier.method, resolvedAgainst: 'claim_name', field: 'CSE_NAME', tiersAttempted: attempted },
    });
  }
  return usMirrorResponse(res, cfg, [], { totalKnown: 0, truncated: false, pagesFetched: attempted.length }, {}, {
    resolution: {
      status: 'unresolved', reason: 'no_claim_name_match', company: term, resolvedAgainst: 'claim_name', field: 'CSE_NAME', method: null, tiersAttempted: attempted,
    },
  });
}

async function searchUsMirrorBbox(cfg, minLng, minLat, maxLng, maxLat, res) {
  const { base, key } = qcSupabaseCreds();
  const r = await fetch(`${base}/rest/v1/rpc/us_claims_in_bbox`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat, p_state: String(cfg.usState).toUpperCase(), p_limit: MAX_TOTAL_FEATURES }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`US claims mirror bbox ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const rows = await r.json();
  const truncated = rows.length >= MAX_TOTAL_FEATURES;
  return usMirrorResponse(res, cfg, rows, { totalKnown: truncated ? null : rows.length, truncated, pagesFetched: 1 });
}

async function searchArcgis(cfg, term, type, res, { numberList = null } = {}) {
  const { layerUrl, fields } = await resolveLayerAndFields(cfg, type);

  // US state scoping is resolved before anything queries the layer, so every
  // US path below carries its scoping declaration into the response.
  let scoping;
  try {
    scoping = resolveUsScoping(cfg, fields);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  // US company search goes through the alias ladder rather than a single LIKE.
  if (cfg.provider === 'blm-mlrs' && type === 'company') {
    return searchUsCompany(cfg, term, res, { layerUrl, fields, scoping });
  }

  // A number search runs against every identifier the layer publishes, so the
  // legacy/tag column is reachable too — see pickFields. Owner and name stay
  // single-field: those are one value with several possible column names.
  const candidates = type === 'number' ? [...cfg.numberFields, ...(cfg.legacyNumberFields || [])]
    : type === 'name' ? (cfg.nameFields || [])
    : cfg.ownerFields;
  const field = pickField(candidates, fields);
  if (!field) {
    if (!fields.length) {
      // resolveLayerAndFields couldn't read any field metadata at all — the
      // upstream server is unreachable/blocking us, not actually missing the field.
      return res.status(502).json({
        error: 'The registry is temporarily unavailable. Please try again shortly.',
      });
    }
    return res.status(400).json({
      error: type === 'number'
        ? 'Claim number search is not available here yet.'
        : type === 'name'
          ? 'Claim-name search is not available here yet — try searching by serial number.'
          : 'Company/holder search is not available here — try searching by claim number.',
    });
  }

  // Defense in depth: field names come from upstream service metadata —
  // never interpolate one that isn't a plain identifier (SK uses dots, e.g. SHAPE.AREA)
  if (!/^[A-Za-z0-9_.]+$/.test(field.name)) {
    return res.status(502).json({ error: 'Registry service returned an unexpected field name.' });
  }

  // US serial numbers tolerate formatting differences: "NV 105331298" and
  // "nv-105331298" both match NV105331298.
  const effectiveTerm = (cfg.provider === 'blm-mlrs' && type === 'number')
    ? term.replace(/[\s-]/g, '')
    : term;

  // Every rung of the search ladder is phrased here. Rung 1 is exactly the
  // query this function has always issued; the later rungs only run when the
  // one before found nothing, so a search that works costs one request.
  const numberFields = type === 'number'
    ? pickFields(candidates, fields).filter((f) => /^[A-Za-z0-9_.]+$/.test(f.name))
    : [];
  const storedUpper = Boolean(cfg.valuesUpperCase);

  function numberClauses(step) {
    // OR across every identifier column on the layer. A string column takes a
    // substring LIKE; a numeric one can only take equality, so it contributes a
    // clause only when the term is all digits.
    //
    // The clause list can therefore come out shorter than the field list — a
    // tag like "CB12345" against a numeric TENURE_NUMBER_ID has no valid
    // comparison. That used to be a hard 400 telling the user to "enter digits
    // only", even when a perfectly good string column sat right beside it.
    const clauses = [];
    for (const f of numberFields) {
      if (isStringType(f) && storedUpper) {
        // BLM: an exact rung is a real equality and a prefix a bare LIKE, both
        // answered from the serial index in about a second. (Elsewhere the first
        // rung has always been a contains match, kept as it was.)
        clauses.push(step.match === 'exact'
          ? equalsClause(f.name, step.term, { storedUpper })
          : likeClause(f.name, step.term, { prefix: step.match === 'prefix', storedUpper }));
      } else if (isStringType(f)) {
        clauses.push(likeClause(f.name, step.term, { prefix: step.match === 'prefix' }));
      } else if (/^\d+$/.test(step.term) && !step.derived) {
        clauses.push(`${f.name} = ${step.term}`);
      }
      // A numeric identifier cannot take a LIKE, so "starts with" becomes a set
      // of ranges. Without this the widened rung would reach only the string
      // columns — and on the layers where the numeric column is the one every
      // title carries, that is the same dead end in a wider disguise.
      // Digits only, and not a form we derived by dropping letters: stripping
      // "CB" off a tag here would build the same numeric guess the derived rule
      // above exists to prevent, just by a different route.
      if (!isStringType(f) && step.match === 'prefix' && !step.derived && /^\d+$/.test(step.term)) {
        for (const [lo, hi] of numericPrefixRanges(step.term)) {
          clauses.push(`(${f.name} >= ${lo} AND ${f.name} <= ${hi})`);
        }
      }
    }
    return clauses;
  }

  const orJoin = (clauses) => (clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0]);

  if (type === 'number' && numberList) {
    // The whole list in one query: an exact IN on every identifier column,
    // string columns compared in capitals, numeric ones only against all-digit
    // tokens. No legacy lookup and no near misses (see numberListMeta).
    const tokens = numberList.numbers.map((n) => (cfg.provider === 'blm-mlrs' ? n.replace(/[\s-]/g, '') : n));
    const clauses = [];
    for (const f of numberFields) {
      if (isStringType(f)) {
        const list = tokens.map((t) => `'${escapeSql(t.toUpperCase())}'`).join(',');
        clauses.push(storedUpper ? `${f.name} IN (${list})` : `UPPER(${f.name}) IN (${list})`);
      } else {
        const digits = tokens.filter((t) => /^\d+$/.test(t));
        if (digits.length) clauses.push(`${f.name} IN (${digits.join(',')})`);
      }
    }
    if (!clauses.length) {
      return res.status(400).json({
        error: `${numberFields.map((f) => f.name).join(' and ')} `
          + `${numberFields.length > 1 ? 'are' : 'is'} numeric — enter digits only.`,
      });
    }
    const where = orJoin(clauses);
    const { features, meta } = await queryLayer(cfg, layerUrl, { where, outFields: '*', returnGeometry: 'true', outSR: '4326' }, { scoping });
    if (cfg.provider) meta.provider = cfg.provider;
    const shown = features.map((f) => ({ ...f, properties: normalizeProps(f.properties || {}, cfg) }));
    return res.status(200).json({
      type: 'FeatureCollection',
      features: shown,
      meta: {
        ...withScopingMeta(meta, scoping),
        numberList: numberListMeta({ ...numberList, numbers: tokens }, shown,
          (f) => [f.properties?.TAG_NUMBER, ...numberFields.map((nf) => f.properties?.[nf.name])]),
      },
    });
  }

  let steps;
  let whereFor;

  if (type === 'number') {
    // Keep only the rungs that can add something on THIS layer.
    //
    // Two reasons a rung is dropped. It may be unphraseable — an alphanumeric
    // tag has no comparison against an all-numeric layer. Or it may be
    // subsumed: a string identifier column already takes a CONTAINS match on
    // the first rung, so a later contains rung against the same column repeats
    // a query that just returned nothing. Issuing either is a guaranteed-empty
    // round trip on the exact searches that are already failing.
    const issued = new Set();
    steps = [];
    let ladder = numberSearchLadder(effectiveTerm);
    // A bare BLM serial ("105222372") is the state's serial without its prefix.
    // Try the state's own prefixed forms right after the term as typed — an
    // indexed equality each — before any prefix/contains widening.
    const pre = cfg.usState ? US_SERIAL_PREFIXES[String(cfg.usState).toUpperCase()] : null;
    if (pre && /^\d{5,}$/.test(effectiveTerm)) {
      const prefixed = [pre.mlrs, pre.legacyOffice].filter(Boolean)
        .map((p) => ({ term: `${p}${effectiveTerm}`, derived: false, match: 'exact' }));
      ladder = [ladder[0], ...prefixed, ...ladder.slice(1)];
    }
    for (const step of ladder) {
      const clauses = numberClauses(step);
      if (!clauses.length || clauses.every((c) => issued.has(c))) continue;
      clauses.forEach((c) => issued.add(c));
      steps.push({ ...step, where: orJoin(clauses) });
    }
    if (!steps.length) {
      // Every identifier on this layer is numeric and the term is not.
      return res.status(400).json({
        error: `${numberFields.map((f) => f.name).join(' and ')} `
          + `${numberFields.length > 1 ? 'are' : 'is'} numeric — enter digits only.`,
      });
    }
    whereFor = (step) => step.where;
  } else if (isStringType(field)) {
    // Same tokenised match as B.C.: every meaningful word must appear, in any
    // order. A holder recorded as "EAGLE PLAINS RESOURCES LTD." is found by
    // "Eagle Plains Resources Ltd", "eagle plains" or "Resources Eagle Plains".
    //
    // OWNER SEARCH ONLY. `type === 'name'` resolves cfg.nameFields — CSE_NAME,
    // CLAIM_NAME — which are the names of CLAIMS, not of companies, and that is
    // a literal substring search by design. Tokenising it would be wrong twice
    // over: a search for "Gold Hill Company" would drop COMPANY as a legal
    // suffix even though it is part of the claim's actual name, and would then
    // match any claim carrying GOLD and HILL in any order, including "Hill of
    // Gold". Claims are named, not incorporated; the reasoning behind
    // ownerSearchTokens simply does not apply to them.
    // Mirrors how resolveLayerAndFields picks the variant: anything that is not
    // `number` or `name` resolves the OWNER fields, so anything that is not
    // `number` or `name` gets owner matching. Keeping the two in step means a
    // caller that omits `type` cannot end up searching an owner column with
    // claim-name semantics.
    const isOwnerSearch = type !== 'number' && type !== 'name';
    const tokens = isOwnerSearch ? ownerSearchTokens(effectiveTerm) : [];
    // The relaxation ladder Quebec has had since 20260813: every token, then
    // the distinctive words, then the single most distinctive one. A holder
    // search that requires every word is monotonically narrowing — each extra
    // word the user types is another chance to miss — and that is as true in
    // Ontario as in Quebec. Claim NAMES are never relaxed this way, for the
    // reason stated above.
    const sets = isOwnerSearch && tokens.length
      ? relaxedTokenSetsPreservingSpelling(tokens)
      : (type === 'name' ? claimNameFallbacks(effectiveTerm) : [tokens]);
    steps = sets.map((set) => ({ match: 'tokens', term: set.join(' ') || effectiveTerm, tokens: set }));
    whereFor = (step) => (step.tokens.length > 1
      ? `(${step.tokens.map((t) => likeClause(field.name, t, { storedUpper })).join(' AND ')})`
      : likeClause(field.name, step.tokens[0] ?? effectiveTerm, { storedUpper }));
  } else if (/^\d+$/.test(effectiveTerm)) {
    steps = [{ match: 'exact', term: effectiveTerm }];
    whereFor = () => `${field.name} = ${effectiveTerm}`;
  } else {
    return res.status(400).json({ error: `${field.name} is numeric — enter digits only.` });
  }

  const { features, meta, step } = await runLadder(steps, (attempt) => queryLayer(cfg, layerUrl, {
    where: whereFor(attempt),
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
  }, {
    scoping,
    // A widened NUMBER rung answers "the closest numbers we hold", and that
    // answer is capped. Bounding it at FETCH time rather than slicing after
    // means a three-digit prefix costs one page instead of paging a province
    // back to throw most of it away.
    maxTotal: attempt !== steps[0] && type === 'number' ? NEAR_MISS_LIMIT : undefined,
  }));
  if (cfg.provider) meta.provider = cfg.provider;

  // The exact number is not a current claim: before offering near misses, see
  // whether it is a pre-conversion legacy claim and answer with the current
  // claims on its ground.
  if (type === 'number' && cfg.legacyClaims && step !== steps[0]) {
    const legacy = await legacyClaimResult(cfg, layerUrl, effectiveTerm).catch(() => null);
    if (legacy) {
      return res.status(200).json({
        type: 'FeatureCollection',
        features: legacy.features.map((f) => ({ ...f, properties: normalizeProps(f.properties || {}, cfg) })),
        meta: { ...legacy.meta, provider: cfg.provider || 'arcgis', legacyClaim: { number: effectiveTerm, currentClaims: legacy.features.length } },
      });
    }
  }

  // Widened only if the rung that answered was not the first one. The first
  // rung is what the user asked for; anything past it has to say so.
  const widened = step && step !== steps[0];
  const shown = widened && type === 'number' ? features.slice(0, NEAR_MISS_LIMIT) : features;
  // The near-miss list was cut short either here or at the fetch cap above —
  // `truncated` is how fetchAllPages reports hitting a ceiling with more to
  // come. Either way the user is told the list is the closest N, not all of it.
  const nearMissLimited = widened && type === 'number'
    && (features.length > shown.length || meta.truncated === true);

  return res.status(200).json({
    type: 'FeatureCollection',
    features: shown.map((f) => ({ ...f, properties: normalizeProps(f.properties || {}, cfg) })),
    meta: {
      ...withScopingMeta(meta, scoping),
      ...(widened ? relaxationMeta({
        // 'name' is its own kind, not a quieter 'owner': a claim-name match
        // says nothing about who holds the claim, and the sentence the UI
        // writes for it has to say so.
        kind: type === 'number' ? 'number' : (type === 'name' ? 'name' : 'owner'),
        match: step.match,
        from: term,
        to: step.term,
        limited: nearMissLimited,
      }) : {}),
    },
  });
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function featureCentre(feature) {
  const pts = [];
  const walk = (v) => { if (typeof v?.[0] === 'number') pts.push(v); else if (Array.isArray(v)) v.forEach(walk); };
  walk(feature?.geometry?.coordinates);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * A pre-2018 Ontario claim number → the CURRENT claims on that ground.
 *
 * The legacy outline itself is not returned: it is not current tenure, and a
 * map of it would read as a live claim. Cells are kept when their centre lies
 * inside the legacy outline, so neighbours that merely touch its edge stay out.
 * Returns null when the number is not a legacy claim either.
 */
async function legacyClaimResult(cfg, currentLayerUrl, term) {
  if (!/^[A-Za-z0-9-]{3,20}$/.test(term)) return null;
  const { layerId, numberField } = cfg.legacyClaims;
  const legacyUrl = `${cfg.service}/${layerId}`;
  const found = await arcgisQueryAll(legacyUrl, {
    where: `${numberField} = '${escapeSql(term)}'`,
    outFields: numberField,
    returnGeometry: 'true',
    outSR: '4326',
  }, 5);
  const outline = found.features.find((f) => f.geometry);
  if (!outline) return null;
  const rings = outline.geometry.type === 'MultiPolygon' ? outline.geometry.coordinates.flat() : outline.geometry.coordinates;
  const current = await arcgisQueryAll(currentLayerUrl, {
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
  }, 500);
  const features = current.features.filter((f) => {
    const c = featureCentre(f);
    return c && rings.some((ring) => pointInRing(c, ring));
  });
  return { features, meta: { ...current.meta, returned: features.length } };
}

// Quebec has no live queryable registry, so its claims are loaded weekly into a
// Supabase table (see scripts/update-qc-claims.js + supabase-qc-claims-setup.sql)
// and searched here via PostgREST. Reads use the anon key + a public-read RLS
// policy; rows are already normalized to the BC-style property names.
// Quebec is self-hosted in Supabase. Accept either the bare server-side names
// or the VITE_-prefixed ones the frontend Supabase client already uses — both
// point at the same project, and the anon key is public-safe (it ships in the
// client bundle anyway), so this avoids requiring a duplicate set of Vercel
// env vars. Returns null when not configured.
function qcSupabaseCreds() {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Anon key only. This endpoint is unauthenticated, so it must never hold a
  // key that bypasses RLS — a missing anon key means "not configured", never
  // "use the service role instead".
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  return { base, key };
}

// Map a qc_claims row onto the BC-style property names the UI renders.
function qcRowToFeature(row) {
  return {
    type: 'Feature',
    geometry: row.geometry || null,
    properties: {
      OWNER_NAME: row.owner_name,
      TAG_NUMBER: row.tag_number,
      AREA_IN_HECTARES: row.area_hectares,
      GOOD_TO_DATE: row.good_to_date,
      TITLE_TYPE_DESCRIPTION: row.title_type,
      STATUS: row.status,
    },
  };
}

// Fold a search term the same way qc_claims.owner_name_norm is folded: strip
// accents, lowercase. Both sides must agree or the comparison is meaningless —
// "Aurifère" indexed folded and searched unfolded matches nothing.
//
// NFD splits an accented character into its base plus a combining mark, which
// the range below then removes; anything without a decomposition is untouched.
export function foldForSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Industry vocabulary that describes what a company DOES rather than who it is.
//
// These are the words that make an owner search narrower without making it more
// specific. Requiring every token means each extra word is another chance to
// miss, and in Quebec these are exactly the words most likely to differ: GESTIM
// records "Corporation Aurifère Vior Inc.", so a search for "Vior Gold
// Corporation" fails on GOLD — the registry's word for it is French. Measured
// against the live table: "Vior" returns 4,658 and "Vior Gold Corporation"
// returns 0; "Osisko" returns 1,514 and "Osisko Development Corporation" 0.
//
// Both spellings of each pair are listed because either side can appear: the
// user types one language and the registry stores the other.
const GENERIC_OWNER_WORDS = new Set([
  'mining', 'miniere', 'minieres', 'minier', 'miniers', 'mines', 'mine',
  'resources', 'ressources', 'resource', 'ressource',
  'exploration', 'explorations',
  'gold', 'aurifere', 'auriferes', 'or',
  'silver', 'argent', 'copper', 'cuivre', 'iron', 'fer',
  'metals', 'metaux', 'metal', 'minerals', 'mineral', 'mineraux',
  'development', 'developpement', 'developments',
  'group', 'groupe', 'holdings', 'holding', 'partners', 'partnership',
  'energy', 'energie', 'royalty', 'royalties', 'ventures', 'venture',
  'canada', 'quebec', 'america', 'american', 'north', 'international',
]);

// Words that carry no narrowing power of their own.
//
// A relaxed set is only worth issuing if something in it still constrains the
// table. Strip the industry words from "A Gold Corporation" and what is left is
// "a" — queried as `%a%`, which matches 185,863 of the 258,608 rows in the
// Quebec store, across 987 unrelated holders. That is not a looser answer to
// the question asked; it is 10 pages of arbitrary rows against the
// 10,000-feature ceiling, presented as if it were the company's ground.
//
// Both a length floor and an explicit list are needed: "of" is caught by
// length, "the" is three characters and is not. The French articles are here
// for the same reason the industry vocabulary lists both languages — GESTIM
// records "Les Ressources X" as readily as "X Resources".
const RELAXED_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'of', 'for', 'in', 'on', 'at', 'to', 'by',
  'le', 'la', 'les', 'l', 'un', 'une', 'de', 'des', 'du', 'd', 'et', 'en', 'au', 'aux',
]);

// Three characters, because a two-character substring match is a scan wearing a
// filter's clothing. Measured against the live store (258,608 rows):
//
//   %in%   153,165 rows (59.2%)      %on%    81,176 rows (31.4%)
//   %or%   114,647 rows (44.3%)      %ab%     6,138 rows  (2.4%)
//
// The floor is uniform rather than per-pair because the guard cannot know which
// two letters are cheap without running the query it is trying to avoid, and
// the worst cases return most of the province. Verified that no holder in the
// table has a name built only from stop words and shorter fragments, so this
// costs no search for ground that exists.
const MIN_RELAXED_TOKEN_LENGTH = 3;

function isInformativeToken(token) {
  return token.length >= MIN_RELAXED_TOKEN_LENGTH && !RELAXED_STOP_WORDS.has(token);
}

// What the caller is told when their term has nothing to search on.
//
// This has to state BOTH halves of the rule. A term like "AB" is rejected by
// the length floor, not the stop-word list, so a message that only mentions
// single letters and common words tells that user to add the distinctive part
// of the name when "AB" may already be exactly that — the same retry loop with
// nothing learned, which is the failure this message exists to prevent.
//
// Exported so the wording is asserted against the real value rather than a
// copy. useClaims concatenates `error: detail` and truncates at 200
// characters, so the whole rule has to fit inside that budget.
export const UNINFORMATIVE_TERM_ERROR = {
  error: 'Search term is too short or too common',
  detail: 'One word must be at least three letters and not a common word like "the" or "of". Try adding more of the company name.',
};

// Whether a token set is worth issuing as a query.
//
// The test is on the SET, not on each token: in ["a", "azimut"] the "a" costs
// nothing, because "azimut" still constrains the result. Only a set with no
// informative token anywhere is refused.
export function isInformativeTokenSet(tokens) {
  return tokens.length > 0 && tokens.some(isInformativeToken);
}

// Progressively looser token sets, most specific first.
//
// Exported and pure so the strategy can be tested without a network: what
// matters is WHICH searches are tried and in what order, not how they are
// fetched.
export function relaxedTokenSets(tokens) {
  const sets = [tokens];
  const withoutGeneric = tokens.filter((t) => !GENERIC_OWNER_WORDS.has(t));
  // Joiners come off with the industry words, not after them. Filtering only
  // the industry words produced rungs like ["barrick", "of"] out of "Barrick
  // Gold Corporation of North America" — a rung requiring `%of%`, which no
  // registry rendering of that name carries, so it could only ever return
  // nothing. Against the live B.C. layer it scored 0 where ["barrick"] alone
  // scored 79: a whole round trip spent proving a joiner is not part of the
  // company's name.
  //
  // The exact term is unaffected. Rung one is still every token as typed; only
  // the already-relaxed rungs stop carrying words that cannot narrow anything.
  const distinctive = withoutGeneric.filter(isInformativeToken);

  // Drop the industry words — but only if it actually removed anything, and
  // only if what remains can still narrow the table. "A Gold Corporation"
  // reduces to ["a"], which is not a search.
  if (distinctive.length < tokens.length && isInformativeTokenSet(distinctive)) {
    sets.push(distinctive);
  }

  // Last resort: the single most distinctive word. Longest is a decent proxy —
  // "azimut" over "corp" — and it beats picking the first, which is usually the
  // least specific word in an English company name.
  //
  // Chosen from the informative tokens only. Taking the longest overall would
  // pick "the" out of ["the", "of"] and issue the same table scan by a longer
  // route. If nothing in the pool is informative there is no fallback to make.
  // Deliberately the generic-word filter ONLY, not `distinctive`. Narrowing it
  // further would flip an all-joiner remainder back to the full token list and
  // hand "A Gold Corporation" a ["gold"] rung — every gold company in the
  // province, which is the noise this last resort is supposed to avoid.
  const pool = withoutGeneric.length ? withoutGeneric : tokens;
  const informative = pool.filter(isInformativeToken);
  if (pool.length > 1 && informative.length) {
    const longest = informative.reduce((a, b) => (b.length > a.length ? b : a));
    sets.push([longest]);
  }

  // De-duplicate while preserving order: a two-word name often collapses to the
  // same set twice, and repeating a query that already returned nothing is pure
  // latency.
  const seen = new Set();
  return sets.filter((s) => {
    const key = s.join(' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Near-miss ladders ──────────────────────────────────────────────────────
//
// A registry search that answers "0 results" and stops is the single worst
// outcome this product has. Measured over 120 days of search_events: 33.5% of
// all searches returned nothing, and every claim-NUMBER search on record did —
// 10 of 10, across BC, QC and MB. A miner who types the number off their own
// claim schedule and gets a blank page concludes the tool has no data, which is
// the opposite of what happened.
//
// The rule these helpers implement: try the exact thing first, and only if it
// finds nothing, widen — in an order that keeps the answer explainable, and
// always reporting WHICH search actually answered so the UI can say so. A
// widened result presented as an exact one would be far worse than the empty
// page it replaces.

// Below three characters a prefix or contains match stops being a near miss and
// becomes a table scan: "1" as a prefix matches every number in the registry.
export const MIN_NUMBER_PREFIX_LENGTH = 3;

// A relaxed number search answers "the closest numbers we hold", not "here are
// nine thousand claims". The cap is what makes the widened answer readable, and
// what stops a two-digit-ish prefix from paging an entire province back.
export const NEAR_MISS_LIMIT = 50;

// ── Claim-number lists ─────────────────────────────────────────────────────
//
// A box holding several numbers (parseClaimNumbers in shared/claimNumbers.js)
// is answered with ONE upstream query of exact matches, never a ladder per
// number, and the response says which numbers were found and which were not.
// "Found 28 of 30" with the two missing numbers named is the answer somebody
// pasting a claim schedule needs; a near miss for each would bury it.

/** meta.numberList: which of the asked-for numbers came back. */
export function numberListMeta(list, features, idsOf) {
  const key = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');
  const have = new Set(features.flatMap((f) => idsOf(f).filter((v) => v != null && v !== '').map(key)));
  const found = [];
  const missing = [];
  list.numbers.forEach((n) => (have.has(key(n)) ? found : missing).push(n));
  return {
    requested: list.numbers.length,
    total: list.total,
    truncated: list.truncated,
    max: MAX_CLAIM_NUMBERS,
    found,
    missing,
  };
}

// What may go into a Quebec tag filter: the store keeps tags in capitals,
// digits and letters only ("2654321", "156PTA").
const QC_TAG_FORM = /^[A-Z0-9-]+$/;

/** The spellings of each listed number the Quebec store may hold. */
export function qcNumberForms(numbers) {
  return [...new Set(numbers.flatMap((n) => {
    const up = String(n).toUpperCase();
    return [up, up.replace(/-/g, '')];
  }))].filter((f) => QC_TAG_FORM.test(f));
}

/**
 * The smallest string greater than every string that starts with `prefix`, for
 * an indexed range scan (`>= prefix AND < bound`). Null when there is none
 * ("999", "ZZ") — the caller then scans from the prefix in order and filters.
 */
export function prefixUpperBound(prefix) {
  const chars = String(prefix ?? '').split('');
  while (chars.length) {
    const c = chars.pop();
    if (/[0-8A-Ya-y]/.test(c)) {
      chars.push(String.fromCharCode(c.charCodeAt(0) + 1));
      return chars.join('');
    }
  }
  return null;
}

/**
 * The ordered attempts for a claim-number search, widest last.
 *
 * Tiers before forms: every exact form is tried before any prefix, because an
 * exact hit on the compact spelling ("CB 12345" → "CB12345") is a better answer
 * than a prefix hit on the raw one. Registries differ on whether they store the
 * separators people type, and on whether the tag carries its letter prefix, so
 * the forms are all plausible spellings of the SAME number rather than
 * different searches.
 *
 * Exported and pure: what matters is which searches run and in what order, not
 * how any one provider phrases them.
 *
 * @param {string} term raw user input
 * @returns {Array<{match: 'exact'|'prefix'|'contains', term: string}>}
 */
export function numberSearchLadder(term) {
  const raw = String(term ?? '').trim();
  if (!raw) return [];
  const compact = raw.replace(/[\s-]/g, '');
  // "CB12345" → "12345". Some layers store the letter prefix in a separate
  // column, or not at all, so the bare digits are a real spelling of the same
  // identifier — but only when they are not already the whole term.
  const digits = compact.replace(/\D/g, '');
  const forms = [...new Set([raw, compact, digits])].filter(Boolean).map((t) => ({
    term: t,
    // DERIVED means letters were removed to get here, and that changes what the
    // form may be compared against. "CB12345" and its digits "12345" are the
    // same string to a LIKE on a tag column, but as a NUMBER "12345" is a
    // different claim — tenure 12345 has nothing to do with tag CB12345.
    // Callers use this to keep a derived form away from numeric comparisons, so
    // a layer that publishes only numeric identifiers still refuses an
    // alphanumeric tag honestly instead of answering with somebody else's
    // ground. Stripping spaces and dashes is not derivation: those are
    // separators the registry may simply not store.
    derived: t !== raw && t !== compact,
  }));
  const wide = forms.filter((f) => f.term.length >= MIN_NUMBER_PREFIX_LENGTH);

  const steps = [
    ...forms.map((f) => ({ ...f, match: 'exact' })),
    ...wide.map((f) => ({ ...f, match: 'prefix' })),
    ...wide.map((f) => ({ ...f, match: 'contains' })),
  ];

  const seen = new Set();
  return steps.filter((s) => {
    const key = `${s.match}:${s.term}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Prefix match for a NUMERIC column, expressed as ranges.
 *
 * A numeric identifier cannot take a LIKE, so "starts with 26543" becomes
 * "between 265430 and 265439, or between 2654300 and 2654399, …" — one range
 * per possible total length. This is what makes the near-miss ladder reach the
 * columns that carry most claim numbers: B.C.'s TENURE_NUMBER_ID is numeric and
 * present on every title, while the string TAG_NUMBER is null on 87% of them.
 *
 * Leading zeros are refused rather than stripped: a numeric column cannot store
 * "012345" distinctly from "12345", so treating them as the same search would
 * quietly answer a different question than the one typed.
 *
 * @param {string} digits digits only
 * @param {number} maxDigits longest identifier worth considering
 */
export function numericPrefixRanges(digits, maxDigits = 9) {
  const d = String(digits ?? '');
  if (!/^\d+$/.test(d) || d.startsWith('0')) return [];
  const out = [];
  for (let len = d.length + 1; len <= maxDigits; len += 1) {
    const lo = Number(d + '0'.repeat(len - d.length));
    const hi = Number(d + '9'.repeat(len - d.length));
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi)) break;
    out.push([lo, hi]);
  }
  return out;
}

/**
 * Run an ordered ladder until something answers, or the ladder runs out.
 *
 * Sequential on purpose: every attempt after the first only exists because the
 * previous one found nothing, so a search that succeeds — the common case —
 * costs exactly one upstream request.
 *
 * @param {Array} steps  attempts, most specific first
 * @param {(step) => Promise<{features: Array, meta?: object}>} run
 * @returns {{features, meta, step, stepIndex}} the first non-empty answer, or the last attempt
 */
export async function runLadder(steps, run) {
  let last = { features: [], meta: {} };
  for (let i = 0; i < steps.length; i += 1) {
    // Deliberately sequential: each rung only runs because the one before it
    // found nothing.
    const r = await run(steps[i]);
    if (r.features.length) return { ...r, step: steps[i], stepIndex: i };
    last = r;
  }
  return { ...last, step: null, stepIndex: -1 };
}

/**
 * The meta a widened answer must carry, or null when the exact search answered.
 *
 * The UI leads with this. `relaxedKind` says which dimension was widened and
 * `relaxedMatch` how far, because "we matched fewer words of the company name"
 * and "we matched claim numbers starting with yours" need different sentences —
 * and a number near-miss must never be described as a holder match.
 */
export function relaxationMeta({ kind, match, from, to, limited = false }) {
  if (!from || !to) return null;
  // A same-TEXT widening is still a widening: "26543" as a prefix is a
  // different search from "26543" exact, and returns claims whose number is not
  // the one typed. Only a same-text EXACT/token match is a no-op worth
  // suppressing, so the equality shortcut has to exclude the pattern matches or
  // the most common near miss would ship unlabelled.
  if (match !== 'prefix' && match !== 'contains' && String(from) === String(to)) return null;
  return {
    relaxedFrom: String(from),
    relaxedTo: String(to),
    relaxedKind: kind,
    relaxedMatch: match,
    ...(limited ? { relaxedLimited: NEAR_MISS_LIMIT } : {}),
  };
}

/**
 * Fallback attempts for a CLAIM-NAME search, widest last.
 *
 * Claim names are not company names and are never tokenised the way holders
 * are — "Gold Hill Company" is the claim's actual name, and matching GOLD and
 * HILL in any order would also match "Hill of Gold", a different piece of
 * ground. So the only widening offered here is the single most distinctive
 * word, as a contains match, and the UI says exactly that when it is used.
 *
 * Returned as term arrays so the caller can feed them to the same clause
 * builder the exact rung uses. An empty array means "search the term as typed".
 */
export function claimNameFallbacks(term) {
  const words = String(term ?? '').trim().split(/\s+/).filter(Boolean);
  const sets = [[]];
  if (words.length > 1) {
    const informative = words.map(foldForSearch).filter(isInformativeToken);
    if (informative.length) {
      sets.push([informative.reduce((a, b) => (b.length > a.length ? b : a))]);
    }
  }
  return sets;
}

/**
 * The relaxation ladder for a column that stores names as the registry wrote
 * them, rather than folded.
 *
 * relaxedTokenSets decides which words to drop by comparing against lists of
 * lowercase, accent-free vocabulary, so it has to be fed FOLDED tokens —
 * GENERIC_OWNER_WORDS holds "development", and "Development" is not in it.
 * Quebec's store has a folded column to query, so it can use the folded tokens
 * directly. Every other registry stores the real spelling, and querying
 * "aurifere" against a column holding "Aurifère" would match nothing.
 *
 * So: decide on the folded text, query with the original. Position mapping,
 * not re-folding, because folding is not reversible.
 */
export function relaxedTokenSetsPreservingSpelling(tokens) {
  const folded = tokens.map(foldForSearch);
  const original = new Map();
  folded.forEach((f, i) => { if (!original.has(f)) original.set(f, tokens[i]); });
  return relaxedTokenSets(folded).map((set) => set.map((f) => original.get(f) ?? f));
}

async function searchQc(term, type, res, { numberList = null } = {}) {
  const creds = qcSupabaseCreds();
  if (!creds) {
    return res.status(503).json({ error: 'Quebec claims data is not available right now.' });
  }
  const { base, key } = creds;

  // PostgREST treats * as the ilike wildcard; strip user-supplied wildcards and
  // PostgREST-reserved characters so the term can only match literally.
  const cleaned = term.replace(/[*%,()]/g, ' ').trim();
  if (cleaned.length < 2) {
    return res.status(400).json({ error: 'q param required (min 2 chars)' });
  }

  // Holder search matches TOKENS against a folded column, not the raw name as
  // one contiguous string.
  //
  // GESTIM is francophone: it stores "Exploration Azimut inc." for the company
  // the market calls Azimut Exploration, and "Corporation Aurifère Vior Inc."
  // for Vior. A single `%term%` could match neither the reversed word order nor
  // a missing accent, so the province's two largest holders returned nothing
  // for their own names — 0 rows where token matching returns 10,891 and 8,646.
  // 96 owners holding 22% of Quebec's claims carry French-order names, and 282
  // holding 20% carry accents.
  //
  // owner_name_norm is accent-stripped and lowercased (migration
  // 20260813000001), so the needle is folded the same way here. The displayed
  // OWNER_NAME still comes from the original column and keeps its real
  // spelling.
  //
  // Repeated filter keys rather than PostgREST's `and=(...)` grouping: this is
  // the identical `column=ilike.value` shape already proven in production, and
  // PostgREST ANDs duplicate keys. The grouped form would put the tokens inside
  // a comma-separated list, which is parsing surface for no benefit.
  const runQuery = async (filter, maxTotal = undefined) => fetchAllPages({
    provider: 'qc-store',
    pageSize: Math.min(1000, maxTotal || 1000),
    ...(maxTotal ? { maxTotal } : {}),
    idField: 'TAG_NUMBER',
    fetchPage: async (offset, count) => {
      const url = `${base}/rest/v1/qc_claims?` +
        `select=tag_number,owner_name,status,good_to_date,area_hectares,title_type,geometry` +
        `&${filter}&limit=${count}&offset=${offset}`;
      const r = await fetch(url, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`Quebec claims store ${r.status}: ${body.slice(0, 300)}`);
      }
      const rows = await r.json();
      // Keys already match what the UI renders; no normalizeProps pass needed.
      return { features: rows.map(qcRowToFeature) };
    },
  });

  if (type === 'number' && numberList) {
    // A pasted list: one indexed IN query for all of them, exact matches only.
    // A near miss for each of thirty numbers would bury the thirty answers.
    const forms = qcNumberForms(numberList.numbers);
    const r = forms.length ? await runQuery(`tag_number=in.(${forms.map(encodeURIComponent).join(',')})`) : { features: [], meta: {} };
    return res.status(200).json({
      type: 'FeatureCollection',
      features: r.features,
      meta: { ...r.meta, numberList: numberListMeta(numberList, r.features, (f) => [f.properties?.TAG_NUMBER]) },
    });
  }

  if (type === 'number') {
    // Exact, then starts-with. Quebec's store holds ~253,000 tag numbers, most
    // of them seven digits, so somebody typing the first five digits off a
    // claim schedule — or a number with a "CDC" prefix the store does not keep
    // — used to get a blank page.
    //
    // EVERY RUNG MUST USE THE qc_claims_tag BTREE INDEX. Until Oct 2026 the
    // rungs were `ilike` patterns, which no btree index can serve, so each one
    // was a sequential scan of the 132 MB table (~0.9 s warm, far longer cold).
    // A number in the store answered on the first rung; any number NOT in the
    // store fell through to the prefix scan, which ran into the anon role's
    // 3 s statement_timeout, came back from PostgREST as a 500 and reached the
    // user as an error — never as "not found". That was every failing Quebec
    // number search on record (4527312, 5241271, 1212697, "#4527312", and the
    // company names typed into the Claim # tab). So: exact is `in.(forms)`,
    // a prefix is a `gte`/`lt` range in tag order, and there is no contains
    // rung — a leading wildcard can only ever be a full scan.
    const ladder = numberSearchLadder(cleaned)
      .filter((s) => s.match !== 'contains')
      .map((s) => ({ ...s, term: s.term.toUpperCase() }))
      .filter((s) => QC_TAG_FORM.test(s.term));
    const exactForms = [...new Set(ladder.filter((s) => s.match === 'exact').map((s) => s.term))];
    const steps = [
      ...(exactForms.length ? [{ match: 'exact', term: exactForms[0], forms: exactForms }] : []),
      ...ladder.filter((s) => s.match === 'prefix'),
    ];
    const { features, meta, step } = await runLadder(steps, async (s) => {
      if (s.match === 'exact') {
        return runQuery(`tag_number=in.(${s.forms.map(encodeURIComponent).join(',')})`);
      }
      // The range finds the closest numbers in tag order; the startsWith check
      // keeps only true prefix matches (it matters only when no upper bound
      // could be formed, e.g. "999").
      const upper = prefixUpperBound(s.term);
      const r = await runQuery(
        `tag_number=gte.${encodeURIComponent(s.term)}`
          + (upper ? `&tag_number=lt.${encodeURIComponent(upper)}` : '')
          + '&order=tag_number.asc',
        NEAR_MISS_LIMIT,
      );
      const kept = r.features.filter((f) => String(f.properties?.TAG_NUMBER || '').toUpperCase().startsWith(s.term));
      return { features: kept, meta: { ...r.meta, truncated: r.meta?.truncated === true && kept.length >= NEAR_MISS_LIMIT } };
    });
    const widened = step && step.match !== 'exact';
    const shown = widened ? features.slice(0, NEAR_MISS_LIMIT) : features;
    return res.status(200).json({
      type: 'FeatureCollection',
      features: shown,
      meta: {
        ...meta,
        ...(widened ? relaxationMeta({
          kind: 'number',
          match: step.match,
          from: cleaned,
          to: step.term,
          limited: features.length > shown.length || meta.truncated === true,
        }) : {}),
      },
    });
  }

  const rawTokens = ownerSearchTokens(cleaned);
  const tokens = rawTokens.map(foldForSearch).filter(Boolean);
  // Folded for the query (owner_name_norm is folded), original for the banner:
  // telling somebody who searched "Vior Gold Corporation" that we matched
  // "vior" is accurate but reads like a different word than the one they typed.
  const spellingOf = new Map();
  rawTokens.forEach((t, i) => {
    const f = foldForSearch(t);
    if (f && !spellingOf.has(f)) spellingOf.set(f, rawTokens[i]);
  });
  // A term of only punctuation ("...") survives the length check above but
  // tokenises to nothing. An empty filter string is not a harmless no-op — it
  // would drop the WHERE clause entirely and page the whole table back.
  //
  // A term of only stop words ("a.", "the") is the same failure with a WHERE
  // clause attached: `%a%` matches 72% of the store and pages to the
  // 10,000-feature ceiling, from an endpoint anonymous callers can reach. The
  // relaxed sets below refuse such a search, and the exact set has to refuse it
  // too — otherwise the guard only covers the fallback and not the front door.
  //
  // The message must not be the length error. "the" and "AB" clear the
  // two-character minimum the input enforces, so answering them with "min 2
  // chars" states a condition the user has already met and leaves them with no
  // way to work out what the search actually wants. useClaims renders this
  // verbatim, so it is the entire explanation they get.
  if (!isInformativeTokenSet(tokens)) {
    return res.status(400).json(UNINFORMATIVE_TERM_ERROR);
  }

  // Try the exact token set first, then progressively looser ones.
  //
  // Requiring every token is right when every token is right, and wrong the
  // moment one word differs from the registry's — which in a bilingual
  // jurisdiction is common. This does what the empty state used to ask the user
  // to do by hand ("try one distinctive word"), and reports what it actually
  // searched so a relaxed hit can never be read as an exact one.
  //
  // Order matters: an exact match always wins, and the loose sets only run when
  // the stricter one found nothing, so a successful search costs no extra
  // queries.
  const attempts = relaxedTokenSets(tokens);
  let result = null;
  let usedTokens = tokens;
  for (const set of attempts) {
    const filter = set
      .map((t) => `owner_name_norm=ilike.${encodeURIComponent(`*${t}*`)}`)
      .join('&');
    // Deliberately sequential: each attempt only runs because the previous one
    // found nothing.
    const r = await runQuery(filter);
    if (r.features.length) { result = r; usedTokens = set; break; }
    result = r;
  }

  const relaxed = usedTokens.length !== tokens.length && result.features.length > 0;
  return res.status(200).json({
    type: 'FeatureCollection',
    features: result.features,
    meta: {
      ...result.meta,
      // Present only when the answer came from a looser search than the one
      // asked for. The UI leads with this — results the user did not literally
      // ask for have to say so.
      ...(relaxed ? relaxationMeta({
        kind: 'owner',
        match: 'tokens',
        from: cleaned,
        to: usedTokens.map((t) => spellingOf.get(t) ?? t).join(' '),
      }) : {}),
    },
  });
}

// Quebec nearby-radius (bbox) query. The store has no live ArcGIS service, so
// the spatial lookup runs in Postgres via the qc_claims_in_bbox PostGIS RPC
// (see supabase-qc-claims-setup.sql) and returns the same row shape as search.
async function searchQcBbox(minLng, minLat, maxLng, maxLat, res) {
  const creds = qcSupabaseCreds();
  if (!creds) {
    return res.status(503).json({ error: 'Quebec claims data is not available right now.' });
  }
  const { base, key } = creds;
  const r = await fetch(`${base}/rest/v1/rpc/qc_claims_in_bbox`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    // PGRST202 = the RPC hasn't been created yet (setup SQL not run)
    if (r.status === 404 || /PGRST202/.test(body)) {
      return res.status(503).json({
        error: 'Quebec nearby-claims search is not set up yet. Run the qc_claims spatial setup SQL.',
      });
    }
    throw new Error(`Quebec claims store ${r.status}: ${body.slice(0, 300)}`);
  }
  const rows = await r.json();
  const features = rows.map(qcRowToFeature);
  return res.status(200).json({ type: 'FeatureCollection', features });
}

/**
 * The CQL filter for a B.C. registry search.
 *
 * EXPORTED so it can be tested. The bug this function now carries a guard
 * against was invisible from the outside: the request succeeded, the WFS
 * server answered, and the UI said "no claims found" — so it read as ground
 * nobody had staked rather than a query that could never match.
 *
 * @param {string} term  raw user input
 * @param {'number'|'name'|'company'} type
 * @returns {string} a CQL_FILTER expression
 */
export function bcCqlFilter(term, type, opts = {}) {
  const safeTerm = String(term).replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
  // `match` widens the NUMBER branch and `tokens` replaces the owner branch's
  // token set. Both default to the exact behaviour this function has always
  // had, so a caller that passes neither gets the same filter as before.
  const { match = 'exact', tokens: ownerTokens = null, derived = false } = opts;

  if (type === 'number') {
    if (match !== 'exact') {
      // Starts-with / contains across BOTH identifiers.
      //
      // TAG_NUMBER is a string and takes a LIKE directly. TENURE_NUMBER_ID is
      // numeric and cannot, so "starts with 26543" becomes a set of ranges —
      // see numericPrefixRanges. Skipping the numeric column here would make
      // the widened search reach 13% of B.C. titles: the tag is null on 36,925
      // of 42,332, and the tenure number is the one every title carries.
      const pattern = match === 'prefix' ? `${safeTerm}%` : `%${safeTerm}%`;
      const clauses = [`TAG_NUMBER LIKE '${pattern}'`];
      if (match === 'prefix' && !derived && /^\d+$/.test(String(term))) {
        for (const [lo, hi] of numericPrefixRanges(String(term))) {
          clauses.push(`(TENURE_NUMBER_ID >= ${lo} AND TENURE_NUMBER_ID <= ${hi})`);
        }
      }
      return clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
    }
    // A B.C. claim has TWO numbers, and people arrive holding either one:
    //
    //   TENURE_NUMBER_ID  the tenure number. Numeric in the source, present on
    //                     EVERY title, 6 or 7 digits. This is what MTO shows,
    //                     what a claim schedule lists, and what our own
    //                     placeholder tells the user to type ("e.g. 1012345").
    //   TAG_NUMBER        the staking tag. A string, and NULL on 36,925 of the
    //                     42,332 titles in the mirror — cell claims have none.
    //
    // This filter used to be TAG_NUMBER alone, so somebody typing exactly what
    // the placeholder showed them got nothing across 87% of the province.
    //
    // TENURE_NUMBER_ID is numeric in the source, so its comparison must be
    // UNQUOTED — quoting a numeric field makes the WFS server reject the whole
    // filter. The tag clause is the only one used for a non-numeric term, so a
    // claim name never produces a malformed numeric comparison.
    return /^\d+$/.test(term) && !derived
      ? `(TENURE_NUMBER_ID = ${term} OR TAG_NUMBER = '${safeTerm}')`
      : `TAG_NUMBER = '${safeTerm}'`;
  }
  if (type === 'name') return `CLAIM_NAME ILIKE '%${safeTerm}%'`;
  // Owner search requires every meaningful word, in any order, rather than one
  // contiguous string — see ownerSearchTokens for why (every full-legal-name
  // search on the live site returned nothing).
  //
  // The caller may pass an already-relaxed token set (searchBc walks the same
  // ladder Quebec does). Nothing else changes: the clause shape, the escaping
  // and the single-token fallback are identical whichever set arrives.
  const tokens = ownerTokens || ownerSearchTokens(term);
  const clauses = tokens.map((t) => {
    const safe = t.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
    return `OWNER_NAME ILIKE '%${safe}%'`;
  });
  if (!clauses.length) return `OWNER_NAME ILIKE '%${safeTerm}%'`;
  return clauses.length > 1 ? `(${clauses.join(' AND ')})` : clauses[0];
}

/** CQL for a list of B.C. numbers: tenure numbers (numeric, unquoted) or tags. */
export function bcNumberListFilter(numbers) {
  const quoted = numbers.map((n) => `'${String(n).replace(/'/g, "''")}'`);
  const tenures = numbers.filter((n) => /^\d+$/.test(n));
  const tag = `TAG_NUMBER IN (${quoted.join(',')})`;
  return tenures.length ? `(TENURE_NUMBER_ID IN (${tenures.join(',')}) OR ${tag})` : tag;
}

async function searchBc(term, type, res, { numberList = null } = {}) {
  const runFilter = (cqlFilter, maxTotal = undefined) => {
    const buildUrl = (startIndex, count) => [
      'https://openmaps.gov.bc.ca/geo/pub/wfs',
      '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature',
      '&outputFormat=application/json',
      '&typeNames=pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW',
      '&SRSNAME=EPSG:4326',
      `&CQL_FILTER=${encodeURIComponent(cqlFilter)}`,
      '&sortBy=TENURE_NUMBER_ID',   // WFS paging requires a stable sort
      `&count=${count}`,
      `&startIndex=${startIndex}`,
    ].join('');
    return fetchWfsAll({
      fetchJson,
      buildUrl,
      pageSize: Math.min(1000, maxTotal || 1000),
      provider: 'bc-wfs',
      ...(maxTotal ? { maxTotal } : {}),
    });
  };

  if (type === 'number' && numberList) {
    // One filter for the whole list: the tenure numbers as a numeric IN, every
    // token as a tag IN. Exact matches only (see numberListMeta).
    const { features, meta } = await runFilter(bcNumberListFilter(numberList.numbers));
    return res.status(200).json({
      type: 'FeatureCollection',
      features,
      meta: { ...meta, numberList: numberListMeta(numberList, features, (f) => [f.properties?.TENURE_NUMBER_ID, f.properties?.TAG_NUMBER]) },
    });
  }

  if (type === 'number') {
    // Exact on both identifiers, then starts-with, then contains. All three
    // B.C. number searches on record returned nothing; a tenure number is 6 or
    // 7 digits and people routinely arrive with a partial one off a schedule,
    // a map margin, or a news release.
    const ladder = numberSearchLadder(term);
    const { features, meta, step } = await runLadder(
      ladder,
      (s) => runFilter(
        bcCqlFilter(s.term, 'number', { match: s.match, derived: s.derived }),
        // A widened rung answers "the closest numbers", capped — so fetch that
        // many rather than paging the province back to discard most of it.
        s.match === 'exact' ? undefined : NEAR_MISS_LIMIT,
      ),
    );
    const widened = step && step.match !== 'exact';
    const shown = widened ? features.slice(0, NEAR_MISS_LIMIT) : features;
    return res.status(200).json({
      type: 'FeatureCollection',
      features: shown,
      meta: {
        ...meta,
        ...(widened ? relaxationMeta({
          kind: 'number',
          match: step.match,
          from: term,
          to: step.term,
          limited: features.length > shown.length || meta.truncated === true,
        }) : {}),
      },
    });
  }

  if (type === 'company') {
    // The same ladder Quebec has had: every token, then the distinctive words,
    // then the single most distinctive one. B.C. is the busiest jurisdiction in
    // the product and 24% of its company searches returned nothing — the
    // relaxation was never province-specific, only the code was.
    const tokens = ownerSearchTokens(term);
    const attempts = tokens.length ? relaxedTokenSetsPreservingSpelling(tokens) : [[]];
    const { features, meta, step } = await runLadder(
      attempts.map((set) => ({ match: 'tokens', term: set.join(' '), tokens: set })),
      (s) => runFilter(bcCqlFilter(term, 'company', { tokens: s.tokens.length ? s.tokens : null })),
    );
    const widened = step && step.tokens.length !== tokens.length;
    return res.status(200).json({
      type: 'FeatureCollection',
      features,
      meta: {
        ...meta,
        ...(widened ? relaxationMeta({
          kind: 'owner', match: 'tokens', from: term, to: step.term,
        }) : {}),
      },
    });
  }

  const { features, meta } = await runFilter(bcCqlFilter(term, type));
  return res.status(200).json({ type: 'FeatureCollection', features, meta });
}

// Canadian jurisdictions whose registry publishes a holder, so text typed into
// the Claim # box can be answered as the company search it obviously is. Not
// Manitoba (no holder field) and not the US, where "company" is a claim-NAME
// match and must stay an explicit choice.
function companySearchable(province) {
  if (province === 'bc' || province === 'qc') return true;
  const cfg = ARCGIS_PROVINCES[province];
  return Boolean(cfg?.ownerFields?.length);
}

/**
 * What a claim-number request should actually search.
 *
 *   "#4527312", "No. 627637"      → that one number, markers removed
 *   "2351771 2351772, 2351773"    → a list (numberList), capped at MAX_CLAIM_NUMBERS
 *   "big ridge gold corp"         → a company search, flagged meta.searchedAs
 *                                   (where the registry publishes holders)
 *   anything else in one piece    → searched exactly as before ("CB12345",
 *                                   and the escaping tests' "%%" or "CB_2345")
 *
 * @returns {{type, term, numberList, extraMeta} | {error: string}}
 */
export function claimNumberRequest(term, province) {
  const asBefore = { type: 'number', term, numberList: null, extraMeta: null };
  const asCompany = () => {
    const company = term.trim();
    if (company.length > MAX_TERM_LENGTH) return { error: `Search term too long (max ${MAX_TERM_LENGTH} characters).` };
    return { type: 'company', term: company, numberList: null, extraMeta: { searchedAs: 'company', requestedType: 'number' } };
  };
  // One piece with no "#" or separator: only a plain word changes meaning
  // ("destiny" is a company); everything else is the number search it was.
  if (!/[\s,;|#]/.test(term)) {
    if (/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'&-]*$/.test(term) && companySearchable(province)) return asCompany();
    if (term.length > MAX_TERM_LENGTH) return { error: `Search term too long (max ${MAX_TERM_LENGTH} characters).` };
    return asBefore;
  }
  const parsed = parseClaimNumbers(term);
  if (parsed.kind === 'text' && companySearchable(province)) return asCompany();
  if (parsed.kind !== 'numbers') return term.length > MAX_TERM_LENGTH ? { error: `Search term too long (max ${MAX_TERM_LENGTH} characters).` } : asBefore;
  if (parsed.total > 1) return { type: 'number', term, numberList: parsed, extraMeta: null };
  // One number. Keep the spelling as typed ("CB 12345") when it is the same
  // number, so the ladder still tries the registry's own separator.
  const single = cleanSingleNumber(term);
  const same = single.replace(/[\s-]/g, '').toUpperCase() === parsed.numbers[0].replace(/-/g, '').toUpperCase();
  return { type: 'number', term: same ? single : parsed.numbers[0], numberList: null, extraMeta: null };
}

// Adds fields to the meta of a FeatureCollection response without the search
// functions having to know about it.
function withExtraMeta(res, extra) {
  const wrapped = {
    status(code) { res.status(code); return wrapped; },
    setHeader: (...a) => res.setHeader?.(...a),
    json(body) {
      return res.json(body?.type === 'FeatureCollection' ? { ...body, meta: { ...(body.meta || {}), ...extra } } : body);
    },
  };
  return wrapped;
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['GET'])) return;
  if (queryTooLong(req)) return res.status(414).json({ error: 'query string too long' });
  if (rateLimited(req, { max: 60, windowMs: 60_000, bucket: 'claims' })) {
    return res.status(429).json({ error: 'rate limited — slow down and try again' });
  }

  const { q, schema, bbox } = req.query;
  let { type } = req.query;
  const province = (req.query.province || 'bc').toLowerCase();

  // BBOX spatial query: return all claims within an envelope (nearby claims overlay)
  // BC bbox is handled by the dedicated /api/bc-claims proxy; this handles SK/ON/YT.
  if (bbox && province !== 'bc') {
    const checked = validateBbox(bbox);
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const [minLng, minLat, maxLng, maxLat] = checked.bbox;
    // Quebec is self-hosted; its spatial lookup runs in Postgres/PostGIS.
    if (province === 'qc') {
      try {
        return await searchQcBbox(minLng, minLat, maxLng, maxLat, res);
      } catch (e) {
        return res.status(502).json({ error: publicErrorMessage(e, 'Failed to reach the Quebec claims store.') });
      }
    }
    const cfg = getArcgisJurisdiction(province);
    if (!cfg) {
      return res.status(400).json({ error: `Province '${province}' is not supported.` });
    }
    // US: the weekly mirror answers when it is fresh; live BLM otherwise.
    if (cfg.provider === 'blm-mlrs') {
      const mirror = await usMirrorStatus();
      if (mirror) {
        try {
          return await searchUsMirrorBbox(cfg, minLng, minLat, maxLng, maxLat, withExtraMeta(res, usMirrorMeta(mirror)));
        } catch (e) {
          console.warn('[claims] US mirror bbox failed, answering from live BLM:', e?.message);
        }
      }
    }
    try {
      // 'number' resolves for every jurisdiction (US has no owner fields);
      // the bbox path only needs a valid layer URL + field list.
      // 'number' resolves for every jurisdiction; the bbox path only needs a
      // valid layer URL + field list. US layers list claimant candidates that
      // the live layer doesn't publish, so they resolve by number too.
      const resolveType = (cfg.provider === 'blm-mlrs' || !cfg.ownerFields?.length) ? 'number' : 'company';
      const { layerUrl, fields } = await resolveLayerAndFields(cfg, resolveType);
      let scoping = null;
      try {
        scoping = resolveUsScoping(cfg, fields);
      } catch (e) {
        return res.status(502).json({ error: e.message });
      }
      // A bbox is already geographic, so a per-row US scope does not narrow it
      // by serial prefix in SQL — rows are placed by their own location only.
      const sqlScope = scoping && !scoping.perRow ? scoping.where : (scoping ? '1=1' : null);
      const { features, meta } = await queryLayer(cfg, layerUrl, {
        ...(sqlScope ? { where: sqlScope } : {}),
        geometry: JSON.stringify({ xmin: minLng, ymin: minLat, xmax: maxLng, ymax: maxLat, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
      }, { scoping, narrow: false });
      return res.status(200).json({
        type: 'FeatureCollection',
        features: features.map((f) => ({ ...f, properties: normalizeProps(f.properties || {}, cfg) })),
        // The nearby-claims overlay is a claim set like any other — it declares
        // its scoping too, so a degraded scope can't slip onto the map here.
        meta: { ...withScopingMeta(meta, scoping), ...(cfg.provider === 'blm-mlrs' ? { source: 'live' } : {}) },
      });
    } catch (e) {
      return upstreamErrorResponse(res, e, 'Failed to reach the provincial registry.');
    }
  }

  // Raw-fetch diagnostics: hit the layer metadata endpoint directly on both URL
  // schemes and report the exact status / body snippet, so we can tell an IP/WAF
  // block (fast 403) from a timeout or a moved service. Read-only, no auth.
  if (schema === 'raw' && getArcgisJurisdiction(province)) {
    if (!diagnosticsAllowed(req)) return res.status(404).json({ error: 'not found' });
    const cfg = getArcgisJurisdiction(province);
    const layerId = cfg.layerId != null ? cfg.layerId : 0;
    const baseUrl = `${cfg.service}/${layerId}?f=json`;
    const urls = [baseUrl];
    if (/^http:\/\//i.test(baseUrl)) urls.push(baseUrl.replace(/^http:/i, 'https:'));
    else urls.push(baseUrl.replace(/^https:/i, 'http:'));
    const attempts = [];
    for (const u of urls) {
      const started = Date.now();
      try {
        // redirect: 'manual' so a moved service shows up as the 3xx it is.
        const rr = await fetch(u, { headers: FALLBACK_FETCH_HEADERS, signal: AbortSignal.timeout(15000), redirect: 'manual' });
        const body = await rr.text().catch(() => '');
        const moved = redirectTarget(u, rr);
        attempts.push({
          url: u, ok: rr.ok, status: rr.status, ms: Date.now() - started, contentType: rr.headers.get('content-type'),
          ...(moved ? { location: rr.headers.get('location'), redirect: moved.error ? 'moved (path changed)' : 'same path' } : {}),
          bodySnippet: body.slice(0, 300),
        });
      } catch (e) {
        attempts.push({ url: u, error: String(e.name || e.message || e), ms: Date.now() - started });
      }
    }
    return res.status(200).json({ province, attempts });
  }

  // Diagnostics: report resolved layer + fields for an ArcGIS province
  if (schema === '1' && getArcgisJurisdiction(province)) {
    if (!diagnosticsAllowed(req)) return res.status(404).json({ error: 'not found' });
    try {
      const cfg = getArcgisJurisdiction(province);
      const candidates = await listCandidateLayers(cfg);
      // Owner and number fields may resolve to different layers
      const ownerResolved = cfg.ownerFields?.length ? await resolveLayerAndFields(cfg, 'company') : null;
      const numberResolved = await resolveLayerAndFields(cfg, 'number');
      const nameResolved = cfg.nameFields?.length ? await resolveLayerAndFields(cfg, 'name') : null;
      return res.status(200).json({
        candidateLayers: candidates.map((l) => `${l.id}: ${l.name}`),
        // What the service ACTUALLY publishes at each index. A config that pins
        // layerId never reads the catalogue — listCandidateLayers short-circuits
        // to a synthetic "layer N" — so a service that reorders its leaves would
        // be queried at the wrong index and answer, plausibly, with the wrong
        // claims. MB pins layer 3 ("Mining Claim", with 4 Patent, 5 Exploration
        // Licence and 8 Cancelled beside it) and SK pins layer 0. This is the
        // one place that can show a human whether those pins still point where
        // they were meant to.
        serviceLayers: await describeServiceLayers(cfg),
        pinnedLayerId: cfg.layerId ?? null,
        ...(ownerResolved ? {
          company: {
            layerUrl: ownerResolved.layerUrl,
            layerName: ownerResolved.layerName,
            fields: ownerResolved.fields.map((f) => `${f.name} (${f.type})`),
            ownerField: pickField(cfg.ownerFields, ownerResolved.fields)?.name || null,
          },
        } : {}),
        number: {
          layerUrl: numberResolved.layerUrl,
          layerName: numberResolved.layerName,
          fields: numberResolved.fields.map((f) => `${f.name} (${f.type})`),
          numberField: pickField(cfg.numberFields, numberResolved.fields)?.name || null,
          ...(cfg.legacyNumberFields ? { legacyField: pickField(cfg.legacyNumberFields, numberResolved.fields)?.name || null } : {}),
        },
        ...(nameResolved ? {
          name: {
            layerUrl: nameResolved.layerUrl,
            nameField: pickField(cfg.nameFields, nameResolved.fields)?.name || null,
          },
        } : {}),
        // Which state field answered decides whether scoping is geographic or
        // merely administrative — report the resolved scoping verbatim so a
        // post-deploy check can see a degraded mode without guessing.
        ...(cfg.usState ? {
          service: cfg.service,
          layerId: cfg.layerId ?? null,
          layerUrl: numberResolved.layerUrl,
          layerName: numberResolved.layerName,
          // Whether searches are being answered from the weekly copy, and why not.
          mirror: await usMirrorStatus().then(() => cacheGet('us-mirror-status') || { usable: false, reason: process.env.US_CLAIMS_MIRROR === 'off' ? 'disabled (US_CLAIMS_MIRROR=off)' : 'not configured' }),
          serviceFromEnv: Boolean(process.env.BLM_MLRS_SERVICE_URL),
          layerFromEnv: Boolean(process.env.BLM_MLRS_LAYER_ID),
          scoping: (() => {
            try {
              const s = resolveUsScoping(cfg, numberResolved.fields);
              return {
                method: s.method,
                field: s.field,
                degraded: s.degraded,
                where: s.where,
                perRow: Boolean(s.perRow),
                ...(s.perRow ? { rowOrder: [s.geoField, s.legalField, s.prefixes?.sharedOffice ? null : 'serial prefix'].filter(Boolean) } : {}),
              };
            } catch (e) {
              return { method: null, error: e.message };
            }
          })(),
          geoStateField: pickField(cfg.geoStateFields || [], numberResolved.fields)?.name || null,
          adminStateField: pickField(cfg.adminStateFields || [], numberResolved.fields)?.name || null,
          legalDescriptionField: pickField(cfg.legalDescriptionFields || [], numberResolved.fields)?.name || null,
          recordDateField: pickField(cfg.recordDateFields || [], numberResolved.fields)?.name || null,
          // A field that exists can still be empty — the October 2026 failure.
          fillRates: req.query.fill === '0' ? 'skipped (fill=0)' : await usFieldFillRates(cfg, numberResolved.layerUrl, numberResolved.fields),
        } : {}),
      });
    } catch (e) {
      return res.status(502).json({ error: publicErrorMessage(e, 'Diagnostics failed.') });
    }
  }

  if (province !== 'bc' && province !== 'qc' && !getArcgisJurisdiction(province)) {
    return res.status(400).json({ error: `Jurisdiction '${province}' is not supported yet.` });
  }
  // Map-sheet search is not available anywhere, BC included. The B.C. layer
  // publishes no map sheet column (all 34 fields recorded by the --discover run
  // of 2026-08-05; none is one), so the filter this used to build named a
  // property that does not exist and the WFS rejected every request. It is
  // refused here rather than left to fail upstream, so the answer is honest
  // instead of a 502 that blames the provincial registry for our field name.
  if (type === 'map') {
    return res.status(400).json({
      error: 'Map sheet search is not available',
      detail: 'The provincial registries do not publish a map sheet field. Search by claim number, claim name, or company.',
    });
  }
  // B.C. is served by WFS, not ArcGIS; its layer publishes CLAIM_NAME (see bcCqlFilter).
  if (type === 'name' && province !== 'bc' && !getArcgisJurisdiction(province)?.nameFields?.length) {
    return res.status(400).json({ error: 'Claim-name search is not available for this jurisdiction.' });
  }
  // A claim-number box may hold a pasted list, so it gets the longer limit; the
  // list is then capped by count (shared/claimNumbers.js), not by characters.
  const checkedTerm = validateTerm(q, type === 'number' ? { max: MAX_NUMBER_LIST_LENGTH } : undefined);
  if (!checkedTerm.ok) return res.status(400).json({ error: checkedTerm.error });
  let term = checkedTerm.term;
  // No holder is named with digits alone; a bare number typed into company
  // search is a claim number (the one failed Ontario session of 2026-09-22
  // tried exactly that first).
  if ((type || 'company') === 'company' && /^\d{5,}$/.test(term)) type = 'number';

  // Read the Claim # box the way a person means it (see claimNumberRequest).
  let numberList = null;
  let extraMeta = null;
  if (type === 'number') {
    const read = claimNumberRequest(term, province);
    if (read.error) return res.status(400).json({ error: read.error });
    ({ type, term, numberList, extraMeta } = read);
  }
  const out = extraMeta ? withExtraMeta(res, extraMeta) : res;

  try {
    if (province === 'bc') return await searchBc(term, type, out, { numberList });
    if (province === 'qc') return await searchQc(term, type, out, { numberList });
    const cfg = getArcgisJurisdiction(province);
    if (cfg.provider === 'blm-mlrs') {
      // The weekly mirror answers when it is fresh; a mirror failure falls
      // through to live BLM rather than failing the search.
      const mirror = await usMirrorStatus();
      if (mirror) {
        try {
          // null = the mirror has no answer it should give (a serial it does
          // not hold); live BLM is asked instead.
          const answered = await searchUsMirror(cfg, term, type, withExtraMeta(out, usMirrorMeta(mirror)), { numberList });
          if (answered !== null) return answered;
        } catch (e) {
          console.warn('[claims] US mirror search failed, answering from live BLM:', e?.message);
        }
      }
      return await searchArcgis(cfg, term, type, withExtraMeta(out, { source: 'live' }), { numberList });
    }
    return await searchArcgis(cfg, term, type, out, { numberList });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[claims]', e?.message);
    return upstreamErrorResponse(res, e, 'Failed to reach the provincial registry.');
  }
}
