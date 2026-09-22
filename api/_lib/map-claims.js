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

  if (ids.length && nearby) {
    searched = nearby;
  } else if (ids.length && input.search.query) {
    searched = await search({ ...options, query: input.search.query, type: input.search.type });
  } else if (ids.length) {
    const results = [];
    for (let offset = 0; offset < ids.length; offset += 4) {
      const group = await Promise.all(ids.slice(offset, offset + 4).map((id) => search({ ...options, query: id, type: 'number' })));
      results.push(...group.flatMap((collection) => collection.features || []));
    }
    searched = { type: 'FeatureCollection', features: results };
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

  primary = dedupe(primary);
  if (!primary.length) return { primary: { type: 'FeatureCollection', features: [] }, neighbours: { type: 'FeatureCollection', features: [] }, meta: searched?.meta || null };

  if (input.neighbours.show && !nearby && (ids.length || input.search.query)) {
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
  for (const feature of rankedNeighbours) {
    const bytes = Buffer.byteLength(JSON.stringify(feature), 'utf8');
    if (neighbours.length >= 120 || neighbourBytes + bytes > 600_000) break;
    neighbours.push(feature);
    neighbourBytes += bytes;
  }
  if (allNeighbours.length > neighbours.length) neighboursWarning = `Nearby claims were limited to ${neighbours.length} closest records to keep the preview within the share limit.`;
  return {
    primary: { type: 'FeatureCollection', features: primary, meta: searched?.meta },
    neighbours: { type: 'FeatureCollection', features: neighbours, meta: nearby?.meta },
    meta: searched?.meta || nearby?.meta || null,
    neighboursWarning,
  };
}
