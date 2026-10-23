import { describe, expect, it } from 'vitest';
import { analyzeDuplicateSnapshot, hardPercent, originalRelativeBand } from '../shared/qaqcDuplicates';

const scope = { propertyId: 'property', batchId: 'import', sampleType: 'field_dup', labId: 'LAB-01', labBatchId: 'JOB-01', element: 'Au', unit: 'g/t' };
const record = (sample_id, sample_type, value) => ({ sample_id, sample_type, lab_id: scope.labId, lab_batch_id: scope.labBatchId,
  values: { Au: value }, units: { Au: 'g/t' }, raw_values: { Au: String(value) }, bdl: {} });
function pair(id = 'a', x = 90, y = 110, source_row = 1) {
  const parent = { id: `parent-${id}`, property_id: scope.propertyId, batch_id: 'parent-import', source_row: 20, record: record(`ORIGINAL-${id}`, 'routine', x) };
  const duplicate = { id, property_id: scope.propertyId, batch_id: scope.batchId, source_row,
    parent_version_id: parent.id, record: { ...record(`DUP-${id}`, scope.sampleType, y), parent_sample_id: parent.record.sample_id } };
  return { parent, duplicate };
}
const analyze = (pairs, overrides = {}) => analyzeDuplicateSnapshot({ scope, records: pairs.map(p => p.duplicate), parents: pairs.map(p => p.parent), complete: true, ...overrides });

describe('HARD arithmetic and clearly named reference bands', () => {
  it('uses half absolute relative difference, including exact zero behavior', () => {
    expect(hardPercent(90, 110)).toBe(10);
    expect(hardPercent(1, 1)).toBe(0);
    expect(hardPercent(1, 0)).toBe(100);
    expect(hardPercent(0, 0)).toBeNull();
    expect(hardPercent(1e-300, 2e-300)).toBeCloseTo(100 / 3, 12);
    for (const bad of [-1, NaN, Infinity, '1', null, 1e12]) expect(hardPercent(1, bad)).toBeNull();
  });
  it('is symmetric, bounded and scale invariant for deterministic positive pairs', () => {
    let seed = 7021;
    const next = () => { seed = (1664525 * seed + 1013904223) >>> 0; return (seed + 1) / 4294967296; };
    for (let i = 0; i < 200; i++) {
      const x = next() * 1000, y = next() * 1000;
      expect(hardPercent(x, y)).toBe(hardPercent(y, x));
      expect(hardPercent(x, y)).toBeGreaterThanOrEqual(0);
      expect(hardPercent(x, y)).toBeLessThanOrEqual(100);
      expect(hardPercent(x, y)).toBeCloseTo(hardPercent(x * 0.001, y * 0.001), 11);
    }
  });
  it('labels original-relative envelopes separately from HARD', () => {
    expect(originalRelativeBand(100, 0.1)).toEqual({ lower: 90, upper: 110.00000000000001 });
    expect(hardPercent(100, 110)).toBeCloseTo(4.7619047619, 9);
    expect(originalRelativeBand(100, 1)).toBeNull();
    expect(originalRelativeBand(-1, 0.1)).toBeNull();
  });
});

describe('one explicit immutable import group', () => {
  it('preserves the exact pinned historical parent, source metadata and raw strings', () => {
    const p = pair('001'); p.parent.superseded_by_batch = 'later-import';
    p.parent.record.raw_values.Au = '90.000'; p.duplicate.record.raw_values.Au = '110.00';
    const replacement = { ...p.parent, id: 'new-parent', record: record(p.parent.record.sample_id, 'routine', 500) };
    const input = { scope, records: [p.duplicate], parents: [replacement, p.parent], complete: true };
    const before = JSON.stringify(input), result = analyzeDuplicateSnapshot(input);
    expect(result.points[0]).toMatchObject({ id: '001', parentId: p.parent.id, hard: 10, x: 90, y: 110, status: 'descriptive',
      original: { recordId: p.parent.id, batchId: 'parent-import', sourceRow: 20, raw: '90.000' },
      duplicate: { sampleId: 'DUP-001', sourceRow: 1, raw: '110.00' } });
    expect(JSON.stringify(input)).toBe(before);
    expect(result).not.toHaveProperty('pass'); expect(result.points[0]).not.toHaveProperty('approved');
  });
  it('does not mix duplicate types, jobs or laboratories and counts absent elements as exclusions', () => {
    const pairs = ['keep', 'coarse', 'job', 'lab', 'element'].map(id => pair(id));
    pairs[1].duplicate.record.sample_type = 'coarse_dup'; pairs[2].duplicate.record.lab_batch_id = 'JOB-02'; pairs[3].duplicate.record.lab_id = 'LAB-02';
    delete pairs[4].duplicate.record.values.Au;
    const result = analyze(pairs);
    expect(result).toMatchObject({ batchRecordCount: 5, selectedCount: 2, eligibleCount: 1, excludedCount: 1 });
    expect(result.excluded[0].reason).toBe('missing_element');
  });
  it('keeps zero log exclusions distinct from undefined HARD', () => {
    const result = analyze([pair('regular'), pair('one-zero', 0, 2), pair('both-zero', 0, 0)]);
    expect(result).toMatchObject({ selectedCount: 3, eligibleCount: 2, excludedCount: 1, summaries: { hardCount: 2, logCount: 1, logExcludedCount: 1, within10: { count: 1, total: 2, percent: 50 } } });
    expect(result.points.find(p => p.id === 'one-zero')).toMatchObject({ hard: 100, logEligible: false });
    expect(result.excluded[0]).toMatchObject({ reason: 'zero_sum', status: 'unassessed' });
  });
  it('sorts source display and ranked ties deterministically, retaining unrounded thresholds', () => {
    const pairs = [pair('z', 90, 110, 3), pair('b', 90, 110, 2), pair('a', 80, 120, 1), pair('over', 89.999999, 110.000001, 4)];
    const result = analyze(pairs);
    expect(result.points.map(p => p.id)).toEqual(['a', 'b', 'z', 'over']);
    expect(result.ranked.map(p => p.id)).toEqual(['b', 'z', 'over', 'a']);
    expect(result.ranked.map(p => p.cumulativePercent)).toEqual([25, 50, 75, 100]);
    expect(result.summaries.within10).toEqual({ count: 2, total: 4, percent: 50 });
    expect(result.summaries.within20).toEqual({ count: 4, total: 4, percent: 100 });
    expect(analyze([...pairs].reverse()).ranked).toEqual(result.ranked);
  });
  it('returns null percentages for zero eligible pairs instead of fake success or failure', () => {
    const result = analyze([]);
    expect(result.summaries.within10).toEqual({ count: 0, total: 0, percent: null });
    expect(result.ranked).toEqual([]);
  });
  it.each([1e-300, 1e-266, 1e-100, 1e-12, 1, 1e11])('includes decimal cutoff pairs without display rounding at scale %s', scale => {
    for (const [x, y, cutoff] of [[0.9, 1.1, 10], [0.8, 1.2, 20]]) {
      const aboveX = x - 1e-12, aboveY = y + 1e-12;
      const result = analyze([
        pair('boundary', x * scale, y * scale), pair('boundary-swapped', y * scale, x * scale),
        pair('above', aboveX * scale, aboveY * scale), pair('above-swapped', aboveY * scale, aboveX * scale),
      ]);
      expect(result.summaries[`within${cutoff}`]).toEqual({ count: 2, total: 4, percent: 50 });
      const boundary = result.points.find(p => p.id === 'boundary');
      expect(boundary.hard).toBe(hardPercent(x * scale, y * scale));
      expect(result.points.find(p => p.id === 'boundary-swapped').hard).toBe(boundary.hard);
      // These genuinely above-cutoff values still round to the same visible
      // percentage; their exclusion proves this is not display rounding.
      const above = result.points.find(p => p.id === 'above');
      expect(above.hard.toFixed(8)).toBe(cutoff.toFixed(8));
      expect(above.hard - cutoff).toBeGreaterThan(4 * Number.EPSILON * cutoff);
    }
    if (scale === 1) expect(hardPercent(0.9, 1.1)).toBeGreaterThan(10);
  });
});

