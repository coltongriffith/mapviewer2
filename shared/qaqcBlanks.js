// Blank threshold comparisons for ONE written import. A blank fails when its
// reported value exceeds N × the recorded detection limit. Below-detection
// results pass and stay censored. No limit, unit or value is ever substituted.
export const MAX_BLANK_SNAPSHOT_ROWS = 5000;
export const BLANK_MULTIPLIER = Object.freeze({ min: 3, max: 10, default: 5 });
export const BLANK_EXCLUSION_REASONS = Object.freeze({
  missing_element: 'The selected element is missing from this blank.',
  unit_mismatch: 'The blank must use the selected exact unit.',
  invalid_value: 'The reported value must be a finite, nonnegative number below 1e12.',
  missing_raw: 'Original laboratory result text is unavailable.',
  missing_detection_limit: 'No detection limit is recorded for this result or its laboratory job, element and unit; none is assumed.',
  ambiguous_detection_limit: 'Different detection limits are recorded for this laboratory job, element and unit; none is chosen.',
  numerical_range: 'The threshold cannot be represented reliably at this numeric precision.',
});
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v, k) => object(v) && Object.hasOwn(v, k);
const text = v => typeof v === 'string' && v.trim().length > 0;
const value = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12;
const limit = v => value(v) && v > 0;
const sourceRow = v => Number.isInteger(v) && v > 0 && v <= MAX_BLANK_SNAPSHOT_ROWS;
const order = (a, b) => a.source_row - b.source_row || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function validBlankMultiplier(multiplier) {
  return typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier >= BLANK_MULTIPLIER.min && multiplier <= BLANK_MULTIPLIER.max;
}

/**
 * Exceeds only when value is above N × DL by more than four relative machine
 * epsilons of the threshold (decimal arithmetic, not assay tolerance). Equal
 * to the threshold passes. Null means it cannot be assessed.
 */
export function blankThresholdComparison(observed, detectionLimit, multiplier) {
  if (!validBlankMultiplier(multiplier)) throw new Error('Choose a blank threshold from 3 to 10 times the detection limit.');
  if (!value(observed) || !limit(detectionLimit)) return null;
  const threshold = multiplier * detectionLimit, ratio = observed / detectionLimit;
  if (!Number.isFinite(threshold) || !Number.isFinite(ratio) || threshold <= 0 || (ratio === 0 && observed !== 0)) return null;
  const exceeds = observed > threshold && observed - threshold > 4 * Number.EPSILON * threshold;
  return { threshold, ratio, outcome: exceeds ? 'fail' : 'pass' };
}

function observedSource(row, element) {
  const r = row.record;
  return { recordId: row.id, sampleId: r.sample_id, batchId: row.batch_id, sourceRow: row.source_row,
    raw: own(r.raw_values, element) ? r.raw_values[element] : null,
    value: own(r.values, element) ? r.values[element] : null,
    unit: own(r.units, element) ? r.units[element] : null,
    censored: own(r.bdl, element),
    detectionLimit: own(r.bdl, element) && typeof r.bdl[element] === 'number' ? r.bdl[element] : null };
}

/**
 * Numeric detection limits recorded on below-detection results (any sample
 * type) in the same laboratory job, element and exact unit of this import.
 * Only distinct exact values; nothing is estimated from detected results.
 */
export function recordedDetectionLimits(records, scope) {
  const sources = records.filter(({ record: r }) => r.lab_id === scope.labId && r.lab_batch_id === scope.labBatchId
    && own(r.values, scope.element) && own(r.units, scope.element) && r.units[scope.element] === scope.unit
    && own(r.bdl, scope.element) && limit(r.bdl[scope.element])).sort(order)
    .map(row => ({ recordId: row.id, sampleId: row.record.sample_id, sampleType: row.record.sample_type, batchId: row.batch_id,
      sourceRow: row.source_row, raw: own(row.record.raw_values, scope.element) ? row.record.raw_values[scope.element] : null, limit: row.record.bdl[scope.element] }));
  return { values: [...new Set(sources.map(s => s.limit))].sort((a, b) => a - b), sources };
}

/**
 * records: every written sample version in ONE property/import. Order is the
 * submitted source row: import order, not analytical order.
 */
