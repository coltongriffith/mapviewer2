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
    // CSE_NAME / RCRD_ACRS. GEO_STATE (where the land is) is preferred over
    // ADMIN_STATE (which BLM office administers it — differs near borders).
    stateFields: ['GEO_STATE', 'ADMIN_STATE', 'STATE_GEO', 'ADMIN_ST', 'ADM_ST', 'STATE'],
    nameFields: ['CSE_NAME', 'CLAIM_NAME', 'MC_NAME', 'CASE_NAME', 'NAME'],
    numberFields: ['CSE_NR', 'MLRS_CSE_NR', 'CASE_NR', 'SER_NR', 'SERIAL_NR'],
    // Not published on the current Not Closed layer — kept so legacy search
    // lights up automatically if BLM ever adds it (the OR clause is optional).
    legacyNumberFields: ['LGCY_CSE_NR', 'LEGACY_CASE_NR', 'LGCY_SER_NR'],
    ownerFields: [], // no claimant data in the spatial service (see above)
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

// Module-scope metadata cache (persists across warm invocations)
const metaCache = new Map();

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
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);
  const meta = await fetchJson(`${layerUrl}?f=json`);
  const fields = (meta?.fields || []).map((f) => ({ name: f.name, type: f.type }));
  if (!fields.length) throw new Error('Layer has no queryable fields');
  metaCache.set(cacheKey, fields);
  // Stash the paging-relevant layer capabilities under a sibling key so the
  // pagination code can respect the server's own limits.
  metaCache.set(`layermeta:${layerUrl}`, {
    maxRecordCount: Number(meta?.maxRecordCount) || 1000,
    supportsPagination: Boolean(meta?.advancedQueryCapabilities?.supportsPagination),
    objectIdField: meta?.objectIdField || (meta?.fields || []).find((f) => f.type === 'esriFieldTypeOID')?.name || 'OBJECTID',
  });
  return fields;
}

// Layer paging capabilities; safe defaults when metadata was unreadable.
async function resolveLayerMeta(layerUrl) {
  const key = `layermeta:${layerUrl}`;
  if (!metaCache.has(key)) {
    try { await resolveFields(layerUrl); } catch { /* url-only fallback layers */ }
  }
  return metaCache.get(key) || { maxRecordCount: 1000, supportsPagination: false, objectIdField: 'OBJECTID' };
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
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);
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
      metaCache.set(cacheKey, resolved);
      return resolved;
    }
    if (!fallback) fallback = resolved;
  }
  const best = fallback || urlOnlyFallback;
  if (best) {
    metaCache.set(cacheKey, best);
    return best;
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

function escapeSql(term) {
  return term.replace(/'/g, "''");
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
    const stateVal = pick(cfg.stateFields);

    if (serial != null) out.TAG_NUMBER = String(serial);
    if (legacy != null) out.LEGACY_NR = String(legacy);
    if (name != null) out.CLAIM_NAME = String(name);
    if (typeText != null) out.TITLE_TYPE_DESCRIPTION = String(typeText);
    out.CLAIM_TYPE = normalizeUsClaimType(typeText);
    if (disp != null) out.STATUS = String(disp);
    if (acres != null && Number.isFinite(Number(acres))) {
      out.AREA_IN_HECTARES = Number(acres) / ACRES_PER_HECTARE;
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

// Resolve the per-jurisdiction scoping clause (US: state filter). Returns
// null when the jurisdiction needs no scoping (Canadian provinces), or
// throws a user-facing error when scoping is required but unresolvable —
// returning nationwide results labeled as one state would be worse.
function resolveBaseWhere(cfg, fields) {
  if (!cfg.usState) return null;
  const stateCode = escapeSql(cfg.usState).toUpperCase();
  const stateField = pickField(cfg.stateFields, fields);
  if (stateField && /^[A-Za-z0-9_.]+$/.test(stateField.name)) {
    return `UPPER(${stateField.name}) = '${stateCode}'`;
  }
  // Degraded fallback if the state field ever drifts again: MLRS case serials
  // begin with the two-letter admin state code (e.g. NV105331298), so scope by
  // serial prefix. Slightly imprecise near borders (admin state can differ
  // from geographic state) but far better than a hard failure — and honest:
  // still never returns nationwide results labeled as one state.
  const serialField = pickField(cfg.numberFields, fields);
  if (serialField && /^[A-Za-z0-9_.]+$/.test(serialField.name) && isStringType(serialField)) {
    return `UPPER(${serialField.name}) LIKE '${stateCode}%'`;
  }
  throw new Error('The BLM registry schema changed and state filtering is unavailable. Try again later.');
}

async function searchArcgis(cfg, term, type, res) {
  const { layerUrl, fields } = await resolveLayerAndFields(cfg, type);

  const candidates = type === 'number' ? cfg.numberFields
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
  const safe = escapeSql(effectiveTerm);
  if (isStringType(field)) {
    where = `UPPER(${field.name}) LIKE UPPER('%${safe}%')`;
    // MLRS serial search also matches the legacy case serial when that
    // field exists on the layer (older claims are often known by it).
    if (cfg.provider === 'blm-mlrs' && type === 'number') {
      const legacyField = pickField(cfg.legacyNumberFields, fields);
      if (legacyField && /^[A-Za-z0-9_.]+$/.test(legacyField.name)) {
        where = `(${where} OR UPPER(${legacyField.name}) LIKE UPPER('%${safe}%'))`;
      }
    }
  } else if (/^\d+$/.test(effectiveTerm)) {
    where = `${field.name} = ${effectiveTerm}`;
  } else {
    return res.status(400).json({ error: `${field.name} is numeric — enter digits only.` });
  }

  let baseWhere;
  try {
    baseWhere = resolveBaseWhere(cfg, fields);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
  if (baseWhere) where = `(${where}) AND ${baseWhere}`;

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
    meta,
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

async function searchBc(term, type, res) {
  const safeTerm = term.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
  let cqlFilter;
  if (type === 'number') cqlFilter = `TAG_NUMBER = '${safeTerm}'`;
  else if (type === 'map') cqlFilter = `MAP_UNIT_NO ILIKE '${safeTerm}%'`;
  else cqlFilter = `OWNER_NAME ILIKE '%${safeTerm}%'`;

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
      const { layerUrl, fields } = await resolveLayerAndFields(cfg, cfg.ownerFields?.length ? 'company' : 'number');
      let baseWhere = null;
      try {
        baseWhere = resolveBaseWhere(cfg, fields);
      } catch (e) {
        return res.status(502).json({ error: e.message });
      }
      const { features, meta } = await arcgisQueryAll(layerUrl, {
        ...(baseWhere ? { where: baseWhere } : {}),
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
        meta,
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
        ...(cfg.stateFields ? {
          stateField: pickField(cfg.stateFields, numberResolved.fields)?.name || null,
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
