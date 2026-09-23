import { MAP_TYPES } from './projectState.js';

export const AGENT_API_VERSION = '1.1.0';

export const AGENT_JURISDICTIONS = Object.freeze({
  bc: { label: 'British Columbia', country: 'CA', registry: 'BC Mineral Titles' },
  on: { label: 'Ontario', country: 'CA', registry: 'Ontario Mining Lands' },
  qc: { label: 'Quebec', country: 'CA', registry: 'GESTIM / ExplorationMaps mirror' },
  sk: { label: 'Saskatchewan', country: 'CA', registry: 'Saskatchewan mineral dispositions' },
  mb: { label: 'Manitoba', country: 'CA', registry: 'Manitoba mineral dispositions' },
  nl: { label: 'Newfoundland & Labrador', country: 'CA', registry: 'Newfoundland & Labrador mineral rights' },
  yt: { label: 'Yukon', country: 'CA', registry: 'Yukon mineral claims' },
  'us-nv': { label: 'Nevada', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-az': { label: 'Arizona', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-ut': { label: 'Utah', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-id': { label: 'Idaho', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-mt': { label: 'Montana', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-wy': { label: 'Wyoming', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-co': { label: 'Colorado', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-nm': { label: 'New Mexico', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-ca': { label: 'California', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-or': { label: 'Oregon', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
  'us-wa': { label: 'Washington', country: 'US', registry: 'BLM MLRS', caveat: 'Federal claims only; boundaries are not legal surveys.' },
});

export const AGENT_OVERLAYS = Object.freeze({
  roads: 'context',
  settlements: 'context',
  labels: 'labels',
  rail: 'rail',
  geology: 'geology',
});

export const AGENT_SEARCH_TYPES = Object.freeze(['company', 'number', 'name']);
export const AGENT_DATA_ROLES = Object.freeze(['claims', 'drillholes', 'target_areas', 'anomalies', 'faults_structures', 'roads_access', 'rivers_water', 'labels']);
export const AGENT_MAP_TYPES = Object.freeze(Object.keys(MAP_TYPES));
export const AGENT_STYLES = Object.freeze(['investor_clean', 'technical_sharp', 'modern_dark', 'warm_terrain', 'ni_43101']);
export const AGENT_BASEMAPS = Object.freeze(['white', 'light_grey', 'dark', 'terrain', 'topo', 'satellite', 'satellite_hybrid', 'hillshade', 'geology']);

const MAX_TITLE = 160;
const MAX_QUERY = 120;
const MAX_INCLUDE = 8;

function cleanString(value, max) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

// Facts and callout text come straight from the model and are stored in the
// shared map, then rendered verbatim — keep only the documented keys, as
// clipped strings or finite numbers.
function cleanFactsPanel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const facts = {};
  for (const key of ['project', 'commodity', 'ownership', 'access']) {
    const text = cleanString(value[key], 200);
    if (text) facts[key] = text;
  }
  if (Number.isInteger(value.claims) && value.claims >= 0) facts.claims = value.claims;
  if (Number.isFinite(value.hectares) && value.hectares >= 0) facts.hectares = value.hectares;
  if (Array.isArray(value.tickers)) {
    const tickers = value.tickers.map((ticker) => cleanString(ticker, 40)).filter(Boolean).slice(0, 6);
    if (tickers.length) facts.tickers = tickers;
  }
  return Object.keys(facts).length ? facts : null;
}

function cleanClaimsCallout(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { show: true };
  const fields = {};
  if (value.fields && typeof value.fields === 'object' && !Array.isArray(value.fields)) {
    for (const [key, text] of Object.entries(value.fields).slice(0, 12)) {
      const cleaned = cleanString(typeof text === 'number' ? String(text) : text, 200);
      if (cleaned) fields[String(key).slice(0, 40)] = cleaned;
    }
  }
  return {
    show: value.show !== false,
    fields,
    source_note: cleanString(value.source_note, 200),
    style: ['brand', 'technical', 'minimal'].includes(value.style) ? value.style : 'brand',
  };
}

function normalizeInclude(value) {
  if (value === 'all') return ['claims', ...Object.keys(AGENT_OVERLAYS)];
  if (!Array.isArray(value)) return ['claims', 'roads', 'settlements'];
  const allowed = new Set(['claims', ...Object.keys(AGENT_OVERLAYS)]);
  return [...new Set(value.filter((v) => typeof v === 'string' && allowed.has(v)))].slice(0, MAX_INCLUDE);
}

export function validateCreateMapInput(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['Request body must be a JSON object.'] };
  }

  const mapType = cleanString(body.map_type, 40) || 'claims';
  if (!AGENT_MAP_TYPES.includes(mapType)) errors.push(`Unsupported map_type '${mapType}'.`);

  const jurisdiction = cleanString(body.jurisdiction, 20)?.toLowerCase() || 'bc';
  if (!AGENT_JURISDICTIONS[jurisdiction]) errors.push(`Unsupported jurisdiction '${jurisdiction}'.`);

  const style = cleanString(body.style, 40) || MAP_TYPES[mapType]?.themeId || 'investor_clean';
  if (!AGENT_STYLES.includes(style)) errors.push(`Unsupported style '${style}'.`);

  const search = body.search && typeof body.search === 'object' ? body.search : {};
  const searchType = cleanString(search.type, 20) || 'company';
  if (!AGENT_SEARCH_TYPES.includes(searchType)) errors.push(`Unsupported search.type '${searchType}'.`);
  const query = cleanString(search.query, MAX_QUERY);

  const bbox = body.location?.bbox;
  let normalizedBbox = null;
  if (bbox != null) {
    if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => !Number.isFinite(Number(n)))) {
      errors.push('location.bbox must be [minLng,minLat,maxLng,maxLat].');
    } else {
      normalizedBbox = bbox.map(Number);
      const [minLng, minLat, maxLng, maxLat] = normalizedBbox;
      if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) {
        errors.push('location.bbox is outside valid coordinate bounds.');
      }
    }
  }

  const rawData = body.data && typeof body.data === 'object' ? body.data : null;
  let data = null;
  if (rawData?.geojson != null) {
    const geojson = rawData.geojson;
    const features = geojson?.type === 'FeatureCollection' && Array.isArray(geojson.features)
      ? geojson.features
      : null;
    if (!features) {
      errors.push('data.geojson must be a GeoJSON FeatureCollection.');
    } else if (features.length < 1) {
      errors.push('data.geojson must contain at least one feature.');
    } else if (features.length > 5000) {
      errors.push('data.geojson may contain at most 5000 features.');
    } else if (features.some((feature) => !feature || feature.type !== 'Feature' || !feature.geometry?.type)) {
      errors.push('Every data.geojson feature must contain a geometry.');
    } else {
      const requestedRole = cleanString(rawData.role, 40);
      if (requestedRole && !AGENT_DATA_ROLES.includes(requestedRole)) {
        errors.push(`Unsupported data.role '${requestedRole}'.`);
      }
      data = {
        geojson,
        role: requestedRole || null,
        source_name: cleanString(rawData.source_name, 160),
      };
    }
  }

  const claimNumbers = Array.isArray(body.claim_numbers)
    ? [...new Set(body.claim_numbers.filter((value) => typeof value === 'string' && /^[A-Za-z0-9.-]{1,40}$/.test(value.trim())).map((value) => value.trim()))].slice(0, 40)
    : [];
  if (body.claim_numbers != null && (!Array.isArray(body.claim_numbers) || claimNumbers.length !== body.claim_numbers.length || claimNumbers.length === 0)) {
    errors.push('claim_numbers must contain 1–40 unique claim identifiers.');
  }
  if (!query && !normalizedBbox && !data && !claimNumbers.length) {
    errors.push('Provide search.query, location.bbox, claim_numbers, or data.geojson.');
  }

  const include = normalizeInclude(body.include);
  const defaultBasemap = mapType === 'investor' ? 'satellite' : mapType === 'infrastructure' ? 'terrain' : 'white';
  const basemap = cleanString(body.basemap, 40) || defaultBasemap;
  if (!AGENT_BASEMAPS.includes(basemap)) errors.push(`Unsupported basemap '${basemap}'.`);
  // The default and 'all' fit the overlays to the basemap. Roads/settlements is
  // an opaque street map drawn over the basemap, so it would wash out imagery,
  // relief, topo or a dark canvas; geology would hide satellite imagery. An
  // explicit list is honoured as given.
  if (body.include == null || body.include === 'all') {
    const drop = new Set(basemap.startsWith('satellite') ? ['geology'] : []);
    if (!['white', 'light_grey'].includes(basemap)) { drop.add('roads'); drop.add('settlements'); }
    for (let i = include.length - 1; i >= 0; i--) if (drop.has(include[i])) include.splice(i, 1);
  }
  const insetBasemap = cleanString(body.inset?.basemap, 40) || basemap;
  if (!AGENT_BASEMAPS.includes(insetBasemap)) errors.push(`Unsupported inset.basemap '${insetBasemap}'.`);
  const opacity = body.basemap_opacity == null ? 1 : Number(body.basemap_opacity);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) errors.push('basemap_opacity must be between 0 and 1.');
  const validHex = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  const rawBranding = body.branding || {};
  for (const key of ['primary_color', 'accent_color']) {
    if (rawBranding[key] != null && !validHex(rawBranding[key])) errors.push(`branding.${key} must be a six-digit hex colour.`);
  }
  for (const key of ['website', 'logo_url', 'logo_url_dark']) {
    if (rawBranding[key] != null && (typeof rawBranding[key] !== 'string' || !/^https:\/\//i.test(rawBranding[key]))) errors.push(`branding.${key} must be an HTTPS URL.`);
  }
  const annotations = Array.isArray(body.annotations) ? body.annotations.slice(0, 30) : [];
  if (body.annotations != null && (!Array.isArray(body.annotations) || body.annotations.length > 30 || annotations.some((item) =>
    !item || typeof item.label !== 'string' || !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lng)) || Math.abs(Number(item.lat)) > 90 || Math.abs(Number(item.lng)) > 180))) {
    errors.push('annotations must contain at most 30 labelled latitude/longitude points.');
  }
  const title = cleanString(body.title, MAX_TITLE) || (query ? `${query} Project Map` : 'Exploration Project Map');
  const subtitle = cleanString(body.subtitle, MAX_TITLE);
  const companyName = cleanString(body.company?.name, MAX_TITLE);

  return {
    ok: errors.length === 0,
    errors,
    value: {
      map_type: mapType,
      title,
      subtitle,
      jurisdiction,
      search: { type: searchType, query },
      location: { bbox: normalizedBbox },
      claim_numbers: claimNumbers,
      include,
      style,
      basemap,
      basemap_opacity: opacity,
      inset: { show: body.inset?.show !== false, basemap: insetBasemap },
      neighbours: { show: body.neighbours?.show !== false, label_holders: body.neighbours?.label_holders !== false, max_holders: Number.isFinite(Number(body.neighbours?.max_holders)) ? Math.max(0, Math.min(8, Math.trunc(Number(body.neighbours.max_holders)))) : 8 },
      branding: {
        website: cleanString(rawBranding.website, 500),
        logo_url: cleanString(rawBranding.logo_url, 500),
        logo_url_dark: cleanString(rawBranding.logo_url_dark, 500),
        primary_color: validHex(rawBranding.primary_color) ? rawBranding.primary_color : null,
        accent_color: validHex(rawBranding.accent_color) ? rawBranding.accent_color : null,
        font: cleanString(rawBranding.font, 80),
      },
      facts_panel: cleanFactsPanel(body.facts_panel),
      claims_callout: cleanClaimsCallout(body.claims_callout),
      annotations: annotations.map((item) => ({ type: cleanString(item.type, 40) || 'target', label: cleanString(item.label, 100), lat: Number(item.lat), lng: Number(item.lng) })),
      company: { name: companyName },
      data,
    },
  };
}

export function capabilities() {
  return {
    api_version: AGENT_API_VERSION,
    product: 'ExplorationMaps',
    description: 'Create professional mineral exploration, mining claim, mineral tenure, drill-results, infrastructure, investor-presentation and technical project maps.',
    map_types: AGENT_MAP_TYPES.map((id) => ({ id, ...MAP_TYPES[id] })),
    jurisdictions: Object.entries(AGENT_JURISDICTIONS).map(([id, value]) => ({ id, ...value })),
    overlays: Object.keys(AGENT_OVERLAYS),
    search_types: AGENT_SEARCH_TYPES,
    data_roles: AGENT_DATA_ROLES,
    styles: AGENT_STYLES,
    basemaps: AGENT_BASEMAPS,
    anonymous_mcp_preview: { map_types: ['claims', 'investor', 'infrastructure'], styles: ['investor_clean', 'technical_sharp', 'modern_dark', 'warm_terrain'], note: 'Drill and NI 43-101 templates require user-supplied data and review in the editor.' },
  };
}
