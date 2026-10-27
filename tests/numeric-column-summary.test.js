import { describe, expect, it } from 'vitest';
import { pointColumnSnapshot, summarizePointColumn, MAX_SUMMARY_COLUMNS } from '../src/utils/numericColumnSummary.js';
import { MAX_FEATURES } from '../src/utils/importLimits.js';
import { toNumber, classIndexFor } from '../src/utils/classification.js';

const point = (value, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { value, ...extra } });
const source = (features) => ({ type: 'FeatureCollection', features });
const summary = (values) => summarizePointColumn(pointColumnSnapshot(source(values.map(v => point(v)))), 'value');

describe('Point column population and exact order statistics', () => {
  it('counts Point feature records once, without expanding MultiPoint or counting traces', () => {
    const points = [point(1, { id: 'duplicate' }), point(2, { id: 'duplicate' })];
    const geojson = source([...points, point(99, { _trace: true }), { ...point(100), geometry: { type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] } }, { ...point(101), geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } }, null]);
    const snapshot = pointColumnSnapshot(geojson);
    expect(snapshot.scope).toEqual({ total: 6, points: 2, traces: 1, multiPoint: 1, other: 2 });
    expect(snapshot.records).toEqual(points);
    expect(summarizePointColumn(snapshot, 'value').statistics).toEqual({ minimum: 1, p10: 1, p50: 1, p90: 2, maximum: 2 });
  });
  it('finds all columns, including late, blank-only and unusual names', () => {
    const snapshot = pointColumnSnapshot(source([...Array.from({ length: 501 }, () => point(1)), point(2, { 'Late column': 3, Empty: null, '': 4, _supplied: 5, constructor: 6 })]));
    expect(snapshot.fields).toEqual(['', 'Empty', 'Late column', '_supplied', 'constructor', 'value']);
    expect(summarizePointColumn(snapshot, 'Late column').counts).toEqual({ total: 502, numeric: 1, blank: 501, qualified: 0, other: 0 });
    expect(summarizePointColumn(snapshot, 'constructor').counts.blank).toBe(501);
    expect(summarizePointColumn(snapshot, '').statistics.p50).toBe(4);
  });
  it('uses disjoint exclusions and leaves finite numeric codes included', () => {
    const values = [null, undefined, '', ' \t', '<0.005', ' >=2', '≤0.2', '≥3', 'ND', '0,52', '1,000', true, {}, [], NaN, Infinity, '1e999', '0x10', -999, '-2.5', ' 1e-3 ', '.5', '5.', 0];
    const result = summary(values);
    expect(result.counts).toEqual({ total: 24, blank: 4, qualified: 4, other: 10, numeric: 6 });
    expect(result.statistics.minimum).toBe(-999);
    expect(result.statistics.maximum).toBe(5);
  });
  it('uses nearest rank, including even populations and ties, without nice-number rounding', () => {
    const result = summary([19.123456789, 1.23456789e-7, 7, 4]);
    expect(result.statistics).toEqual({ minimum: 1.23456789e-7, p10: 1.23456789e-7, p50: 4, p90: 19.123456789, maximum: 19.123456789 });
    expect(summary([3, 3, 3]).statistics).toEqual({ minimum: 3, p10: 3, p50: 3, p90: 3, maximum: 3 });
    expect(summary([7]).statistics.p10).toBe(7);
  });
  it('retains extreme finite values without subtraction overflow or spreading arrays', () => {
    expect(summary([Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 0]).statistics).toEqual({ minimum: -Number.MAX_VALUE, p10: -Number.MAX_VALUE, p50: 0, p90: Number.MAX_VALUE, maximum: Number.MAX_VALUE });
    const result = summary(Array.from({ length: MAX_FEATURES }, (_, i) => i));
    expect(result.counts.numeric).toBe(MAX_FEATURES);
    expect(result.statistics.p90).toBe(179999);
  });
  it('shows no statistics for empty/all-excluded populations and rejects partial inspection', () => {
    expect(summary([])).toBeNull();
    expect(summary(['<1', 'ND', '']).statistics).toBeNull();
    expect(pointColumnSnapshot(source(new Array(MAX_FEATURES + 1))).error).toMatch(/no partial summary/);
    expect(pointColumnSnapshot(point(1, Object.fromEntries(Array.from({ length: MAX_SUMMARY_COLUMNS }, (_, i) => [`c${i}`, i])))).error).toMatch(/none are silently omitted/);
    expect(pointColumnSnapshot(null).scope.total).toBe(0);
    expect(summarizePointColumn(pointColumnSnapshot(point(1)), null)).toBeNull();
  });
  it('never edits source values or legacy classification behavior', () => {
    const geojson = source([point('<0.0000005', { id: 'S.123456789' }), point(0.123456789)]);
    const before = JSON.stringify(geojson);
    for (const f of geojson.features) { Object.freeze(f.properties); Object.freeze(f); }
    Object.freeze(geojson.features); Object.freeze(geojson);
    summarizePointColumn(pointColumnSnapshot(geojson), 'value');
    expect(JSON.stringify(geojson)).toBe(before);
    expect(toNumber('0,52')).toBeNaN();
    const legacy = { field: 'value', mode: 'graduated', classes: [{ max: 1 }, { max: null }] };
    expect(classIndexFor(legacy, point('0,52'))).toBe(1);
    expect(classIndexFor({ ...legacy, numericPolicy: 'finite-decimal-v1' }, point('0,52'))).toBe(-1);
  });
});
