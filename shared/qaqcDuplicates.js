// Descriptive comparisons of immutable duplicate/parent versions. This module
// makes no lab acceptance decision, unit conversion, censoring substitution,
// analysis-method assumption or chronological interpretation of source rows.
export const MAX_DUPLICATE_SNAPSHOT_ROWS = 5000;
export const DUPLICATE_TYPES = Object.freeze(['field_dup', 'coarse_dup', 'pulp_dup']);
export const DUPLICATE_EXCLUSION_REASONS = Object.freeze({
  missing_parent: 'Pinned parent record is unavailable.',
  reference_mismatch: 'Pinned parent identity or source metadata does not match this duplicate.',
  missing_element: 'The selected element is missing from one or both records.',
  unit_mismatch: 'Both records must use the selected exact unit.',
  censored: 'At least one result is below detection; no substituted value is used.',
  invalid_value: 'Both values must be finite, nonnegative numbers below 1e12.',
  missing_raw: 'Original laboratory result text is unavailable.',
  zero_sum: 'Both results are zero; HARD is undefined.',
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => object(value) && Object.hasOwn(value, key);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const sourceRow = value => Number.isInteger(value) && value >= 1 && value <= MAX_DUPLICATE_SNAPSHOT_ROWS;
const validValue = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e12;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Numerically symmetric HARD; no rounding or imputation. Null means undefined. */
export function hardPercent(x, y) {
  if (!validValue(x) || !validValue(y) || x + y === 0) return null;
  return 100 * (Math.abs(x - y) / (x + y));
}

/** Reference envelopes are relative to the ORIGINAL, not a HARD threshold. */
export function originalRelativeBand(x, fraction) {
  if (!validValue(x) || !Number.isFinite(fraction) || fraction < 0 || fraction >= 1) return null;
  return { lower: x * (1 - fraction), upper: x * (1 + fraction) };
}

function source(row, element) {
  return {
    recordId: row.id, sampleId: row.record.sample_id, batchId: row.batch_id, sourceRow: row.source_row,
    raw: own(row.record.raw_values, element) ? row.record.raw_values[element] : null,
    value: own(row.record.values, element) ? row.record.values[element] : null,
    unit: own(row.record.units, element) ? row.record.units[element] : null,
    censored: own(row.record.bdl, element),
    detectionLimit: own(row.record.bdl, element) && typeof row.record.bdl[element] === 'number' ? row.record.bdl[element] : null,
  };
}

/**
 * records: all written rows in ONE batch (historical rows included).
 * parents: exact pinned historical rows, fetched with the same property filter.
 * scope: propertyId,batchId,sampleType,labId,labBatchId,element,unit; all explicit.
 * complete must be true before any chart/statistic is emitted. A missing parent
 * after a successful scoped read is an exclusion; failed/truncated reads are not.
 */
export function analyzeDuplicateSnapshot({ scope, records, parents, complete } = {}) {
  if (!object(scope) || !['propertyId', 'batchId', 'sampleType', 'labId', 'labBatchId', 'element', 'unit'].every(k => nonempty(scope[k]))) throw new Error('Choose an explicit property, import, duplicate type, laboratory/job, element and unit.');
  if (!DUPLICATE_TYPES.includes(scope.sampleType)) throw new Error('Choose field_dup, coarse_dup or pulp_dup separately.');
  if (typeof complete !== 'boolean') throw new Error('Snapshot completeness must be explicit.');
  const result = { scope: { ...scope }, complete, interpretation: 'descriptive', batchRecordCount: null,
    selectedCount: null, eligibleCount: null, excludedCount: null, excludedByReason: null,
    points: [], excluded: [], ranked: [], summaries: null };
  if (!complete) return result;
  if (!Array.isArray(records) || !Array.isArray(parents) || records.length > MAX_DUPLICATE_SNAPSHOT_ROWS || parents.length > MAX_DUPLICATE_SNAPSHOT_ROWS) throw new Error('A duplicate snapshot is limited to 5,000 written rows and pinned parents.');
  const recordIds = new Set(), parentById = new Map();
  for (const row of records) {
    if (!object(row) || !nonempty(row.id) || row.property_id !== scope.propertyId || row.batch_id !== scope.batchId || !object(row.record) || !sourceRow(row.source_row)) throw new Error('Snapshot rows must belong to the selected property/import and retain their source row.');
    if (recordIds.has(row.id)) throw new Error('Duplicate record IDs make this snapshot ambiguous.');
    recordIds.add(row.id);
  }
  for (const row of parents) {
    if (!object(row) || !nonempty(row.id)) throw new Error('Pinned parent rows must have record IDs.');
    if (parentById.has(row.id)) throw new Error('Duplicate parent record IDs make this snapshot ambiguous.');
    parentById.set(row.id, row);
  }
  const selected = records.filter(row => row.record.sample_type === scope.sampleType && row.record.lab_id === scope.labId && row.record.lab_batch_id === scope.labBatchId)
    .sort((a, b) => a.source_row - b.source_row || byId(a, b));
  const excludedByReason = Object.fromEntries(Object.keys(DUPLICATE_EXCLUSION_REASONS).map(key => [key, 0]));
  for (const row of selected) {
    const record = row.record, parent = parentById.get(row.parent_version_id);
    const point = { id: row.id, parentId: nonempty(row.parent_version_id) ? row.parent_version_id : null,
      sampleId: record.sample_id, parentSampleId: record.parent_sample_id, batchId: row.batch_id, sourceRow: row.source_row,
      element: scope.element, unit: scope.unit, duplicate: source(row, scope.element), original: null };
    let reason = null;
    if (!parent) reason = 'missing_parent';
    else if (parent.property_id !== scope.propertyId || !nonempty(parent.batch_id) || !sourceRow(parent.source_row) || !object(parent.record)
      || parent.record.sample_type !== 'routine' || parent.record.lab_id !== scope.labId || parent.record.lab_batch_id !== scope.labBatchId
      || !nonempty(record.sample_id) || !nonempty(record.parent_sample_id) || record.parent_sample_id === record.sample_id || parent.record.sample_id !== record.parent_sample_id) reason = 'reference_mismatch';
    else {
      point.original = source(parent, scope.element);
      if (!own(record.values, scope.element) || !own(parent.record.values, scope.element)) reason = 'missing_element';
      else if (point.duplicate.unit !== scope.unit || point.original.unit !== scope.unit) reason = 'unit_mismatch';
      else if (point.duplicate.censored || point.original.censored) reason = 'censored';
      else if (!validValue(point.duplicate.value) || !validValue(point.original.value)) reason = 'invalid_value';
      else if (!nonempty(point.duplicate.raw) || !nonempty(point.original.raw)) reason = 'missing_raw';
      else if (point.duplicate.value + point.original.value === 0) reason = 'zero_sum';
    }
    if (reason) {
      excludedByReason[reason]++;
      result.excluded.push({ ...point, status: 'unassessed', reason, message: DUPLICATE_EXCLUSION_REASONS[reason] });
    } else {
      const x = point.original.value, y = point.duplicate.value;
      result.points.push({ ...point, status: 'descriptive', x, y, hard: hardPercent(x, y), logEligible: x > 0 && y > 0 });
    }
  }
  const total = result.points.length;
  const within = threshold => {
    const count = result.points.filter(point => point.hard <= threshold).length;
    return { count, total, percent: total ? 100 * count / total : null };
  };
  result.ranked = [...result.points].sort((a, b) => a.hard - b.hard || byId(a, b))
    .map((point, index) => ({ ...point, rank: index + 1, cumulativePercent: 100 * (index + 1) / total }));
  const logCount = result.points.filter(point => point.logEligible).length;
  Object.assign(result, { batchRecordCount: records.length, selectedCount: selected.length, eligibleCount: total,
    excludedCount: result.excluded.length, excludedByReason,
    summaries: { hardCount: total, logCount, logExcludedCount: total - logCount, within10: within(10), within20: within(20) } });
  return result;
}
