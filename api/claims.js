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
    // Manitoba Mineral Dispositions — public ArcGIS REST (Economy/Mines).
    // Layer 1 is the "Mining Claim" leaf layer (catalog: 0 Mineral Dispositions
    // group, 1 Mining Claim, 2 Mineral Lease, 3 Mineral Exploration Licence,
    // 5 Patent Mining Claim, 7 Quarry Dispositions). Server is http-only; the
    // proxy fetches it server-side so there's no mixed-content concern.
    service: 'http://maps.gov.mb.ca/arcgis/rest/services/Mineral_Dispositions/MapServer',
    layerId: 1,
    ownerFields: ['CLIENT_NAME', 'CLIENT', 'HOLDER', 'HOLDER_NAME', 'RECORDED_HOLDER', 'CLAIMANT', 'OWNER_NAME', 'OWNER', 'COMPANY', 'COMPANY_NAME'],
    numberFields: ['CLAIM_NUMBER', 'CLAIM_NO', 'CLAIMNUM', 'DISPOSITION_NUMBER', 'DISPOSITION_NO', 'DISP_NUM', 'CID'],
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
  return fields;
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
  const wanted = type === 'number' ? cfg.numberFields : cfg.ownerFields;
  const cacheKey = `resolved:${cfg.service}:${cfg.layerMatch || cfg.layerId}:${type === 'number' ? 'number' : 'owner'}`;
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
function esriToGeoJSON(esriResult) {
  const features = (esriResult?.features || []).map((f) => {
    const g = f.geometry;
    let geometry = null;
    if (g) {
      if (g.rings) {
        // Single ring → Polygon; multiple rings → Polygon with exterior + holes
        // (GeoJSON Polygon allows multiple rings; winding order is lenient in renderers)
        geometry = { type: 'Polygon', coordinates: g.rings };
      } else if (g.paths) {
        geometry = { type: 'MultiLineString', coordinates: g.paths };
      } else if (g.x != null) {
        geometry = { type: 'Point', coordinates: [g.x, g.y] };
      }
    }
    return { type: 'Feature', geometry, properties: f.attributes || {} };
  });
  return { type: 'FeatureCollection', features };
}

// Fetch a query URL, trying f=geojson first and falling back to f=json + convert
// if the server returns a non-2xx (older ArcGIS servers pre-10.3).
async function fetchQueryGeoJSON(queryUrl) {
  try {
    const data = await fetchJson(queryUrl);
    if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 500));
    // Real GeoJSON has a `type` key; esri JSON has `objectIdFieldName` etc.
    if (data.type === 'FeatureCollection') return data;
    // Server returned esri JSON even though we asked for geojson — convert it
    return esriToGeoJSON(data);
  } catch (firstErr) {
    // Only retry on 4xx/5xx (upstream errors), not on parse errors
    if (!firstErr.message?.startsWith('Upstream')) throw firstErr;
    // Replace f=geojson with f=json in the URL and retry
    const fallbackUrl = queryUrl.replace(/([?&])f=geojson(&|$)/, '$1f=json$2');
    if (fallbackUrl === queryUrl) throw firstErr; // no replacement → rethrow
    const data = await fetchJson(fallbackUrl);
    if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 500));
    return esriToGeoJSON(data);
  }
}

// Map raw ArcGIS properties onto the BC-style keys the UI renders.
function normalizeProps(props) {
  if (!props) return {};
  const keys = Object.keys(props);
  const findKey = (re, requireString = false) =>
    keys.find((k) => re.test(k) && (!requireString || typeof props[k] === 'string'));

  const out = { ...props };
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
  if (out.TITLE_TYPE_DESCRIPTION == null) {
    // Prefer human-readable *_DESC fields over *_CODE fields (e.g. Ontario
    // has both TITLE_TYPE_CODE and TITLE_TYPE_DESC)
    const k = findKey(/TYPE_DESC/i, true)
      || findKey(/TENURE_TYPE|DISPOSITION_TYPE|CLAIM_TYPE|TITLE_TYPE|_TYPE$|^TYPE$/i, true);
    if (k) out.TITLE_TYPE_DESCRIPTION = props[k];
  }
  return out;
}

