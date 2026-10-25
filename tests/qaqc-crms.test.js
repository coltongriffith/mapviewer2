import { describe, it, expect } from 'vitest';
import { analyzeCrmSnapshot, crmControlRules, crmReferenceComparison, CRM_EXCLUSION_REASONS, CRM_RULES } from '../shared/qaqcCrms.js';

// Synthetic controls only; these do not describe real assays or certified CRMs.
const scope = { propertyId: 'property', batchId: 'sample-import', labId: 'Lab', labBatchId: 'Job', crmId: 'CRM', crmRevision: 'rev-01', element: 'Au', unit: 'g/t' };
const crm = (id = 'crm-old', fields = {}, row = {}) => ({ id, property_id: scope.propertyId, batch_id: 'crm-import', source_row: 1,
  record: { crm_id: scope.crmId, revision: scope.crmRevision, element: scope.element, unit: scope.unit,
    expected: 10, sd: 2, source: 'Synthetic supplied reference', ...fields }, ...row });
const sample = (id = 'sample-01', observed = 10, fields = {}, row = {}) => ({ id, property_id: scope.propertyId, batch_id: scope.batchId, source_row: 1,
  crm_version_ids: ['crm-old'], record: { sample_id: `00-${id}`, sample_type: 'standard', lab_id: scope.labId, lab_batch_id: scope.labBatchId,
    crm_id: scope.crmId, crm_revision: scope.crmRevision, values: { Au: observed }, units: { Au: scope.unit }, raw_values: { Au: String(observed) }, bdl: {}, ...fields }, ...row });
const analyze = (records = [sample()], crms = [crm()], extra = {}) => analyzeCrmSnapshot({ scope, records, crms, complete: true, ...extra });

describe('supplied CRM reference arithmetic', () => {
  it('calculates supplied-SD bands and disjoint categories without estimating SD', () => {
    expect(crmReferenceComparison(15, 10, 2)).toEqual({ z: 2.5, bands: { lower3: 4, lower2: 6, expected: 10, upper2: 14, upper3: 16 }, category: 'outside2Within3' });
    expect(crmReferenceComparison(10, 10, 2).category).toBe('within2');
    expect(crmReferenceComparison(17, 10, 2).category).toBe('outside3');
    expect(crmReferenceComparison(3, 10, 2).category).toBe('outside3');
  });

  it('includes both boundaries, without using rounded values', () => {
    for (const observed of [6, 14]) expect(crmReferenceComparison(observed, 10, 2).category).toBe('within2');
    for (const observed of [4, 16]) expect(crmReferenceComparison(observed, 10, 2).category).toBe('outside2Within3');
    expect(crmReferenceComparison(14 + 1e-10, 10, 2).category).toBe('outside2Within3');
    expect(crmReferenceComparison(16 + 1e-10, 10, 2).category).toBe('outside3');
    expect((16 + 1e-10).toFixed(2)).toBe('16.00');
  });

  it('handles decimal boundary arithmetic at small and large scales symmetrically', () => {
    for (const scale of [1e-100, 1e-6, 1, 1e9]) {
      for (const observed of [0.9, 1.3]) expect(crmReferenceComparison(observed * scale, 1.1 * scale, 0.1 * scale).category).toBe('within2');
      for (const observed of [0.8, 1.4]) expect(crmReferenceComparison(observed * scale, 1.1 * scale, 0.1 * scale).category).toBe('outside2Within3');
      expect(crmReferenceComparison(1.400000001 * scale, 1.1 * scale, 0.1 * scale).category).toBe('outside3');
    }
  });

  it('allows uncensored zero and negative mathematical lower bands', () => {
    expect(crmReferenceComparison(0, 0, 1)).toEqual({ z: 0, bands: { lower3: -3, lower2: -2, expected: 0, upper2: 2, upper3: 3 }, category: 'within2' });
    expect(crmReferenceComparison(0, 10, 2)).toMatchObject({ z: -5, category: 'outside3' });
  });

  it('is invariant under positive unit-scale arithmetic without performing conversions', () => {
    for (const factor of [0.0001, 0.5, 2, 1000]) {
      const x = crmReferenceComparison(7 * factor, 10 * factor, 2 * factor);
      expect(x.z).toBeCloseTo(-1.5, 12); expect(x.category).toBe('within2');
    }
  });

  it('rejects invalid inputs and numerical overflow or collapsed reference bands', () => {
    for (const [x, mu, sd] of [[-1, 1, 1], [1, -1, 1], [1, 1, 0], [1, 1, -1], [null, 1, 1], ['1', 1, 1], [Infinity, 1, 1], [1, 1, NaN], [1e12, 1, 1], [1, 1e12, 1], [1, 1, 1e12], [1, 0, 1e-320], [1e11, 1e11, 1e-6], [0, 0, Number.MIN_VALUE]]) {
      expect(crmReferenceComparison(x, mu, sd)).toBeNull();
    }
    expect(crmReferenceComparison(1e-200, 2e-200, 1e-201)).not.toBeNull();
    expect(crmReferenceComparison(1e-320, 0, 1e10)).toBeNull();
    expect(crmReferenceComparison(0, 1e-320, 1e10)).toBeNull();
    expect(crmReferenceComparison(1e-320, 1e-320, 1e10).z).toBe(0);
    for (const scale of [1e-8, 1]) {
      expect(crmReferenceComparison(100000000000.00085 * scale, 100000000000 * scale, 0.0004 * scale)).toBeNull();
      expect(crmReferenceComparison(99999999999.99915 * scale, 100000000000 * scale, 0.0004 * scale)).toBeNull();
    }
  });
});

