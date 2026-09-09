import { describe, it, expect } from 'vitest';
import { addDrillTraces, traceEnd, destination, readOrientation, isTrace, hasDrillTraces } from '../src/utils/drillTraces.js';
import { csvToGeoJSON, loadCSV } from '../src/utils/importers.js';

// A collar file already carries azimuth, dip and length beside the
// coordinates. The column mapper offered them and then dropped them; nothing
// ever read them. A map of collars alone reads as untested ground.

const collar = (props, coords = [-133.0, 61.5]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: props });

describe('trace geometry', () => {
  it('steps north for azimuth 0 and east for azimuth 90', () => {
    const n = destination([-133, 61.5], 0, 1000);
    expect(n[1]).toBeGreaterThan(61.5);
    expect(Math.abs(n[0] + 133)).toBeLessThan(1e-6);
    const e = destination([-133, 61.5], 90, 1000);
    expect(e[0]).toBeGreaterThan(-133);
    expect(Math.abs(e[1] - 61.5)).toBeLessThan(1e-4);
  });

  it('uses the horizontal component of the hole length', () => {
    const flat = traceEnd([-133, 61.5], 90, 0, 200);
    const steep = traceEnd([-133, 61.5], 90, -60, 200);
    const dx = (p) => p[0] + 133;
    // cos(60°) = 0.5: the steep hole covers half the ground of the flat one.
    expect(dx(steep) / dx(flat)).toBeCloseTo(0.5, 2);
    // Dip sign is a convention, not a direction: -60 and 60 are the same hole.
    expect(traceEnd([-133, 61.5], 90, 60, 200)).toEqual(steep);
  });

  it('draws nothing for a vertical hole', () => {
    expect(traceEnd([-133, 61.5], 45, -90, 300)).toBeNull();
    expect(traceEnd([-133, 61.5], 45, -60, 0)).toBeNull();
  });
});

describe('readOrientation', () => {
  it('reads whatever the file called the column, case-insensitively', () => {
    expect(readOrientation({ AZ: '160' }, 'azimuth')).toBe(160);
    expect(readOrientation({ Inclination: -55 }, 'dip')).toBe(-55);
    expect(readOrientation({ Total_Depth: '250 m' }, 'length')).toBe(250);
    expect(readOrientation({ EOH: 180 }, 'length')).toBe(180);
    expect(Number.isNaN(readOrientation({ note: 'x' }, 'azimuth'))).toBe(true);
  });
});

describe('addDrillTraces', () => {
  it('adds a LineString beside every oriented collar and leaves the rest', () => {
    const fc = addDrillTraces({ type: 'FeatureCollection', features: [
      collar({ HoleID: 'TL-11-001', Az: 160, Dip: -60, Length_m: 250 }),
      collar({ HoleID: 'TL-11-002' }),
      collar({ HoleID: 'TL-11-003', Az: 160, Dip: -90, Length_m: 100 }),
    ] });
    const traces = fc.features.filter(isTrace);
    expect(traces.length).toBe(1);
    expect(fc.features.length).toBe(4);
    expect(fc.meta.traces).toBe(1);
    const t = traces[0];
    expect(t.geometry.type).toBe('LineString');
    expect(t.geometry.coordinates[0]).toEqual([-133.0, 61.5]);
    // The trace carries its collar's properties so a callout can name it,
    // and no id of its own so it shares the collar's identity.
    expect(t.properties.HoleID).toBe('TL-11-001');
    expect(t.properties._azimuth).toBe(160);
    expect(t.id).toBeUndefined();
    // The collar comes first so the layer still reads as a point layer.
    expect(fc.features[0].geometry.type).toBe('Point');
    expect(fc.features[1].geometry.type).toBe('LineString');
  });

  it('is idempotent and harmless on an unoriented file', () => {
    const once = addDrillTraces({ type: 'FeatureCollection', features: [collar({ Az: 10, Dip: -50, Length: 100 })] });
    expect(addDrillTraces(once)).toBe(once);
    const plain = { type: 'FeatureCollection', features: [collar({ HoleID: 'x' })] };
    expect(addDrillTraces(plain)).toBe(plain);
    expect(hasDrillTraces({ geojson: once })).toBe(true);
    expect(hasDrillTraces({ geojson: plain })).toBe(false);
  });
});

describe('CSV import carries orientation through', () => {
  it('normalises mapped columns and builds traces from them', () => {
    const rows = [
      { E: '-122.7', N: '49.5', Hole: 'DH-01', Bearing: '045', Incl: '-55', TD: '300' },
      { E: '-122.8', N: '49.6', Hole: 'DH-02', Bearing: '', Incl: '-55', TD: '300' },
    ];
    const fc = csvToGeoJSON(rows, { x: 'E', y: 'N', id: 'Hole', azimuth: 'Bearing', dip: 'Incl', length: 'TD' });
    const collars = fc.features.filter((f) => f.geometry.type === 'Point');
    expect(collars[0].properties).toMatchObject({ _holeid: 'DH-01', _azimuth: 45, _dip: -55, _length: 300 });
    expect(collars[1].properties._azimuth).toBeUndefined();
    expect(fc.features.filter(isTrace).length).toBe(1);
  });

  it('guesses the orientation columns from their headers', async () => {
    const csv = 'HoleID,Lat,Lon,Azimuth,Dip,Depth\nDH-01,49.5,-122.7,90,-60,200\n';
    const file = new File([csv], 'holes.csv', { type: 'text/csv' });
    const result = await loadCSV(file);
    // Lat/long headers are recognised, so this imports without the mapper,
    // and the traces come with it.
    expect(result.needsMapping).toBeUndefined();
    expect(result.features.filter(isTrace).length).toBe(1);
    expect(result.features[0].properties._length).toBe(200);
  });
});