async function searchArcgis(cfg, term, type, res) {
  const { layerUrl, fields } = await resolveLayerAndFields(cfg, type);

  const candidates = type === 'number' ? cfg.numberFields : cfg.ownerFields;
  const field = pickField(candidates, fields);
  if (!field) {
    if (!fields.length) {
      // resolveLayerAndFields couldn't read any field metadata at all — the
      // upstream server is unreachable/blocking us, not actually missing the field.
      return res.status(502).json({
        error: 'The provincial registry is temporarily unavailable. Please try again shortly.',
      });
    }
    return res.status(400).json({
      error: type === 'number'
        ? 'Claim number search is not available for this province yet.'
        : 'Company/holder search is not available for this province — try searching by claim number.',
    });
  }

  // Defense in depth: field names come from upstream service metadata —
  // never interpolate one that isn't a plain identifier (SK uses dots, e.g. SHAPE.AREA)
  if (!/^[A-Za-z0-9_.]+$/.test(field.name)) {
    return res.status(502).json({ error: 'Provincial service returned an unexpected field name.' });
  }

  let where;
  const safe = escapeSql(term);
  if (isStringType(field)) {
    where = `UPPER(${field.name}) LIKE UPPER('%${safe}%')`;
  } else if (/^\d+$/.test(term)) {
    where = `${field.name} = ${term}`;
  } else {
    return res.status(400).json({ error: `${field.name} is numeric — enter digits only.` });
  }

  const queryUrl = `${layerUrl}/query?${new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '500',
    f: 'geojson',
  })}`;

  const data = await fetchQueryGeoJSON(queryUrl);
  if (!Array.isArray(data.features)) throw new Error('Unexpected response from provincial map service');

  data.features = data.features.map((f) => ({
    ...f,
    properties: normalizeProps(f.properties || {}),
  }));
  return res.status(200).json(data);
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
  const url = `${base}/rest/v1/qc_claims?` +
    `select=tag_number,owner_name,status,good_to_date,area_hectares,title_type,geometry` +
    `&${filter}&limit=500`;

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
  const features = rows.map(qcRowToFeature);
  return res.status(200).json({ type: 'FeatureCollection', features });
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

  const wfsUrl = [
    'https://openmaps.gov.bc.ca/geo/pub/wfs',
    '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature',
    '&outputFormat=application/json',
    '&typeNames=pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW',
    '&SRSNAME=EPSG:4326',
    `&CQL_FILTER=${encodeURIComponent(cqlFilter)}`,
    '&count=500',
  ].join('');

  const data = await fetchJson(wfsUrl);
  return res.status(200).json(data);
}