describe('historical CRM snapshot analysis', () => {
  it('uses only exact pinned definitions, preserving source order and reference metadata', () => {
    const records = [sample('b', 15, {}, { source_row: 9 }), sample('a', 10, { raw_values: { Au: '10.000' } }, { source_row: 2 })];
    const historical = crm('crm-old', {}, { superseded_by_batch: 'withdrawal-import' });
    const result = analyze(records, [crm('crm-current', { expected: 100, sd: 1 }), historical]);
    expect(result.points.map(p => p.id)).toEqual(['a', 'b']);
    expect(result.points[0]).toMatchObject({ sourceRow: 2, observed: { raw: '10.000' }, reference: { recordId: 'crm-old', expected: 10, sd: 2, source: 'Synthetic supplied reference', batchId: 'crm-import', sourceRow: 1 }, z: 0, status: 'descriptive' });
    expect(result.points[1].z).toBe(2.5);
    expect(result).not.toHaveProperty('passed'); expect(result).not.toHaveProperty('failed');
  });

  it('resolves multi-element pins by exact identity, never array position or latest revision', () => {
    const copper = crm('cu', { element: 'Cu', unit: '%' });
    const result = analyze([sample('a', 10, {}, { crm_version_ids: ['cu', 'crm-old'] })], [copper, crm()]);
    expect(result.points[0].reference.recordId).toBe('crm-old');
    expect(analyze([sample()], [crm('different-id')]).excluded[0].reason).toBe('missing_reference');
    expect(analyze([sample()], [crm('crm-old', { revision: 'different' })]).excluded[0].reason).toBe('reference_mismatch');
  });

  it('retains repeated identical definitions by their distinct pinned UUIDs', () => {
    const result = analyze([sample('a'), sample('b', 12, {}, { source_row: 3, crm_version_ids: ['reimport'] })], [crm(), crm('reimport')]);
    expect(result.points.map(p => p.reference.recordId)).toEqual(['crm-old', 'reimport']);
    expect(result.eligibleCount).toBe(2);
  });

  it('never exposes an out-of-property reference or accepts ambiguous pins', () => {
    const foreign = analyze([sample()], [crm('crm-old', { source: 'PRIVATE FOREIGN SOURCE' }, { property_id: 'other-property' })]);
    expect(foreign.excluded[0]).toMatchObject({ reason: 'reference_mismatch', reference: null });
    expect(JSON.stringify(foreign)).not.toContain('PRIVATE FOREIGN SOURCE');
    for (const pins of [['crm-old', 'crm-old'], ['crm-old', 'another']]) {
      expect(analyze([sample('a', 10, {}, { crm_version_ids: pins })], [crm(), crm('another')]).excluded[0].reason).toBe('ambiguous_reference');
    }
  });

  it('separates exact selection from missing-element/unit exclusions', () => {
    const controls = [sample('ok'), sample('missing', 1, { values: { Cu: 1 }, units: { Cu: '%' } }, { crm_version_ids: [] }),
      sample('unit', 10, { units: { Au: 'ppm' } }, { crm_version_ids: [] }),
      ...[{ lab_id: 'Other' }, { lab_batch_id: 'Other' }, { crm_id: 'Other' }, { crm_revision: 'Other' }, { sample_type: 'blank' }].map((fields, i) => sample(`other-${i}`, 1, fields))];
    const result = analyze(controls);
    expect(result.batchRecordCount).toBe(8); expect(result.selectedCount).toBe(3);
    expect(result.excluded.map(p => p.reason)).toEqual(['missing_element', 'unit_mismatch']);
  });

  it('preserves numeric bounds beside raw ND, never scores censored or substituted results', () => {
    const result = analyze([sample('numeric-bound', 0.005, { raw_values: { Au: 'ND' }, bdl: { Au: 0.005 } }),
      sample('unknown-bound', null, { raw_values: { Au: '<DL' }, bdl: { Au: true } }),
      sample('false-flag', 10, { bdl: { Au: false } })]);
    expect(result.eligibleCount).toBe(0); expect(result.excludedByReason.censored).toBe(3);
    expect(result.excluded.find(p => p.id === 'numeric-bound').observed).toMatchObject({ raw: 'ND', value: 0.005, censored: true, detectionLimit: 0.005 });
    expect(result.excluded.find(p => p.id === 'unknown-bound').observed.detectionLimit).toBeNull();
    expect(result.excluded.every(p => !Object.hasOwn(p, 'z'))).toBe(true);
  });

  it('counts each exclusion once and uses disjoint assessed denominators', () => {
    const result = analyze([sample('within', 10), sample('between', 15), sample('outside', 17),
      sample('censored', null, { bdl: { Au: true } }), sample('invalid', -1), sample('raw', 10, { raw_values: {} }),
      sample('missing-reference', 10, {}, { crm_version_ids: [] })]);
    expect(result.selectedCount).toBe(7); expect(result.eligibleCount).toBe(3); expect(result.excludedCount).toBe(4);
    expect(Object.values(result.excludedByReason).reduce((a, b) => a + b, 0)).toBe(4);
    expect(Object.keys(result.excludedByReason)).toEqual(Object.keys(CRM_EXCLUSION_REASONS));
    for (const summary of Object.values(result.summaries)) expect(summary).toEqual({ count: 1, total: 3, percent: 100 / 3 });
    expect(Object.values(result.summaries).reduce((n, s) => n + s.count, 0)).toBe(result.eligibleCount);
  });

  it('keeps valid zero and makes invalid reference/numerical range explicit', () => {
    expect(analyze([sample('zero', 0)]).points[0].z).toBe(-5);
    for (const fields of [{ expected: -1 }, { sd: 0 }, { sd: Infinity }]) expect(analyze([sample()], [crm('crm-old', fields)]).excluded[0].reason).toBe('invalid_value');
    expect(analyze([sample()], [crm('crm-old', { expected: 0, sd: 1e-320 })]).excluded[0].reason).toBe('numerical_range');
  });

  it('returns null empty percentages and no numerical summaries for incomplete loads', () => {
    const empty = analyze([]);
    expect(empty.selectedCount).toBe(0);
    for (const summary of Object.values(empty.summaries)) expect(summary).toEqual({ count: 0, total: 0, percent: null });
    const partial = analyze([sample()], [crm()], { complete: false });
    expect(partial).toMatchObject({ complete: false, points: [], excluded: [], selectedCount: null, eligibleCount: null, summaries: null });
  });

  it('rejects unbounded/ambiguous/mis-scoped snapshot input and preserves its inputs', () => {
    const records = [sample()], crms = [crm()], original = structuredClone({ records, crms });
    analyze(records, crms); expect({ records, crms }).toEqual(original);
    expect(() => analyze(records, crms, { complete: undefined })).toThrow('completeness');
    expect(() => analyze(records, crms, { scope: { ...scope, unit: '' } })).toThrow('Choose');
    expect(() => analyze([sample('a', 1, {}, { property_id: 'other' })])).toThrow('identity');
    expect(() => analyze([sample(), sample()])).toThrow('Repeated');
    expect(() => analyze(records, [crm(), crm()])).toThrow('unique');
    expect(() => analyze(Array(5001).fill(sample()))).toThrow('5,000');
  });
});

