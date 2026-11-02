import { featureKey, isFeatureHidden, layerFeatures } from './featureIdentity.js';

const MAX_FEATURES = 5000;
const MAX_ROWS = 200;
const scalar = (value) => typeof value === 'string' ? value.trim().length > 0 && value.length <= 256
  : typeof value === 'number' && Number.isSafeInteger(value);
const fail = (reason, total = 0) => ({ ok: false, reason, total, entries: [] });

// This gate only avoids geometry-derived identities for a compact key. Actual
// hide/style identity still comes exclusively from the existing featureKey.
function hasSuppliedIdentity(feature) {
  if (feature.id != null) return scalar(feature.id);
  const p = feature.properties || {};
  for (const field of ['TENURE_NUMBER_ID', 'TAG_NUMBER']) {
    if (p[field] != null && p[field] !== '') return scalar(p[field]);
  }
  return scalar(p.hole_id || p.holeid || p.id || p.name);
}

/** Unexposed foundation for an explicit compact claim key. Display references
 * are not claim IDs. No input mutation, inferred field, truncation or UI state.
 * A later renderer must share placed references with its printed table.
 */
export function claimKeyCandidates(project, field, { maxRows = 40 } = {}) {
  const layout = project?.layout || {};
  if (layout.propertyNeighboursVersion !== 1 || !layout.primaryLayerId) return fail('select-property');
  const layers = (project.layers || []).filter((layer) => layer.id === layout.primaryLayerId);
  if (layers.length !== 1) return fail('select-property');
  const layer = layers[0];
  if (layer.role !== 'claims' || layer.visible === false || layer.focus === false) return fail('select-property');
  if (typeof field !== 'string' || !field || field.length > 256) return fail('select-identifier-field');
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS) return fail('invalid-row-limit');
  const features = layerFeatures(layer);
  if (features.length > MAX_FEATURES) return fail('feature-limit', features.length);
  const identities = new Set(), identifiers = new Set(), entries = [];
  for (const feature of features) {
    if (!feature || !hasSuppliedIdentity(feature)) return fail('supplied-identity-required');
    const identity = String(featureKey(feature));
    if (identities.has(identity)) return fail('duplicate-feature-identity');
    identities.add(identity);
    if (isFeatureHidden(layer, feature)) continue;
    if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) return fail('polygon-required');
    const properties = feature.properties || {};
    const identifier = Object.hasOwn(properties, field) ? properties[field] : null;
    if (!scalar(identifier)) return fail('incomplete-identifiers');
    const label = String(identifier).trim();
    if (identifiers.has(label)) return fail('duplicate-identifiers');
    identifiers.add(label);
    entries.push({ identity, identifier, label });
  }
  if (!entries.length) return fail('no-visible-claims');
  if (entries.length > maxRows) return fail('row-limit', entries.length);
  entries.sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  return { ok: true, reason: null, total: entries.length,
    entries: entries.map((entry, i) => ({ ...entry, reference: `K${i + 1}` })) };
}
