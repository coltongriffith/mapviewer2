// Descriptive comparisons with exact pinned, supplied CRM definitions. No
// certification validation, process acceptance, unit conversion or run rules.
export const MAX_CRM_SNAPSHOT_ROWS = 5000;
export const CRM_EXCLUSION_REASONS = Object.freeze({
  missing_element: 'The selected element is missing from this standard.',
  unit_mismatch: 'The standard must use the selected exact unit.',
  missing_reference: 'The pinned CRM definition is unavailable.',
  ambiguous_reference: 'More than one pinned definition matches this comparison.',
  reference_mismatch: 'The pinned CRM identity or source metadata does not match.',
  censored: 'The result is below detection; no substituted value is used.',
  invalid_value: 'The observation and supplied reference must contain valid finite values.',
  missing_raw: 'Original laboratory result text is unavailable.',
  numerical_range: 'The score or reference bands cannot be represented reliably at this numeric precision.',
});
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v, k) => object(v) && Object.hasOwn(v, k);
const text = v => typeof v === 'string' && v.trim().length > 0;
const value = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12;
const sourceRow = v => Number.isInteger(v) && v > 0 && v <= MAX_CRM_SNAPSHOT_ROWS;
const order = (a, b) => a.source_row - b.source_row || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const matching = (r, scope) => object(r) && r.crm_id === scope.crmId && r.revision === scope.crmRevision
  && r.element === scope.element && r.unit === scope.unit;

/**
 * Boundary allowance: four relative machine epsilons of the supplied reference
 * scale. This handles decimal arithmetic, not assay uncertainty or display
 * rounding. Reject scales where that allowance exceeds sqrt(machine epsilon)
 * of one SD, so reference-scale rounding cannot hide a material SD excursion.
 */
export function crmReferenceComparison(observed, expected, sd) {
  if (!value(observed) || !value(expected) || !value(sd) || sd === 0) return null;
  const bands = { lower3: expected - 3 * sd, lower2: expected - 2 * sd, expected,
    upper2: expected + 2 * sd, upper3: expected + 3 * sd };
  const z = (observed - expected) / sd;
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(bands.lower3), Math.abs(bands.upper3), sd);
  if (!Number.isFinite(z) || (z === 0 && observed !== expected) || !Object.values(bands).every(Number.isFinite)
    || !(bands.lower3 < bands.lower2 && bands.lower2 < expected && expected < bands.upper2 && bands.upper2 < bands.upper3)
    || tolerance / sd > Math.sqrt(Number.EPSILON)) return null;
  const outside = (lower, upper) => observed < lower && lower - observed > tolerance
    || observed > upper && observed - upper > tolerance;
  const category = outside(bands.lower3, bands.upper3) ? 'outside3'
    : outside(bands.lower2, bands.upper2) ? 'outside2Within3' : 'within2';
  return { z, bands, category };
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
 * records: every written sample version in ONE property/import.
 * crms: the selected tuple's exact pinned historical definitions, including
 * superseded/withdrawn versions. Loader completeness must be explicit. Retain
 * its manifest separately; this module cannot prove authorization/completeness.
 */
