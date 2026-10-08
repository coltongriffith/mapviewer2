import { claimIdentifiers, claimCentroid } from '../../shared/claimData.js';

function dedupe(features) {
  const seen = new Set();
  return features.filter((feature) => {
    const key = claimIdentifiers(feature)[0] || feature?.id;
    if (key == null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Registry records carry many empty fields and 15-digit coordinates. Neither
// shows on a map, and both count against the share limit.
function roundCoordinates(value) {
  if (!Array.isArray(value)) return value;
  return typeof value[0] === 'number' ? value.map((n) => Math.round(n * 1e6) / 1e6) : value.map(roundCoordinates);
}

function compact(feature) {
  const properties = Object.fromEntries(Object.entries(feature?.properties || {}).filter(([, v]) => v !== null && v !== ''));
  const geometry = feature?.geometry ? { ...feature.geometry, coordinates: roundCoordinates(feature.geometry.coordinates) } : feature?.geometry;
  return { ...feature, properties, geometry };
}

// JSON size of the claims a preview may carry. create_shared_map refuses
// 2 MiB of jsonb, which is about 1.2 times the JSON size, and the map
// layout needs a little room too.
const SHARE_CLAIMS_BYTES = 1_600_000;

function keySet(features) {
  return new Set(features.flatMap(claimIdentifiers));
}

function sameClaim(feature, selected) {
  return claimIdentifiers(feature).some((key) => selected.has(key));
}

function boundsOf(features) {
  const points = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') { points.push(value); return; }
    value.forEach(walk);
  };
  features.forEach((feature) => walk(feature?.geometry?.coordinates));
  if (!points.length) return null;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const padX = Math.max((east - west) * 0.6, 0.08);
  const padY = Math.max((north - south) * 0.6, 0.05);
  return [west - padX, south - padY, east + padX, north + padY];
}

// Up to this many requested claims are looked up by number, not by company.
const DIRECT_LOOKUP_MAX = 24;

export async function resolveMapClaims(input, search, clientIp) {
  const options = { jurisdiction: input.jurisdiction, clientIp };
  const ids = input.claim_numbers || [];
  const requested = new Set(ids.map((id) => id.toUpperCase()));
  let searched;
  let nearby = null;
  let neighboursWarning = null;

  if (input.location.bbox) {
    nearby = await search({ ...options, bbox: input.location.bbox });
  }

  const byNumber = async () => {
    const results = [];
    for (let offset = 0; offset < ids.length; offset += 4) {
      const group = await Promise.all(ids.slice(offset, offset + 4).map((id) => search({ ...options, query: id, type: 'number' })));
      results.push(...group.flatMap((collection) => collection.features || []));
    }
    return { type: 'FeatureCollection', features: results };
  };

  if (ids.length && nearby) {
    searched = nearby;
  } else if (ids.length && input.search.query && ids.length <= DIRECT_LOOKUP_MAX) {
    // A large holder's company search can take 15s or more; a few exact
    // number lookups take about one. The company search stays the fallback.
    searched = await byNumber().catch(() => null);
    const found = keySet(searched?.features || []);
    if (!searched || ids.some((id) => !found.has(id.toUpperCase()))) {
      searched = await search({ ...options, query: input.search.query, type: input.search.type });
    }
  } else if (ids.length && input.search.query) {
    searched = await search({ ...options, query: input.search.query, type: input.search.type });
  } else if (ids.length) {
    searched = await byNumber();
  } else if (input.search.query) {
    searched = await search({ ...options, query: input.search.query, type: input.search.type });
  } else {
    searched = nearby;
  }

  let primary = searched?.features || [];
  if (ids.length) {
    primary = primary.filter((feature) => sameClaim(feature, requested));
    const found = keySet(primary);
    const missing = ids.filter((id) => !found.has(id.toUpperCase()));
    if (missing.length) {
      const error = new Error(`Exact claim selection failed; missing: ${missing.join(', ')}.`);
      error.code = 'CLAIMS_NOT_FOUND';
      throw error;
    }
  } else if (nearby && input.search.query) {
    const searchedKeys = keySet(primary);
    primary = nearby.features.filter((feature) => sameClaim(feature, searchedKeys));
  }

  primary = dedupe(primary).map(compact);
  if (!primary.length) return { primary: { type: 'FeatureCollection', features: [] }, neighbours: { type: 'FeatureCollection', features: [] }, meta: searched?.meta || null };
  const primaryBytes = Buffer.byteLength(JSON.stringify(primary), 'utf8');

  // No room for neighbours: skip the lookup.
  if (input.neighbours.show && !nearby && primaryBytes < SHARE_CLAIMS_BYTES && (ids.length || input.search.query)) {
    try { nearby = await search({ ...options, bbox: boundsOf(primary) }); }
    catch { nearby = null; neighboursWarning = 'Nearby-claim lookup was unavailable; the map contains only selected claims.'; }
  }
  const primaryKeys = keySet(primary);
  const center = claimCentroid(primary[0]);
  const distance = (feature) => {
    const point = claimCentroid(feature);
    return point && center ? (point.lng - center.lng) ** 2 + (point.lat - center.lat) ** 2 : Infinity;
  };
  const allNeighbours = input.neighbours.show && (ids.length || input.search.query)
    ? dedupe((nearby?.features || []).filter((feature) => !sameClaim(feature, primaryKeys))) : [];
  const rankedNeighbours = allNeighbours.sort((a, b) => distance(a) - distance(b));
  const neighbours = [];
  let neighbourBytes = 0;
  // Neighbours get what room the selected claims leave.
  const neighbourBudget = Math.min(600_000, SHARE_CLAIMS_BYTES - primaryBytes);
  for (const feature of rankedNeighbours.map(compact)) {
    const bytes = Buffer.byteLength(JSON.stringify(feature), 'utf8');
    if (neighbours.length >= 120 || neighbourBytes + bytes > neighbourBudget) break;
    neighbours.push(feature);
    neighbourBytes += bytes;
  }
  if (allNeighbours.length > neighbours.length) neighboursWarning = `Nearby claims were limited to ${neighbours.length} closest records to keep the preview within the share limit.`;
  return {
    primary: { type: 'FeatureCollection', features: primary, meta: searched?.meta },
    neighbours: { type: 'FeatureCollection', features: neighbours, meta: nearby?.meta },
    meta: searched?.meta || nearby?.meta || null,
    neighboursWarning,
    // Too large to share: the caller refuses it rather than saving it.
    oversize: primaryBytes > SHARE_CLAIMS_BYTES,
  };
}
