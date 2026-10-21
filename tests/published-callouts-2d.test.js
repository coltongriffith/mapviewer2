import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { collarCallouts, releaseColumns, COLLAR_NOTE } from '../src/utils/publishedCallouts.js';

// The 2D adapter: a release table's approved results as callouts on their holes' collars, never at depth.
const data = Papa.parse(readFileSync('tests/fixtures/three-d/published-results.csv', 'utf8').trim(), { skipEmptyLines: true }).data;
const header = data[0], rows = data.slice(1);
const pt = (id, lng, lat, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { _holeid: id, ...extra } });
const collars = { id: 'L1', visible: true, geojson: { type: 'FeatureCollection', features: [pt('EX-021', -128.1, 57.9), pt('ex-014 ', -128.2, 57.8), pt('EX-099', -128.3, 57.7)] } };

describe('published results on a 2D map', () => {
  it('reads the release table\'s columns as the 3D page does', () => {
    expect(releaseColumns(header)).toMatchObject({ resultId: 0, hole: 1, from: 2, to: 3, length: 4, approved: 9, status: 12 });
  });

  it('puts each approved result on its collar, "incl." on its parent\'s callout, and says it is at the collar', () => {
    const { callouts, unmatched, problems } = collarCallouts(header, rows, [collars]);
    expect(callouts.map((c) => [c.resultId, c.holeId, c.anchor])).toEqual([['EX21-01', 'EX-021', { lat: 57.9, lng: -128.1 }], ['EX14-01', 'EX-014', { lat: 57.8, lng: -128.2 }], ['EX14-02', 'EX-014', { lat: 57.8, lng: -128.2 }]]);
    expect(callouts[0]).toMatchObject({ text: '508.00 m @ 0.5300000000000001% Cu, 0.1234567890123 g/t Au from 8.000 m', layerId: 'L1', featureId: 'L1:57.900000:-128.100000' });
    expect(callouts[0].subtext).toBe(`incl. 60.0 m @ 0.81% Cu from 120 m\nEX-021 8–516 m · published result, ${COLLAR_NOTE}`);
    expect(callouts[2].subtext).toBe(`EX-014 300–342 m · published result, ${COLLAR_NOTE}`);
    expect(unmatched).toEqual([]); // EX-022's only result is a draft
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining('EX14-02: the published length (40) is not To − From'), 'EX22-01 is "Draft", so it is not drawn.']));
  });

  it('names holes with approved results but no collar on the map, and skips hidden collars', () => {
    const hidden = { ...collars, featureOverrides: { 'EX-021': { hidden: true } }, geojson: { type: 'FeatureCollection', features: [{ ...pt('EX-021', 1, 2), id: 'EX-021' }, pt('EX-014', 3, 4)] } };
    const { callouts, unmatched } = collarCallouts(header, rows, [hidden]);
    expect(callouts.map((c) => c.resultId)).toEqual(['EX14-01', 'EX14-02']);
    expect(unmatched).toEqual(['EX-021']);
  });

  it('reads nothing from a table without result IDs (an assay file is never taken for one)', () => {
    const r = collarCallouts(['HoleID', 'From', 'To', 'Cu_pct'], [['EX-021', '0', '2', '0.5']], [collars]);
    expect(r).toEqual({ callouts: [], unmatched: [], problems: ['This table has no Result ID column, so it is not read as published results.'] });
  });
});
