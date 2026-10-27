import { toNumber } from './classification.js';
import { MAX_FEATURES } from './importLimits.js';

// Bound the picker too: an enormous number of distinct property names should
// fail explicitly, not truncate the column list or create an enormous DOM.
export const MAX_SUMMARY_COLUMNS = 1000;

/** Scan only after the inspector opens. Retain source records, never expand geometry. */
export function pointColumnSnapshot(geojson) {
  const features = geojson?.type === 'Feature' ? [geojson]
    : geojson?.type === 'FeatureCollection' && Array.isArray(geojson.features) ? geojson.features : [];
  if (features.length > MAX_FEATURES) return { error: `This layer exceeds the ${MAX_FEATURES.toLocaleString('en-US')}-record inspection limit. Split it before inspecting; no partial summary is shown.` };
  const records = [], fields = new Set();
  const scope = { total: features.length, points: 0, traces: 0, multiPoint: 0, other: 0 };
  for (const feature of features) {
    if (feature?.properties?._trace) { scope.traces++; continue; }
    if (feature?.type !== 'Feature' || feature.geometry?.type !== 'Point') {
      if (feature?.type === 'Feature' && feature.geometry?.type === 'MultiPoint') scope.multiPoint++;
      else scope.other++;
      continue;
    }
    scope.points++;
    records.push(feature);
    for (const field of Object.keys(feature.properties || {})) {
      if (field === '_trace') continue;
      fields.add(field);
      if (fields.size > MAX_SUMMARY_COLUMNS) return { error: `This layer has more than ${MAX_SUMMARY_COLUMNS} Point-record columns. Reduce its columns before inspecting; none are silently omitted.` };
    }
  }
  return { records, fields: [...fields].sort(), scope };
}

/** Exact observed order statistics; no interpolation, rounding or value substitution. */
export function summarizePointColumn(snapshot, field) {
  if (snapshot.error || !snapshot.fields.includes(field)) return null;
  const values = [], counts = { total: snapshot.records.length, numeric: 0, blank: 0, qualified: 0, other: 0 };
  for (const feature of snapshot.records) {
    const raw = Object.hasOwn(feature.properties || {}, field) ? feature.properties[field] : undefined;
    if (raw == null || (typeof raw === 'string' && raw.trim() === '')) counts.blank++;
    else if (typeof raw === 'string' && /^[<>≤≥]/u.test(raw.trim())) counts.qualified++;
    else {
      const number = toNumber(raw);
      if (Number.isFinite(number)) { values.push(number); counts.numeric++; }
      else counts.other++;
    }
  }
  values.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const rank = (p) => values[Math.ceil(p * values.length) - 1];
  const statistics = values.length ? {
    minimum: values[0], p10: rank(0.1), p50: rank(0.5), p90: rank(0.9), maximum: values[values.length - 1],
  } : null;
  return { field, counts, statistics };
}
