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
import { applyCors, handleMethods, queryTooLong, validateTerm, validateBbox, rateLimited, diagnosticsAllowed, publicErrorMessage } from './_lib/guard.js';
import { esriGeometryToGeoJSON } from './_lib/esri.js';
import { resolveUsCompanyTiers, matchesCompany } from './_lib/us-aliases.js';

const ARCGIS_PROVINCES = {
  on: {
    service: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/MLAS/mlas_op/MapServer',
    layerMatch: /mining\s*claim/i,
    // Verified post-deploy: layer 1, fields HOLDER + TENURE_NUMBER_ID
    ownerFields: ['HOLDER', 'CLAIM_HOLDER', 'RECORDED_HOLDER', 'HOLDER_NAME', 'OWNER_NAME', 'OWNER', 'CLIENT_NAME'],
    numberFields: ['TENURE_NUMBER_ID', 'CLAIM_NUMBER', 'CLAIMNUM', 'CLAIM_NUM', 'TENURE_NUMBER', 'CLAIM_ID', 'CELL_CLAIM_NUMBER'],
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
// One national ArcGIS FeatureServer, scoped per state with a WHERE filter.
// Source: BLM Mineral & Land Records System "Mining Claims Not Closed" HUB
// service (pre-filtered upstream to not-closed cases, so closed claims can
// never surface as active here). Endpoint overridable via env for schema
// migrations on BLM's side.
//
// Field names are resolved at runtime against the live layer metadata from
// the candidate lists below (the same self-configuring mechanism used for
// ON/SK/MB/NL/YT — see resolveLayerAndFields). Verify post-deploy with the
// gated diagnostics: /api/claims?schema=1&province=us-nv (x-admin-secret).
//
// No claimant/owner search in v1: the BLM spatial service does not publish
// claimant names (those live in separate MLRS reports keyed by serial
// number — a future enrichment). ownerFields stays empty so a company
// search degrades to the standard "not available here" message.
//
// Alaska is deliberately not listed: Alaska has extensive STATE-managed
// mining claims that this federal dataset does not cover, and listing it
// would misrepresent coverage. Any other state is one line to add.
const BLM_MLRS_SERVICE = process.env.BLM_MLRS_SERVICE_URL
  || 'https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer';

const US_STATE_CODES = ['NV', 'AZ', 'UT', 'ID', 'MT', 'WY', 'CO', 'NM', 'CA', 'OR', 'WA'];

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
// OREGON AND WASHINGTON HAVE NO SERIAL FALLBACK, on purpose. A single BLM state
// office (Oregon/Washington, in Portland — blm.gov/office/oregonwashington-state-office)
// administers claims in both states, so an office-derived prefix cannot tell
// Oregon ground from Washington ground: 'WA%' would return nothing and 'ORMC%'
// would return Oregon claims labelled Washington. Those states get a hard error
// instead. A wrong-but-plausible claim set is the worst outcome this product can
// produce, so it is not on the menu.
const US_SERIAL_PREFIXES = {
  NV: { mlrs: 'NV', legacyOffice: 'NMC' },
  AZ: { mlrs: 'AZ', legacyOffice: 'AMC' },
  UT: { mlrs: 'UT', legacyOffice: 'UMC' },
  ID: { mlrs: 'ID', legacyOffice: 'IMC' },
  MT: { mlrs: 'MT', legacyOffice: 'MMC' },
  WY: { mlrs: 'WY', legacyOffice: 'WMC' },
  CO: { mlrs: 'CO', legacyOffice: 'CMC' },
  NM: { mlrs: 'NM', legacyOffice: 'NMMC' },
  CA: { mlrs: 'CA', legacyOffice: 'CAMC' },
  OR: null,  // shared OR/WA state office — see comment above
  WA: null,
};

const US_JURISDICTIONS = Object.fromEntries(US_STATE_CODES.map((code) => [
  `us-${code.toLowerCase()}`,
  {
    service: BLM_MLRS_SERVICE,
    layerId: 0,
    provider: 'blm-mlrs',
    usState: code,
    // Candidate field names, resolved against live metadata at runtime.
    // First names verified against the live layer's documented schema
    // (July 2026): GEO_STATE / ADMIN_STATE / CSE_DISP / BLM_PROD / CSE_NR /
    // CSE_NAME / RCRD_ACRS.
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

async function fetchJson(url) {
  // Try the URL as given, then (only if it fails outright) with the opposite
  // protocol. Some provincial gov ArcGIS hosts answer on https even when http is
  // the documented endpoint — notably maps.gov.mb.ca — and a few WAFs block one
  // scheme but not the other, so this recovers Manitoba without affecting hosts
  // that already work on the first try.
  const variants = [url];
  if (/^http:\/\//i.test(url)) variants.push(url.replace(/^http:/i, 'https:'));
  else if (/^https:\/\//i.test(url)) variants.push(url.replace(/^https:/i, 'http:'));

  let lastErr;
  for (const u of variants) {
    try {
      return await fetchJsonOnce(u);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function fetchJsonOnce(url) {
  // Transient gateway errors (502/503/504) are common on older provincial
  // ArcGIS stacks — notably maps.gov.mb.ca, whose front-end reverse proxy
  // intermittently returns "502 invalid response while acting as a gateway"
  // when its backend is busy. Retry a couple of times with backoff before
  // giving up so a flaky upstream doesn't surface as a hard failure.
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    r = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20000) });
    if (r.ok) return r.json();

    let body = await r.text().catch(() => '');
    // Some provincial WAFs block our bot UA outright (403/406) regardless of
    // whether the block page is HTML or a bare error status — retry once with
    // a generic browser identity before surfacing anything as unavailable.
    const looksBlocked = looksLikeHtml(body, r.headers.get('content-type')) || r.status === 403 || r.status === 406;
    if (looksBlocked) {
      const retry = await fetch(url, { headers: FALLBACK_FETCH_HEADERS, signal: AbortSignal.timeout(20000) }).catch(() => null);
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
async function arcgisQueryAll(layerUrl, baseParams) {
  const layerMeta = await resolveLayerMeta(layerUrl);
  const pageSize = Math.min(Math.max(layerMeta.maxRecordCount, 1), 1000);
  const idField = layerMeta.objectIdField;

  if (layerMeta.supportsPagination) {
    return fetchAllPages({
      provider: 'arcgis',
      pageSize,
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
    const oidField = idResp.objectIdFieldName || idField;
    const capped = ids.slice(0, MAX_TOTAL_FEATURES);
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
    const url = `${layerUrl}/query?${new URLSearchParams({ ...baseParams, resultRecordCount: '2000', f: 'geojson' })}`;
    const data = await fetchQueryGeoJSON(url);
    if (!Array.isArray(data.features)) throw new Error('Unexpected response from provincial map service');
    return {
      features: data.features,
      meta: { totalKnown: null, returned: data.features.length, truncated: data.features.length >= 2000, pagesFetched: 1, provider: 'arcgis' },
    };
  }
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
    } catch {
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
function likeClause(fieldName, rawTerm, { prefix = false } = {}) {
  const raw = String(rawTerm);
  const escaped = raw.replace(/[\\%_]/g, '\\$&');
  const body = escapeSql(escaped);
  const pattern = prefix ? `${body}%` : `%${body}%`;
  return `UPPER(${fieldName}) LIKE UPPER('${pattern}')${escaped === raw ? '' : " ESCAPE '\\'"}`;
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
async function fetchQueryGeoJSONOnce(queryUrl) {
  try {
    const data = await fetchJson(queryUrl);
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
    const data = await fetchJson(fallbackUrl);
    if (data.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error).slice(0, 480)}`);
    return esriToGeoJSON(data);
  }
}

// SDE-backed ArcGIS servers (BLM's national layer especially) intermittently
// return HTTP 200 with an in-body {error} on expensive scans; a single retry
// after a short pause recovers most of them, so one flaky page doesn't fail
// the whole search.
async function fetchQueryGeoJSON(queryUrl) {
  try {
    return await fetchQueryGeoJSONOnce(queryUrl);
  } catch (e) {
    if (!/^ArcGIS error/.test(e?.message || '')) throw e;
    await sleep(700);
    return fetchQueryGeoJSONOnce(queryUrl);
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
    const typeText = pick(['BLM_PROD', 'CSE_TYPE_TXT', 'CASETYPE_TXT', 'CSE_TYPE', 'CASE_TYPE', 'CASE_TYPE_TXT']);
    const disp = pick(['CSE_DISP', 'CSE_DISP_TXT', 'DISP_TXT', 'CASE_DISP', 'DISPOSITION']);
    const acres = pick(['RCRD_ACRS', 'ACRES', 'RECORD_ACRES', 'RCRD_ACRES']);
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
// Both degraded modes are surfaced to the user rather than silently applied.
function resolveUsScoping(cfg, fields) {
  if (!cfg.usState) return null;
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
  if (prefixes) {
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
  throw new Error('The BLM registry schema changed and state filtering is unavailable. Try again later.');
}

// Attach the scoping declaration to a response's meta. Canadian provinces pass
// scoping=null and their meta is left exactly as it was.
function withScopingMeta(meta, scoping) {
  if (!scoping) return meta;
  return {
    ...meta,
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
        let where = `UPPER(${serialField.name}) IN (${chunk})`;
        if (scoping) where = `(${where}) AND ${scoping.where}`;
        const { features, meta } = await arcgisQueryAll(layerUrl, {
          where, outFields: '*', returnGeometry: 'true', outSR: '4326',
        });
        for (const f of features) all.push(f);
        metaAcc = metaAcc
          ? { ...meta, returned: all.length, truncated: metaAcc.truncated || meta.truncated, pagesFetched: (metaAcc.pagesFetched || 0) + (meta.pagesFetched || 0) }
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
    const clauses = tier.terms.map((t) => likeClause(field.name, t));
    if (!clauses.length) continue;
    let where = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
    if (scoping) where = `(${where}) AND ${scoping.where}`;
    attempted.push({ method: tier.method, terms: tier.terms.length });

    const { features, meta } = await arcgisQueryAll(layerUrl, {
      where,
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
    });

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

async function searchArcgis(cfg, term, type, res) {
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

  let where;

  if (type === 'number') {
    // OR across every identifier column on the layer. A string column takes a
    // substring LIKE; a numeric one can only take equality, so it contributes a
    // clause only when the term is all digits.
    //
    // The clause list can therefore come out shorter than the field list — a
    // tag like "CB12345" against a numeric TENURE_NUMBER_ID has no valid
    // comparison. That used to be a hard 400 telling the user to "enter digits
    // only", even when a perfectly good string column sat right beside it.
    const numberFields = pickFields(candidates, fields)
      .filter((f) => /^[A-Za-z0-9_.]+$/.test(f.name));
    const clauses = [];
    for (const f of numberFields) {
      if (isStringType(f)) clauses.push(likeClause(f.name, effectiveTerm));
      else if (/^\d+$/.test(effectiveTerm)) clauses.push(`${f.name} = ${effectiveTerm}`);
    }
    if (!clauses.length) {
      // Every identifier on this layer is numeric and the term is not.
      return res.status(400).json({
        error: `${numberFields.map((f) => f.name).join(' and ')} `
          + `${numberFields.length > 1 ? 'are' : 'is'} numeric — enter digits only.`,
      });
    }
    where = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
  } else if (isStringType(field)) {
    // Same tokenised match as B.C.: every meaningful word must appear, in any
    // order. A holder recorded as "EAGLE PLAINS RESOURCES LTD." is found by
    // "Eagle Plains Resources Ltd", "eagle plains" or "Resources Eagle Plains".
    const tokens = type === 'number' ? [] : ownerSearchTokens(effectiveTerm);
    where = tokens.length > 1
      ? `(${tokens.map((t) => likeClause(field.name, t)).join(' AND ')})`
      : likeClause(field.name, tokens[0] ?? effectiveTerm);
  } else if (/^\d+$/.test(effectiveTerm)) {
    where = `${field.name} = ${effectiveTerm}`;
  } else {
    return res.status(400).json({ error: `${field.name} is numeric — enter digits only.` });
  }

  if (scoping) where = `(${where}) AND ${scoping.where}`;

  const { features, meta } = await arcgisQueryAll(layerUrl, {
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
  });
  if (cfg.provider) meta.provider = cfg.provider;

  return res.status(200).json({
    type: 'FeatureCollection',
    features: features.map((f) => ({ ...f, properties: normalizeProps(f.properties || {}, cfg) })),
    meta: withScopingMeta(meta, scoping),
  });
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
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
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

async function searchQc(term, type, res) {
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

  const filter = type === 'number'
    ? `tag_number=ilike.${encodeURIComponent(cleaned)}`
    : `owner_name=ilike.${encodeURIComponent(`*${cleaned}*`)}`;

  const { features, meta } = await fetchAllPages({
    provider: 'qc-store',
    pageSize: 1000,
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
  return res.status(200).json({ type: 'FeatureCollection', features, meta });
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
 * @param {'number'|'map'|'company'} type
 * @returns {string} a CQL_FILTER expression
 */
export function bcCqlFilter(term, type) {
  const safeTerm = String(term).replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');

  if (type === 'number') {
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
    return /^\d+$/.test(term)
      ? `(TENURE_NUMBER_ID = ${term} OR TAG_NUMBER = '${safeTerm}')`
      : `TAG_NUMBER = '${safeTerm}'`;
  }
  if (type === 'map') return `MAP_UNIT_NO ILIKE '${safeTerm}%'`;

  // Owner search requires every meaningful word, in any order, rather than one
  // contiguous string — see ownerSearchTokens for why (every full-legal-name
  // search on the live site returned nothing).
  const tokens = ownerSearchTokens(term);
  const clauses = tokens.map((t) => {
    const safe = t.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
    return `OWNER_NAME ILIKE '%${safe}%'`;
  });
  if (!clauses.length) return `OWNER_NAME ILIKE '%${safeTerm}%'`;
  return clauses.length > 1 ? `(${clauses.join(' AND ')})` : clauses[0];
}

async function searchBc(term, type, res) {
  const cqlFilter = bcCqlFilter(term, type);

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

  const { features, meta } = await fetchWfsAll({ fetchJson, buildUrl, pageSize: 1000, provider: 'bc-wfs' });
  return res.status(200).json({ type: 'FeatureCollection', features, meta });
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['GET'])) return;
  if (queryTooLong(req)) return res.status(414).json({ error: 'query string too long' });
  if (rateLimited(req, { max: 60, windowMs: 60_000, bucket: 'claims' })) {
    return res.status(429).json({ error: 'rate limited — slow down and try again' });
  }

  const { q, type, schema, bbox } = req.query;
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
      const { features, meta } = await arcgisQueryAll(layerUrl, {
        ...(scoping ? { where: scoping.where } : {}),
        geometry: JSON.stringify({ xmin: minLng, ymin: minLat, xmax: maxLng, ymax: maxLat, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
      });
      return res.status(200).json({
        type: 'FeatureCollection',
        features: features.map((f) => ({ ...f, properties: normalizeProps(f.properties || {}, cfg) })),
        // The nearby-claims overlay is a claim set like any other — it declares
        // its scoping too, so a degraded scope can't slip onto the map here.
        meta: withScopingMeta(meta, scoping),
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
        const rr = await fetch(u, { headers: FALLBACK_FETCH_HEADERS, signal: AbortSignal.timeout(15000) });
        const body = await rr.text().catch(() => '');
        attempts.push({ url: u, ok: rr.ok, status: rr.status, ms: Date.now() - started, contentType: rr.headers.get('content-type'), bodySnippet: body.slice(0, 300) });
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
          scoping: (() => {
            try {
              const s = resolveUsScoping(cfg, numberResolved.fields);
              return { method: s.method, field: s.field, degraded: s.degraded, where: s.where };
            } catch (e) {
              return { method: null, error: e.message };
            }
          })(),
          geoStateField: pickField(cfg.geoStateFields || [], numberResolved.fields)?.name || null,
          adminStateField: pickField(cfg.adminStateFields || [], numberResolved.fields)?.name || null,
          recordDateField: pickField(cfg.recordDateFields || [], numberResolved.fields)?.name || null,
        } : {}),
      });
    } catch (e) {
      return res.status(502).json({ error: publicErrorMessage(e, 'Diagnostics failed.') });
    }
  }

  if (province !== 'bc' && province !== 'qc' && !getArcgisJurisdiction(province)) {
    return res.status(400).json({ error: `Jurisdiction '${province}' is not supported yet.` });
  }
  if (type === 'map' && province !== 'bc') {
    return res.status(400).json({ error: 'Map sheet search is only available for BC.' });
  }
  if (type === 'name' && !getArcgisJurisdiction(province)?.nameFields?.length) {
    return res.status(400).json({ error: 'Claim-name search is not available for this jurisdiction.' });
  }
  const checkedTerm = validateTerm(q);
  if (!checkedTerm.ok) return res.status(400).json({ error: checkedTerm.error });
  const term = checkedTerm.term;

  try {
    if (province === 'bc') return await searchBc(term, type, res);
    if (province === 'qc') return await searchQc(term, type, res);
    return await searchArcgis(getArcgisJurisdiction(province), term, type, res);
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[claims]', e?.message);
    return upstreamErrorResponse(res, e, 'Failed to reach the provincial registry.');
  }
}