export function analyzeCrmSnapshot({ scope, records, crms, complete } = {}) {
  if (!object(scope) || !['propertyId', 'batchId', 'labId', 'labBatchId', 'crmId', 'crmRevision', 'element', 'unit'].every(k => text(scope[k]))) {
    throw new Error('Choose an explicit property, sample import, laboratory/job, CRM/revision, element and unit.');
  }
  if (typeof complete !== 'boolean') throw new Error('Snapshot completeness must be explicit.');
  const result = { scope: { ...scope }, complete, interpretation: 'descriptive', batchRecordCount: null,
    selectedCount: null, eligibleCount: null, excludedCount: null, excludedByReason: null, points: [], excluded: [], summaries: null };
  if (!complete) return result;
  if (!Array.isArray(records) || !Array.isArray(crms) || records.length > MAX_CRM_SNAPSHOT_ROWS || crms.length > MAX_CRM_SNAPSHOT_ROWS) {
    throw new Error('A CRM snapshot is limited to 5,000 written samples and pinned definitions.');
  }
  const ids = new Set(), byId = new Map();
  for (const row of records) {
    if (!object(row) || !text(row.id) || row.property_id !== scope.propertyId || row.batch_id !== scope.batchId
      || !sourceRow(row.source_row) || !object(row.record)) throw new Error('Snapshot rows must retain their property/import identity and source row.');
    if (ids.has(row.id)) throw new Error('Repeated sample IDs make this snapshot ambiguous.');
    ids.add(row.id);
  }
  for (const crm of crms) {
    if (!object(crm) || !text(crm.id) || byId.has(crm.id)) throw new Error('Pinned definitions must have unique record IDs.');
    byId.set(crm.id, crm);
  }
  const selected = records.filter(({ record: r }) => r.sample_type === 'standard' && r.lab_id === scope.labId
    && r.lab_batch_id === scope.labBatchId && r.crm_id === scope.crmId && r.crm_revision === scope.crmRevision).sort(order);
  const excludedByReason = Object.fromEntries(Object.keys(CRM_EXCLUSION_REASONS).map(k => [k, 0]));
  for (const row of selected) {
    const r = row.record, observed = observedSource(row, scope.element);
    const point = { id: row.id, sampleId: r.sample_id, batchId: row.batch_id, sourceRow: row.source_row,
      element: scope.element, unit: scope.unit, observed, reference: null };
    let reason = null, calculated = null;
    // Check selection fields first: a missing element has no corresponding pin,
    // and a different unit's pin is deliberately absent from the scoped read.
    if (!own(r.values, scope.element)) reason = 'missing_element';
    else if (observed.unit !== scope.unit) reason = 'unit_mismatch';
    else if (!Array.isArray(row.crm_version_ids) || !row.crm_version_ids.length) reason = 'missing_reference';
    else if (row.crm_version_ids.length > 64 || row.crm_version_ids.some(id => !text(id))) reason = 'reference_mismatch';
    else if (new Set(row.crm_version_ids).size !== row.crm_version_ids.length) reason = 'ambiguous_reference';
    else {
      const pinned = row.crm_version_ids.map(id => byId.get(id)).filter(Boolean);
      const matches = pinned.filter(crm => matching(crm.record, scope));
      if (matches.length > 1) reason = 'ambiguous_reference';
      else if (!matches.length) reason = pinned.length ? 'reference_mismatch' : 'missing_reference';
      else {
        const crm = matches[0], definition = crm.record;
        if (crm.property_id !== scope.propertyId || !text(crm.batch_id) || !sourceRow(crm.source_row)
          || !text(definition.source) || !text(r.sample_id)) reason = 'reference_mismatch';
        else {
          point.reference = { recordId: crm.id, batchId: crm.batch_id, sourceRow: crm.source_row,
            crmId: definition.crm_id, revision: definition.revision, element: definition.element, unit: definition.unit,
            expected: definition.expected, sd: definition.sd, source: definition.source };
          if (observed.censored) reason = 'censored';
          else if (!value(observed.value) || !value(definition.expected) || !value(definition.sd) || definition.sd === 0) reason = 'invalid_value';
          else if (!text(observed.raw)) reason = 'missing_raw';
          else {
            calculated = crmReferenceComparison(observed.value, definition.expected, definition.sd);
            if (!calculated) reason = 'numerical_range';
          }
        }
      }
    }
    if (reason) {
      excludedByReason[reason]++;
      result.excluded.push({ ...point, status: 'unassessed', reason, message: CRM_EXCLUSION_REASONS[reason] });
    } else result.points.push({ ...point, status: 'descriptive', ...calculated });
  }
  const total = result.points.length;
  const category = name => {
    const count = result.points.filter(point => point.category === name).length;
    return { count, total, percent: total ? 100 * count / total : null };
  };
  Object.assign(result, { batchRecordCount: records.length, selectedCount: selected.length, eligibleCount: total,
    excludedCount: result.excluded.length, excludedByReason,
    summaries: { within2: category('within2'), outside2Within3: category('outside2Within3'), outside3: category('outside3') } });
  return result;
}
