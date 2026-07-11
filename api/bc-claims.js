import { fetchWfsAll } from './_lib/paging.js';
import { applyCors, handleMethods, queryTooLong, validateTerm, validateBbox, rateLimited, diagnosticsAllowed, publicErrorMessage } from './_lib/guard.js';

// BC DataBC GeoServer WFS proxy (mineral tenures). Used by the frontend as
// the nearby-claims bbox source and legacy search fallback. Results are
// paginated (WFS 2.0 startIndex/count) up to the shared safety ceiling and
// carry honest completeness metadata instead of a silent 500/2000-row cap.

const WFS_BASE = 'https://openmaps.gov.bc.ca/geo/pub/wfs';
const LAYER = 'pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW';

const FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; ExplorationMaps/1.0; +https://explorationmaps.com)',
  Referer: 'https://explorationmaps.com/',
  Origin: 'https://explorationmaps.com',
};

async function fetchJson(url) {
  const r = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    // Upstream bodies are OWS exception reports / WAF pages — never forward
    // them to the client; log server-side outside production instead.
    if (process.env.NODE_ENV !== 'production') console.warn('[bc-claims] upstream', r.status, body.slice(0, 500));
    throw new Error(`The BC registry returned an error (${r.status}). Try again shortly.`);
  }
  return r.json();
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['GET'])) return;
  if (queryTooLong(req)) return res.status(414).json({ error: 'query string too long' });
  if (rateLimited(req, { max: 60, windowMs: 60_000, bucket: 'bc-claims' })) {
    return res.status(429).json({ error: 'rate limited — slow down and try again' });
  }

  const { q, company, type, schema, bbox } = req.query;
  // Accept either `q` (new) or `company` (legacy) as the search term
  const term = q || company;

  // BBOX mode: fetch all tenures within a lng/lat bounding box (nearby claims overlay)
  if (bbox) {
    const checked = validateBbox(bbox);
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const [minLng, minLat, maxLng, maxLat] = checked.bbox;
    try {
      const buildUrl = (startIndex, count) => [
        WFS_BASE,
        '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature',
        '&outputFormat=application/json',
        `&typeNames=${LAYER}`,
        '&SRSNAME=EPSG:4326',
        `&BBOX=${minLng},${minLat},${maxLng},${maxLat},EPSG:4326`,
        '&sortBy=TENURE_NUMBER_ID',
        `&count=${count}`,
        `&startIndex=${startIndex}`,
      ].join('');
      const { features, meta } = await fetchWfsAll({ fetchJson, buildUrl, pageSize: 2000, provider: 'bc-wfs' });
      return res.status(200).json({ type: 'FeatureCollection', features, meta });
    } catch (e) {
      return res.status(502).json({ error: publicErrorMessage(e, 'Failed to reach the BC registry.') });
    }
  }

  // Schema discovery mode: return field names from a sample feature
  if (schema === '1') {
    if (!diagnosticsAllowed(req)) return res.status(404).json({ error: 'not found' });
    try {
      const data = await fetchJson([
        WFS_BASE,
        '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature',
        '&outputFormat=application/json',
        `&typeNames=${LAYER}`,
        '&count=1',
      ].join(''));
      const fields = Object.keys(data?.features?.[0]?.properties || {});
      return res.status(200).json({ fields, sample: data?.features?.[0]?.properties });
    } catch (e) {
      return res.status(502).json({ error: publicErrorMessage(e, 'Diagnostics failed.') });
    }
  }

  const checkedTerm = validateTerm(term);
  if (!checkedTerm.ok) return res.status(400).json({ error: checkedTerm.error });

  const safeTerm = checkedTerm.term.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');

  let cqlFilter;
  if (type === 'number') {
    cqlFilter = `TAG_NUMBER = '${safeTerm}'`;
  } else if (type === 'map') {
    cqlFilter = `MAP_UNIT_NO ILIKE '${safeTerm}%'`;
  } else {
    cqlFilter = `OWNER_NAME ILIKE '%${safeTerm}%'`;
  }

  try {
    const buildUrl = (startIndex, count) => [
      WFS_BASE,
      '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature',
      '&outputFormat=application/json',
      `&typeNames=${LAYER}`,
      '&SRSNAME=EPSG:4326',
      `&CQL_FILTER=${encodeURIComponent(cqlFilter)}`,
      '&sortBy=TENURE_NUMBER_ID',
      `&count=${count}`,
      `&startIndex=${startIndex}`,
    ].join('');
    const { features, meta } = await fetchWfsAll({ fetchJson, buildUrl, pageSize: 1000, provider: 'bc-wfs' });
    return res.status(200).json({ type: 'FeatureCollection', features, meta });
  } catch (e) {
    return res.status(502).json({ error: publicErrorMessage(e, 'Failed to reach the BC registry.') });
  }
}
