import { describe, expect, it } from 'vitest';
import { analyzeBlankSnapshot, blankThresholdComparison, recordedDetectionLimits, validBlankMultiplier, BLANK_EXCLUSION_REASONS, BLANK_MULTIPLIER } from '../shared/qaqcBlanks.js';

// Synthetic controls only; these do not describe real assays.
const scope = { propertyId: 'property', batchId: 'import', sampleType: 'blank', labId: 'Lab', labBatchId: 'Job', element: 'Au', unit: 'g/t' };
const sample = (id, observed, fields = {}, row = {}) => ({ id, property_id: scope.propertyId, batch_id: scope.batchId, source_row: 1,
  record: { sample_id: `B-${id}`, sample_type: 'blank', lab_id: scope.labId, lab_batch_id: scope.labBatchId,
    values: { Au: observed }, units: { Au: scope.unit }, raw_values: { Au: String(observed) }, bdl: {}, ...fields }, ...row });
const bdl = (id, limit, fields = {}, row = {}) => sample(id, null, { raw_values: { Au: limit === true ? 'ND' : `<${limit}` }, bdl: { Au: limit }, ...fields }, row);
const routineLimit = (id, limit, row = {}) => bdl(id, limit, { sample_type: 'routine' }, row);
const analyze = (records, extra = {}) => analyzeBlankSnapshot({ scope, records, complete: true, ...extra });

describe('blank threshold arithmetic', () => {
  it('fails only above N × DL, with the threshold itself passing', () => {
    expect(blankThresholdComparison(0.025, 0.005, 5)).toMatchObject({ threshold: 0.025, outcome: 'pass' });
    expect(blankThresholdComparison(0.0251, 0.005, 5)).toMatchObject({ outcome: 'fail' });
    expect(blankThresholdComparison(0.0251, 0.005, 5).ratio).toBeCloseTo(5.02, 12);
    expect(blankThresholdComparison(0, 0.005, 5)).toEqual({ threshold: 0.025, ratio: 0, outcome: 'pass' });
    expect(blankThresholdComparison(0.016, 0.005, 3).outcome).toBe('fail');
    expect(blankThresholdComparison(0.016, 0.005, 10).outcome).toBe('pass');
  });
  it('allows decimal boundary arithmetic at small and large scales', () => {
    for (const scale of [1e-100, 1e-6, 1, 1e9]) {
      expect(blankThresholdComparison(0.3 * scale, 0.1 * scale, 3).outcome).toBe('pass');
      expect(blankThresholdComparison(0.30000001 * scale, 0.1 * scale, 3).outcome).toBe('fail');
    }
  });
  it('enforces 3–10× multiplier bounds and never assesses without a positive recorded limit', () => {
    for (const m of [3, 3.5, 5, 10]) expect(validBlankMultiplier(m)).toBe(true);
    for (const m of [2.999, 10.001, 0, -5, NaN, Infinity, '5', null, undefined]) {
      expect(validBlankMultiplier(m)).toBe(false);
      expect(() => blankThresholdComparison(1, 1, m)).toThrow('3 to 10');
    }
    expect(BLANK_MULTIPLIER).toEqual({ min: 3, max: 10, default: 5 });
    for (const [x, dl] of [[1, 0], [1, null], [1, -1], [1, true], [-1, 1], [null, 1], [Infinity, 1], [1e12, 1], [1, 1e-320]]) expect(blankThresholdComparison(x, dl, 5)).toBeNull();
  });
});

