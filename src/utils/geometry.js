export function featureCollectionFeatures(geojson) {
  if (!geojson) return [];
  if (geojson.type === "FeatureCollection") return geojson.features || [];
  if (geojson.type === "Feature") return [geojson];
  return [];
}

export function featureCenter(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  const { type, coordinates } = geometry;

  if (type === "Point") return { lng: coordinates[0], lat: coordinates[1] };
  if (type === "MultiPoint" && coordinates[0]) return { lng: coordinates[0][0], lat: coordinates[0][1] };

  const points = flattenCoordinates(coordinates);
  if (!points.length) return null;
  const sum = points.reduce((acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }), { lng: 0, lat: 0 });
  return { lng: sum.lng / points.length, lat: sum.lat / points.length };
}

export function geojsonCenter(geojson) {
  const features = featureCollectionFeatures(geojson);
  const centers = features.map(featureCenter).filter(Boolean);
  if (!centers.length) return null;
  const sum = centers.reduce((acc, pt) => ({ lng: acc.lng + pt.lng, lat: acc.lat + pt.lat }), { lng: 0, lat: 0 });
  return { lng: sum.lng / centers.length, lat: sum.lat / centers.length };
}

export function geojsonBounds(geojson) {
  const points = flattenCoordinatesFromGeojson(geojson);
  if (!points.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  points.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  });
  return { minLng, minLat, maxLng, maxLat };
}

export function unionBounds(boundsList) {
  const filtered = boundsList.filter(Boolean);
  if (!filtered.length) return null;
  return filtered.reduce(
    (acc, b) => ({
      minLng: Math.min(acc.minLng, b.minLng),
      minLat: Math.min(acc.minLat, b.minLat),
      maxLng: Math.max(acc.maxLng, b.maxLng),
      maxLat: Math.max(acc.maxLat, b.maxLat),
    }),
    { ...filtered[0] }
  );
}

function flattenCoordinatesFromGeojson(geojson) {
  return featureCollectionFeatures(geojson).flatMap((feature) => flattenCoordinates(feature?.geometry?.coordinates));
}

function flattenCoordinates(value) {
  if (!Array.isArray(value)) return [];
  if (typeof value[0] === "number" && typeof value[1] === "number") return [[value[0], value[1]]];
  return value.flatMap(flattenCoordinates);
}