describe('Shewhart failure rules in displayed submitted-row order', () => {
  const points = zs => zs.map(z => ({ z, category: Math.abs(z) > 3 ? 'outside3' : Math.abs(z) > 2 ? 'outside2Within3' : 'within2' }));
  const statuses = zs => crmControlRules(points(zs)).map(r => r.status);
  it('fails outside ±3 SD, warns on a single ±2 SD excursion and leaves ±2 SD boundaries unflagged', () => {
    expect(crmControlRules(points([3.5, -2.5, 0, 2]))).toEqual([{ status: 'fail', rules: ['outside3'] }, { status: 'warning', rules: [] },
      { status: 'none', rules: [] }, { status: 'none', rules: [] }]);
  });
  it('fails both members of two consecutive same-side ±2 SD excursions, never opposite sides or non-adjacent pairs', () => {
    expect(statuses([2.5, 2.1, 0])).toEqual(['fail', 'fail', 'none']);
    expect(statuses([-2.5, -2.9])).toEqual(['fail', 'fail']);
    expect(statuses([2.5, -2.5, 2.5])).toEqual(['warning', 'warning', 'warning']);
    expect(statuses([2.5, 0, 2.5])).toEqual(['warning', 'none', 'warning']);
    expect(crmControlRules(points([3.5, 2.5]))).toEqual([{ status: 'fail', rules: ['outside3', 'consecutive2'] }, { status: 'fail', rules: ['consecutive2'] }]);
    expect(crmControlRules([])).toEqual([]);
    expect(Object.keys(CRM_RULES)).toEqual(['outside3', 'consecutive2']);
  });
  it('applies rules in source-row order, skipping unassessed standards, with explicit rule summaries', () => {
    const result = analyze([sample('c', 15, {}, { source_row: 5 }), sample('a', 15, {}, { source_row: 1 }),
      sample('censored', null, { bdl: { Au: 0.005 }, raw_values: { Au: 'ND' } }, { source_row: 3 }), sample('d', 10, {}, { source_row: 7 }), sample('e', 17, {}, { source_row: 9 })]);
    expect(result.points.map(p => [p.id, p.control.status])).toEqual([['a', 'fail'], ['c', 'fail'], ['d', 'none'], ['e', 'fail']]);
    expect(result.points[0].control.rules).toEqual(['consecutive2']); expect(result.points[3].control.rules).toEqual(['outside3']);
    expect(result.excluded[0]).not.toHaveProperty('control');
    expect(result.rules).toEqual({ fail: { count: 3, total: 4, percent: 75 }, warning: { count: 0, total: 4, percent: 0 }, none: { count: 1, total: 4, percent: 25 } });
    expect(analyze([]).rules.fail).toEqual({ count: 0, total: 0, percent: null });
    expect(analyze([sample()], [crm()], { complete: false }).rules).toBeNull();
  });
  it('uses the boundary-tolerant category, so a 2 SD boundary pair does not fail', () => {
    const result = analyze([sample('a', 14), sample('b', 14, {}, { source_row: 2 }), sample('c', 14 + 1e-10, {}, { source_row: 3 })]);
    expect(result.points.map(p => p.control.status)).toEqual(['none', 'none', 'warning']);
  });
});