export function analyzeBlankSnapshot({ scope, records, complete, multiplier = BLANK_MULTIPLIER.default } = {}) {
  if (!object(scope) || scope.sampleType !== 'blank' || !['propertyId', 'batchId', 'labId', 'labBatchId', 'element', 'unit'].every(k => text(scope[k]))) {
    throw new Error('Choose an explicit property, sample import, laboratory/job, element and unit for blanks.');
  }
  if (!validBlankMultiplier(multiplier)) throw new Error('Choose a blank threshold from 3 to 10 times the detection limit.');
  if (typeof complete !== 'boolean') throw new Error('Snapshot completeness must be explicit.');
  const result = { scope: { ...scope }, complete, interpretation: 'threshold', multiplier, batchRecordCount: null,
    selectedCount: null, eligibleCount: null, excludedCount: null, excludedByReason: null, detectionLimits: null,
    points: [], excluded: [], failures: [], summaries: null };
  if (!complete) return result;
  if (!Array.isArray(records) || records.length > MAX_BLANK_SNAPSHOT_ROWS) throw new Error('A blank snapshot is limited to 5,000 written samples.');
  const ids = new Set();
  for (const row of records) {
    if (!object(row) || !text(row.id) || row.property_id !== scope.propertyId || row.batch_id !== scope.batchId
      || !sourceRow(row.source_row) || !object(row.record)) throw new Error('Snapshot rows must retain their property/import identity and source row.');
    if (ids.has(row.id)) throw new Error('Repeated sample IDs make this snapshot ambiguous.');
    ids.add(row.id);
  }
  const limits = recordedDetectionLimits(records, scope), job = limits.values.length === 1 ? limits.values[0] : null;
  const selected = records.filter(({ record: r }) => r.sample_type === 'blank' && r.lab_id === scope.labId && r.lab_batch_id === scope.labBatchId).sort(order);
  const excludedByReason = Object.fromEntries(Object.keys(BLANK_EXCLUSION_REASONS).map(k => [k, 0]));
  for (const row of selected) {
    const r = row.record, observed = observedSource(row, scope.element);
    const point = { id: row.id, sampleId: r.sample_id, batchId: row.batch_id, sourceRow: row.source_row,
      element: scope.element, unit: scope.unit, observed, detectionLimit: null, detectionLimitSource: null };
    let reason = null, calculated = null;
    if (!own(r.values, scope.element)) reason = 'missing_element';
    else if (observed.unit !== scope.unit) reason = 'unit_mismatch';
    else if (!observed.censored && !value(observed.value)) reason = 'invalid_value';
    else if (!text(observed.raw)) reason = 'missing_raw';
    else {
      if (observed.censored && limit(observed.detectionLimit)) Object.assign(point, { detectionLimit: observed.detectionLimit, detectionLimitSource: 'result' });
      else if (job !== null) Object.assign(point, { detectionLimit: job, detectionLimitSource: 'job' });
      if (point.detectionLimit === null) reason = limits.values.length > 1 ? 'ambiguous_detection_limit' : 'missing_detection_limit';
      else if (observed.censored) {
        // Below detection is below N × DL for every allowed N; the plotted
        // position is the recorded limit, never a measured value.
        const threshold = multiplier * point.detectionLimit;
        calculated = Number.isFinite(threshold) ? { threshold, ratio: null, outcome: 'pass' } : null;
        if (!calculated) reason = 'numerical_range';
      } else {
        calculated = blankThresholdComparison(observed.value, point.detectionLimit, multiplier);
        if (!calculated) reason = 'numerical_range';
      }
    }
    if (reason) {
      excludedByReason[reason]++;
      result.excluded.push({ ...point, status: 'unassessed', reason, message: BLANK_EXCLUSION_REASONS[reason] });
    } else result.points.push({ ...point, status: 'assessed', censored: observed.censored, ...calculated });
  }
  result.failures = result.points.filter(p => p.outcome === 'fail');
  const total = result.points.length;
  const tally = test => { const count = result.points.filter(test).length; return { count, total, percent: total ? 100 * count / total : null }; };
  Object.assign(result, { batchRecordCount: records.length, selectedCount: selected.length, eligibleCount: total,
    excludedCount: result.excluded.length, excludedByReason, detectionLimits: limits,
    summaries: { pass: tally(p => p.outcome === 'pass'), fail: tally(p => p.outcome === 'fail'), censored: tally(p => p.censored) } });
  return result;
}