describe('historical blank snapshot analysis', () => {
  it('uses the default 5× threshold, source order, and lists failures above it', () => {
    const records = [sample('high', 0.03, {}, { source_row: 9 }), sample('low', 0.01, {}, { source_row: 2 }), bdl('nd', 0.005, {}, { source_row: 4 })];
    const result = analyze(records);
    expect(result.multiplier).toBe(5);
    expect(result.points.map(p => p.id)).toEqual(['low', 'nd', 'high']);
    expect(result.failures.map(p => p.id)).toEqual(['high']);
    expect(result.points[2]).toMatchObject({ detectionLimit: 0.005, detectionLimitSource: 'job', threshold: 0.025, outcome: 'fail', censored: false, status: 'assessed' });
    expect(result.summaries).toEqual({ pass: { count: 2, total: 3, percent: 200 / 3 }, fail: { count: 1, total: 3, percent: 100 / 3 }, censored: { count: 1, total: 3, percent: 100 / 3 } });
    expect(analyze(records, { multiplier: 10 }).failures).toEqual([]);
    expect(analyze(records, { multiplier: 3 }).failures.map(p => p.id)).toEqual(['high']);
  });
  it('counts below-detection blanks as passing but censored, without a substituted value or ratio', () => {
    const result = analyze([bdl('numeric', 0.005), bdl('flag', true, {}, { source_row: 2 })]);
    expect(result.points.map(p => [p.id, p.outcome, p.censored, p.ratio, p.detectionLimitSource])).toEqual([['numeric', 'pass', true, null, 'result'], ['flag', 'pass', true, null, 'job']]);
    expect(result.points[0].observed).toMatchObject({ raw: '<0.005', value: null, censored: true, detectionLimit: 0.005 });
    expect(result.summaries.censored.count).toBe(2);
  });
  it('leaves blanks unassessed without a recorded limit, and never chooses between different limits', () => {
    const missing = analyze([sample('detected', 0.01), bdl('flag', true, {}, { source_row: 2 })]);
    expect(missing.eligibleCount).toBe(0); expect(missing.excludedByReason.missing_detection_limit).toBe(2);
    expect(missing.excluded.every(p => p.detectionLimit === null && !Object.hasOwn(p, 'outcome'))).toBe(true);
    const ambiguous = analyze([sample('detected', 0.01), bdl('own', 0.005, {}, { source_row: 2 }), routineLimit('routine', 0.01, { source_row: 3 })]);
    expect(ambiguous.detectionLimits.values).toEqual([0.005, 0.01]);
    expect(ambiguous.excluded.map(p => [p.id, p.reason])).toEqual([['detected', 'ambiguous_detection_limit']]);
    expect(ambiguous.points.map(p => [p.id, p.detectionLimit])).toEqual([['own', 0.005]]);
  });
  it('takes job limits only from the same laboratory job, element and exact unit', () => {
    const records = [sample('detected', 0.01), routineLimit('routine', 0.005, { source_row: 2 }),
      routineLimit('other-job', 0.5, { source_row: 3, record: { ...routineLimit('x', 0.5).record, lab_batch_id: 'Other' } }),
      routineLimit('other-unit', 0.5, { source_row: 4, record: { ...routineLimit('x', 0.5).record, units: { Au: 'ppm' } } }),
      sample('other-element', null, { values: { Cu: null }, units: { Cu: 'g/t' }, raw_values: { Cu: '<0.5' }, bdl: { Cu: 0.5 }, sample_type: 'routine' }, { source_row: 5 })];
    const limits = recordedDetectionLimits(records, scope);
    expect(limits.values).toEqual([0.005]); expect(limits.sources).toEqual([{ recordId: 'routine', sampleId: 'B-routine', sampleType: 'routine', batchId: 'import', sourceRow: 2, raw: '<0.005', limit: 0.005 }]);
    const result = analyze(records);
    expect(result.selectedCount).toBe(1); expect(result.points[0]).toMatchObject({ id: 'detected', detectionLimit: 0.005, ratio: 2, outcome: 'pass' });
  });
  it('separates selection from element/unit/value/raw exclusions, counting each once', () => {
    const result = analyze([routineLimit('limit', 0.005), sample('ok', 0.01, {}, { source_row: 2 }),
      sample('missing', 1, { values: { Cu: 1 }, units: { Cu: 'g/t' }, raw_values: { Cu: '1' } }, { source_row: 3 }),
      sample('unit', 1, { units: { Au: 'ppm' } }, { source_row: 4 }), sample('invalid', -1, {}, { source_row: 5 }),
      sample('raw', 0.01, { raw_values: {} }, { source_row: 6 }), sample('other-lab', 1, { lab_id: 'Other' }, { source_row: 7 }),
      sample('high', 1, {}, { source_row: 8 })]);
    expect(result.batchRecordCount).toBe(8); expect(result.selectedCount).toBe(6); expect(result.eligibleCount).toBe(2);
    expect(result.excluded.map(p => p.reason)).toEqual(['missing_element', 'unit_mismatch', 'invalid_value', 'missing_raw']);
    expect(Object.keys(result.excludedByReason)).toEqual(Object.keys(BLANK_EXCLUSION_REASONS));
    expect(Object.values(result.excludedByReason).reduce((a, b) => a + b, 0)).toBe(result.excludedCount);
    expect(result.failures.map(p => p.id)).toEqual(['high']);
  });
  it('rejects unrepresentable ratios rather than rounding them', () => {
    const result = analyze([bdl('limit', 1e-320, { sample_type: 'routine' }), sample('detected', 1, {}, { source_row: 2 })]);
    expect(result.excluded.map(p => p.reason)).toEqual(['numerical_range']);
  });
  it('returns no statistics for incomplete loads and rejects mis-scoped or unbounded input', () => {
    expect(analyze([sample('a', 1)], { complete: false })).toMatchObject({ complete: false, points: [], selectedCount: null, summaries: null, detectionLimits: null });
    expect(analyze([]).summaries.fail).toEqual({ count: 0, total: 0, percent: null });
    const records = [sample('a', 1)], original = structuredClone(records); analyze(records); expect(records).toEqual(original);
    expect(() => analyze(records, { complete: undefined })).toThrow('completeness');
    expect(() => analyze(records, { scope: { ...scope, sampleType: 'standard' } })).toThrow('Choose');
    expect(() => analyze(records, { scope: { ...scope, unit: '' } })).toThrow('Choose');
    for (const multiplier of [2, 11, NaN, '5']) expect(() => analyze(records, { multiplier })).toThrow('3 to 10');
    expect(() => analyze([sample('a', 1, {}, { property_id: 'other' })])).toThrow('identity');
    expect(() => analyze([sample('a', 1), sample('a', 1)])).toThrow('Repeated');
    expect(() => analyze(Array(5001).fill(sample('a', 1)))).toThrow('5,000');
  });
});
