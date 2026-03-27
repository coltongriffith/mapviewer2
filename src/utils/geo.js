export function circleToPolygon(center, radius, n = 24) {
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const lat = center.lat + (radius / 111320) * Math.cos(angle);
    const lng =
      center.lng +
      (radius / (111320 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle);
    return { lat, lng };
  });
}

export function featureCollectionFeatures(geojson) {
  if (!geojson) return [];
  if (geojson.type === 'FeatureCollection') return geojson.features || [];
  if (geojson.type === 'Feature') return [geojson];
  if (Array.isArray(geojson)) {
    return geojson.flatMap((g) => featureCollectionFeatures(g));
  }
  return [];
}

export function isPointLayerGeoJSON(geojson) {
  const features = featureCollectionFeatures(geojson);
  if (!features.length) return false;
  const pointCount = features.filter((f) => {
    const type = f?.geometry?.type;
    return type === 'Point' || type === 'MultiPoint';
  }).length;
  return pointCount / features.length > 0.5;
}

export function getPropertyKeys(geojson) {
  const features = featureCollectionFeatures(geojson);
  const keys = new Set();
  features.slice(0, 20).forEach((f) => {
    Object.keys(f?.properties || {}).forEach((k) => keys.add(k));
  });
  return [...keys];
}