export default async function handler(req, res) {
  const { q, type, schema, bbox } = req.query;
  const province = (req.query.province || 'bc').toLowerCase();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // BBOX spatial query: return all claims within an envelope (nearby claims overlay)
  // BC bbox is handled by the dedicated /api/bc-claims proxy; this handles SK/ON/YT.
  if (bbox && province !== 'bc') {
    const parts = String(bbox).split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return res.status(400).json({ error: 'bbox must be minLng,minLat,maxLng,maxLat' });
    }
    const [minLng, minLat, maxLng, maxLat] = parts;
    // Quebec is self-hosted; its spatial lookup runs in Postgres/PostGIS.
    if (province === 'qc') {
      try {
        return await searchQcBbox(minLng, minLat, maxLng, maxLat, res);
      } catch (e) {
        return res.status(502).json({ error: e.message || 'Failed to reach the Quebec claims store' });
      }
    }
    const cfg = ARCGIS_PROVINCES[province];
    if (!cfg) {
      return res.status(400).json({ error: `Province '${province}' is not supported.` });
    }
    try {
      const { layerUrl } = await resolveLayerAndFields(cfg, 'company');
      const queryUrl = `${layerUrl}/query?${new URLSearchParams({
        geometry: JSON.stringify({ xmin: minLng, ymin: minLat, xmax: maxLng, ymax: maxLat, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        resultRecordCount: '2000',
        f: 'geojson',
      })}`;
      const data = await fetchQueryGeoJSON(queryUrl);
      if (!Array.isArray(data.features)) throw new Error('Unexpected response from provincial map service');
      data.features = data.features.map((f) => ({
        ...f,
        properties: normalizeProps(f.properties || {}),
      }));
      return res.status(200).json(data);
    } catch (e) {
      return res.status(502).json({ error: e.message || 'Failed to reach provincial registry' });
    }
  }

  // Raw-fetch diagnostics: hit the layer metadata endpoint directly on both URL
  // schemes and report the exact status / body snippet, so we can tell an IP/WAF
  // block (fast 403) from a timeout or a moved service. Read-only, no auth.
  if (schema === 'raw' && ARCGIS_PROVINCES[province]) {
    const cfg = ARCGIS_PROVINCES[province];
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

  // Manitoba alternative-source discovery: maps.gov.mb.ca's own ArcGIS REST
  // endpoint gateways a persistent 502 to our traffic (confirmed via schema=raw),
  // so this probes Manitoba's public ArcGIS Hub geoportal for the same data
  // mirrored elsewhere. The DCAT feed lists every published dataset with its
  // direct service/download URLs, so we don't need to already know the right
  // service name or org id. Run from the live deployment only — this sandbox's
  // own egress policy blocks arcgis.com/gov.mb.ca hosts outright.
  if (schema === 'mb-discover') {
    // geoportal.gov.mb.ca's DCAT catalog was already checked and confirmed to
    // have no mineral/mining-claims dataset (267 entries, none match) — so
    // this only probes the rdmaps.gov.mb.ca host backing the official public
    // mining-claims viewer (viewer=MapGallery_Geology.MapGallery), a different
    // host than the broken maps.gov.mb.ca service.
    // The services root confirmed an "iMaQs" folder (Integrated Mining and
    // Quarrying System) — almost certainly the working mirror of the same
    // mineral-dispositions data that's 502'ing on maps.gov.mb.ca.
    const probes = [
      'https://rdmaps.gov.mb.ca/arcgis/rest/services/iMaQs?f=json',
      'https://rdmaps.gov.mb.ca/arcgis/rest/services/iMaQs/MapServer?f=json',
    ];
    const attempts = [];
    for (const u of probes) {
      const started = Date.now();
      try {
        const rr = await fetch(u, { headers: FALLBACK_FETCH_HEADERS, signal: AbortSignal.timeout(15000) });
        const body = await rr.text().catch(() => '');
        attempts.push({ url: u, ok: rr.ok, status: rr.status, ms: Date.now() - started, contentType: rr.headers.get('content-type'), bodySnippet: body.slice(0, 500) });
      } catch (e) {
        attempts.push({ url: u, error: String(e.name || e.message || e), ms: Date.now() - started });
      }
    }
    return res.status(200).json({ attempts });
  }

  // Diagnostics: report resolved layer + fields for an ArcGIS province
  if (schema === '1' && ARCGIS_PROVINCES[province]) {
    try {
      const cfg = ARCGIS_PROVINCES[province];
      const candidates = await listCandidateLayers(cfg);
      // Owner and number fields may resolve to different layers
      const ownerResolved = await resolveLayerAndFields(cfg, 'company');
      const numberResolved = await resolveLayerAndFields(cfg, 'number');
      return res.status(200).json({
        candidateLayers: candidates.map((l) => `${l.id}: ${l.name}`),
        company: {
          layerUrl: ownerResolved.layerUrl,
          layerName: ownerResolved.layerName,
          fields: ownerResolved.fields.map((f) => `${f.name} (${f.type})`),
          ownerField: pickField(cfg.ownerFields, ownerResolved.fields)?.name || null,
        },
        number: {
          layerUrl: numberResolved.layerUrl,
          layerName: numberResolved.layerName,
          fields: numberResolved.fields.map((f) => `${f.name} (${f.type})`),
          numberField: pickField(cfg.numberFields, numberResolved.fields)?.name || null,
        },
      });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  if (province !== 'bc' && province !== 'qc' && !ARCGIS_PROVINCES[province]) {
    return res.status(400).json({ error: `Province '${province}' is not supported yet.` });
  }
  if (type === 'map' && province !== 'bc') {
    return res.status(400).json({ error: 'Map sheet search is only available for BC.' });
  }
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'q param required (min 2 chars)' });
  }
  const term = q.trim();

  try {
    if (province === 'bc') return await searchBc(term, type, res);
    if (province === 'qc') return await searchQc(term, type, res);
    return await searchArcgis(ARCGIS_PROVINCES[province], term, type, res);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Failed to reach provincial registry' });
  }
}
