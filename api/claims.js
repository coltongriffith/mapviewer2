// Multi-province Canadian mineral claims search proxy.
//
// Live-searchable provinces (public spatial APIs with attribute queries):
//   bc — BC WFS (openmaps.gov.bc.ca), WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW
//   on — Ontario MLAS operational map service (LIO ArcGIS REST)
//   sk — Saskatchewan Mineral Dispositions (gis.saskatchewan.ca ArcGIS REST)
//   yt — Yukon quartz claims (GeoYukon GY_Mining ArcGIS REST)
//
// Not supported (no free public queryable API as of 2026):
//   qc — GESTIM is login-gated; SIGÉOM exposes WMS images only, titres miniers
//        are bulk downloads with no attribute-query endpoint
//   ab — crown mineral agreements distributed via AltaLIS under license
//   mb — iMaQs viewer only; GIS data is download-only
//   ns — NovaROC viewer; mineral titles are download-only
//   nb — GeoNB has no documented public mineral claims query service
//   nl — Mineral Lands GeoAtlas viewer only
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

// Module-scope metadata cache (persists across warm invocations)
const metaCache = new Map();

async function fetchJson(url) {
  const r = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20000) });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Upstream ${r.status}: ${body.slice(0, 500)}`);
  }
  return r.json();
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
  let fallback = null;
  for (const layer of candidates.slice(0, 6)) {
    const layerUrl = `${cfg.service}/${layer.id}`;
    let fields;
    try { fields = await resolveFields(layerUrl); } catch { continue; }
    const resolved = { layerUrl, layerName: layer.name, fields };
    if (pickField(wanted, fields)) {
      metaCache.set(cacheKey, resolved);
      return resolved;
    }
    if (!fallback) fallback = resolved;
  }
  if (fallback) {
    metaCache.set(cacheKey, fallback);
    return fallback;
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

// Map raw ArcGIS properties onto the BC-style keys the UI renders.
function normalizeProps(props) {
  const keys = Object.keys(props);
  const findKey = (re, requireString = false) =>
    keys.find((k) => re.test(k) && (!requireString || typeof props[k] === 'string'));

  const out = { ...props };
  if (out.OWNER_NAME == null) {
    const k = findKey(/OWNER|HOLDER|CLIENT/i, true);
    if (k) out.OWNER_NAME = props[k];
  }
  if (out.TAG_NUMBER == null) {
    // DISPOSIT_1 is Saskatchewan's string disposition number (truncated name)
    const k = findKey(/TAG_NUMBER|GRANT_NUM|DISPOSITION_NUM|CLAIM_NUM|TENURE_NUM|DISPOSIT_1/i)
      || findKey(/NUMBER|DISPOSIT/i);
    if (k) out.TAG_NUMBER = props[k];
  }
  if (out.AREA_IN_HECTARES == null) {
    const k = findKey(/HECTARE|AREA_HA|_HA$/i);
    if (k && Number.isFinite(Number(props[k]))) out.AREA_IN_HECTARES = Number(props[k]);
  }
  if (out.GOOD_TO_DATE == null) {
    // GOODSTANDI is Saskatchewan's good-standing date (truncated name)
    const k = findKey(/GOOD_TO|GOODSTAND|EXPIR|END_DATE|ANNIVERS/i);
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
    return res.status(400).json({
      error: type === 'number'
        ? 'Claim number search is not available for this province yet.'
        : 'Company/holder search is not available for this province — try searching by claim number.',
    });
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

  const data = await fetchJson(queryUrl);
  if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 500));
  if (!Array.isArray(data.features)) throw new Error('Unexpected response from provincial map service');

  data.features = data.features.map((f) => ({
    ...f,
    properties: normalizeProps(f.properties || {}),
  }));
  return res.status(200).json(data);
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
  const { q, type, schema } = req.query;
  const province = (req.query.province || 'bc').toLowerCase();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

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

  if (province !== 'bc' && !ARCGIS_PROVINCES[province]) {
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
    return await searchArcgis(ARCGIS_PROVINCES[province], term, type, res);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Failed to reach provincial registry' });
  }
}
