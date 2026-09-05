import dissolveGeo from '@turf/dissolve';
import { visibleGeojson } from './featureIdentity';

const NO_OVERRIDES = Object.freeze({});

// Geometry and overrides are immutable in project state. Weak keys allow old
// projects/undo snapshots to be collected without an unbounded global cache.
export function createLayerGeometryCache() {
  const cache = new WeakMap();
  return (layer, { dissolve = false } = {}) => {
    if (!layer.geojson) return null;
    let byOverrides = cache.get(layer.geojson);
    if (!byOverrides) { byOverrides = new WeakMap(); cache.set(layer.geojson, byOverrides); }
    const overrides = layer.featureOverrides || NO_OVERRIDES;
    let entry = byOverrides.get(overrides);
    if (!entry) { entry = { visible: visibleGeojson(layer) }; byOverrides.set(overrides, entry); }
    if (!dissolve) return entry.visible;
    if (entry.dissolved) return entry.dissolved;
    const data = entry.visible;
    const fc = data.type === 'FeatureCollection' ? data : {
      type: 'FeatureCollection', features: data.type === 'Feature' ? [data] : [{ type: 'Feature', geometry: data, properties: {} }],
    };
    try {
      const result = dissolveGeo(fc);
      entry.dissolved = result?.features?.length ? result : data;
    } catch { entry.dissolved = data; }
    return entry.dissolved;
  };
}
