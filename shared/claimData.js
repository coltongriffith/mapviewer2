export function claimProperty(feature, ...names) {
  const properties = feature?.properties || {};
  for (const name of names) {
    const key = Object.keys(properties).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    const value = key ? properties[key] : null;
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return null;
}

export function claimNumber(feature) {
  const value = claimProperty(feature, 'TAG_NUMBER', 'TENURE_NUMBER_ID', 'CLAIM_NUMBER', 'SERIAL_NR', 'SERIAL_NO', 'claim_number');
  return value == null ? null : String(value).trim();
}

export function claimIdentifiers(feature) {
  return ['TENURE_NUMBER_ID', 'TAG_NUMBER', 'CLAIM_NUMBER', 'SERIAL_NR', 'SERIAL_NO', 'claim_number']
    .map((name) => claimProperty(feature, name))
    .filter((value) => value !== null)
    .map((value) => String(value).trim().toUpperCase());
}

export function claimHolder(feature) {
  return claimProperty(feature, 'OWNER_NAME', 'HOLDER_NAME', 'HOLDER', 'CLAIMANT_NAME', 'owner_name', 'holder');
}

export function claimCentroid(feature) {
  if (!feature?.geometry) return null;
  try {
    const geometry = feature.geometry;
    const ring = geometry.type === 'Polygon' ? geometry.coordinates?.[0]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates?.[0]?.[0]
        : null;
    let lng, lat;
    if (ring?.length >= 3) {
      let twiceArea = 0, xSum = 0, ySum = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
        const cross = x1 * y2 - x2 * y1;
        twiceArea += cross;
        xSum += (x1 + x2) * cross;
        ySum += (y1 + y2) * cross;
      }
      if (Math.abs(twiceArea) > 1e-10) { lng = xSum / (3 * twiceArea); lat = ySum / (3 * twiceArea); }
    } else if (geometry.type === 'Point') {
      [lng, lat] = geometry.coordinates;
    }
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      const coordinates = ring || geometry.coordinates;
      const points = [];
      const walk = (value) => {
        if (!Array.isArray(value)) return;
        if (typeof value[0] === 'number' && typeof value[1] === 'number') { points.push(value); return; }
        value.forEach(walk);
      };
      walk(coordinates);
      if (!points.length) return null;
      lng = points.reduce((total, point) => total + point[0], 0) / points.length;
      lat = points.reduce((total, point) => total + point[1], 0) / points.length;
    }
    return Number.isFinite(lng) && Number.isFinite(lat)
      ? { lng: Number(lng.toFixed(6)), lat: Number(lat.toFixed(6)) }
      : null;
  } catch {
    return null;
  }
}

export function claimSummary(feature) {
  const area = claimProperty(feature, 'AREA_IN_HECTARES', 'AREA_HECTARES', 'AREA_HA', 'area_hectares');
  const squareMetres = claimProperty(feature, 'FEATURE_AREA_SQM');
  return {
    claim_number: claimNumber(feature),
    claim_name: claimProperty(feature, 'CLAIM_NAME', 'CSE_NAME', 'name', 'claim_name'),
    holder: claimHolder(feature),
    status: claimProperty(feature, 'STATUS', 'TENURE_STATUS', 'status'),
    good_to_date: claimProperty(feature, 'GOOD_TO_DATE', 'good_to_date', 'EXPIRY_DATE', 'expiration_date'),
    area_hectares: area != null && Number.isFinite(Number(area)) ? Number(area) : squareMetres != null && Number.isFinite(Number(squareMetres)) ? Number(squareMetres) / 10000 : null,
    centroid: claimCentroid(feature),
  };
}
