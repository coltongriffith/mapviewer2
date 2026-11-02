import dissolve from '@turf/dissolve';
import { layerFeatures, isFeatureHidden } from './featureIdentity.js';
import { propertyBoundaryInput, selectPropertyBoundaryLayer } from './propertyBoundaryInput.js';

const fail = (reason) => Object.freeze({ ok: false, reason, geometry: null });
const fc = (polygons) => ({ type: 'FeatureCollection', features: polygons.map((coordinates) => ({ type: 'Feature',
  properties: {}, geometry: { type: 'Polygon', coordinates } })) });
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const inputProject = (layer) => ({ layout: { propertyNeighboursVersion: 1, primaryLayerId: layer.id }, layers: [layer] });

/** Unbound geometry foundation. Original features remain the only source for
 * drawing fills/internal borders, hit-testing, labels, classification and IDs.
 * The cache owns no project references and keeps at most four visibility states
 * per immutable geometry. Presentation/style-only changes reuse the union.
 */
export function createPropertyBoundaryResolver(union = dissolve) {
  const cache = new WeakMap();
  return (project, options) => {
    const selected = selectPropertyBoundaryLayer(project,options);
    if (!selected.ok) return fail(selected.reason);
    const { layer } = selected;
    if (!layer.geojson || typeof layer.geojson !== 'object') return fail('no-visible-claims');
    let entry = cache.get(layer.geojson);
    if (!entry) {
      // Validate ALL raw coordinates before hidden identity lookup or cache-key
      // creation: geometry-derived feature identities serialize coordinates.
      const raw = propertyBoundaryInput(inputProject({ ...layer, featureOverrides: {} }), { enabled: true });
      entry = { reason: raw.ok ? null : raw.reason, states: new Map() };
      cache.set(layer.geojson,entry);
    }
    if (entry.reason) return fail(entry.reason);
    const visibility = layerFeatures(layer).map((feature) => isFeatureHidden(layer,feature) ? '0' : '1').join('');
    if (!entry.states.has(visibility)) {
      const input = propertyBoundaryInput(project,options);
      let result;
      if (!input.ok) result = fail(input.reason);
      else {
        try {
          const derived = union(fc(input.polygons));
          if (derived?.type !== 'FeatureCollection' || !Array.isArray(derived.features) || !derived.features.length) {
            result = fail('invalid-derived-geometry');
          } else {
            // The same count/topology bounds apply AFTER union. Crossing source
            // polygons can create more vertices than the initial input.
            const checked = propertyBoundaryInput(inputProject({ id: 'derived', role: 'claims', geojson: derived }), { enabled: true });
            result = checked.ok ? freeze({ ok: true, reason: null, geometry: fc(checked.polygons) })
              : fail(checked.reason === 'complexity-limit' ? 'derived-complexity-limit' : 'invalid-derived-geometry');
          }
        } catch { result = fail('union-failed'); }
      }
      if (entry.states.size === 4) entry.states.delete(entry.states.keys().next().value);
      entry.states.set(visibility,result);
    }
    const result = entry.states.get(visibility);
    return result.ok ? { ...result, layerId: layer.id } : result;
  };
}
