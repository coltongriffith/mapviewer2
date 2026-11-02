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

/** Capture only after an explicit user action. References are preserved on
 * restore/reorder/temporary hiding; changed source IDs require a fresh action.
 */
export function createClaimKeySnapshot(project, field, options) {
  const result = claimKeyCandidates(project, field, options);
  return { ...result, snapshot: result.ok ? { version: 1, layerId: project.layout.primaryLayerId,
    field, entries: result.entries.map((entry) => ({ ...entry })) } : null };
}

export function resolveClaimKeySnapshot(project, snapshot) {
  if (!snapshot || snapshot.version !== 1 || typeof snapshot.field !== 'string'
    || typeof snapshot.layerId !== 'string' || !Array.isArray(snapshot.entries)
    || !snapshot.entries.length || snapshot.entries.length > MAX_ROWS) return fail('invalid-key');
  const saved = new Map(), references = new Set(), labels = new Set();
  for (const entry of snapshot.entries) {
    if (!entry || typeof entry.identity !== 'string' || !entry.identity.trim() || entry.identity.length > 512 || !scalar(entry.identifier)
      || entry.label !== String(entry.identifier).trim() || typeof entry.reference !== 'string' || !/^K([1-9]\d{0,2})$/.test(entry.reference)
      || Number(entry.reference.slice(1)) > MAX_ROWS || saved.has(entry.identity)
      || references.has(entry.reference) || labels.has(entry.label)) return fail('invalid-key');
    saved.set(entry.identity, entry);
    references.add(entry.reference); labels.add(entry.label);
  }
  if (project?.layout?.primaryLayerId !== snapshot.layerId) return fail('rebuild-key');
  const current = claimKeyCandidates(project, snapshot.field, { maxRows: MAX_ROWS });
  if (!current.ok) return current;
  // Hidden shapes can temporarily disappear, but deleted source shapes and new
  // visible shapes cannot silently reuse or renumber the saved references.
  const layer = project.layers.find((item) => item.id === snapshot.layerId);
  const present = new Set(layerFeatures(layer).map((feature) => String(featureKey(feature))));
  if ([...saved.keys()].some((key) => !present.has(key))) return fail('rebuild-key');
  const entries = [];
  for (const entry of current.entries) {
    const old = saved.get(entry.identity);
    if (!old || old.identifier !== entry.identifier || old.label !== entry.label) return fail('rebuild-key');
    entries.push({ ...old });
  }
  entries.sort((a, b) => Number(a.reference.slice(1)) - Number(b.reference.slice(1)));
  return { ok: true, reason: null, total: entries.length, hidden: saved.size - entries.length, entries };
}
