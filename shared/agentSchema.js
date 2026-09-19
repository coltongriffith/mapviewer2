import { MAP_TYPES } from './projectState.js';

export const AGENT_API_VERSION = '1.0.0';

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

function normalizeInclude(value) {
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

  if (!query && !normalizedBbox && !data) {
    errors.push('Provide search.query, location.bbox, or data.geojson.');
  }

  const include = normalizeInclude(body.include);
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
      include,
      style,
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
  };
}