describe('explicit exclusions and snapshot boundaries', () => {
  it('uses one primary exclusion per pair and preserves reported censoring', () => {
    const pairs = ['missing', 'identity', 'element', 'unit', 'bdl', 'invalid', 'raw', 'zero'].map(id => pair(id));
    pairs[0].duplicate.parent_version_id = 'unavailable';
    pairs[1].parent.property_id = 'other-property';
    delete pairs[2].parent.record.values.Au;
    pairs[3].parent.record.units.Au = 'ppm';
    pairs[4].parent.record.bdl.Au = 0.005; pairs[4].parent.record.values.Au = 0.0025; pairs[4].parent.record.raw_values.Au = '<0.005';
    pairs[5].duplicate.record.values.Au = Infinity;
    delete pairs[6].duplicate.record.raw_values.Au;
    pairs[7].parent.record.values.Au = 0; pairs[7].duplicate.record.values.Au = 0;
    const result = analyze(pairs);
    expect(result.excluded.map(e => e.reason)).toEqual(['censored', 'missing_element', 'reference_mismatch', 'invalid_value', 'missing_parent', 'missing_raw', 'unit_mismatch', 'zero_sum']);
    expect(Object.values(result.excludedByReason).reduce((sum, n) => sum + n, 0)).toBe(8);
    expect(result.selectedCount).toBe(result.eligibleCount + result.excludedCount);
    expect(result.excluded.find(e => e.id === 'identity').original).toBeNull();
    expect(result.excluded.find(e => e.id === 'bdl').original).toMatchObject({ raw: '<0.005', censored: true, detectionLimit: 0.005 });
  });
  it('does not mistake a newer or different lab/job/sample parent for the exact reference', () => {
    for (const patch of [{ sample_type: 'standard' }, { lab_id: 'LAB-02' }, { lab_batch_id: 'JOB-02' }, { sample_id: 'another' }]) {
      const p = pair(); Object.assign(p.parent.record, patch);
      expect(analyze([p]).excluded[0].reason).toBe('reference_mismatch');
    }
    const p = pair(); p.parent.record.bdl = { Au: false }; // Presence is conservative even for malformed imported metadata.
    expect(analyze([p]).excluded[0].reason).toBe('censored');
  });
  it('refuses ambiguous, unbounded or cross-property snapshots and incomplete numerical reports', () => {
    const p = pair();
    expect(() => analyze([p], { scope: { ...scope, unit: '' } })).toThrow(/explicit/);
    expect(() => analyze([p], { complete: undefined })).toThrow(/completeness/);
    expect(analyze([p], { complete: false })).toMatchObject({ complete: false, selectedCount: null, eligibleCount: null, summaries: null, points: [], excluded: [] });
    expect(() => analyze([p, p])).toThrow(/Duplicate record IDs/);
    expect(() => analyze([p], { parents: [p.parent, p.parent] })).toThrow(/Duplicate parent/);
    expect(() => analyze([p], { records: Array(5001).fill(p.duplicate) })).toThrow(/5,000/);
    p.duplicate.property_id = 'other-property'; expect(() => analyze([p])).toThrow(/selected property/);
    p.duplicate.property_id = scope.propertyId; p.duplicate.source_row = 0; expect(() => analyze([p])).toThrow(/source row/);
  });
});
