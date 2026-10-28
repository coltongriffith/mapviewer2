import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { layerCollection, layerCsv, layerDataFile } from '../src/utils/layerDataExport';
import { blobAs } from '../src/utils/svg';

const feature = (properties, geometry = { type: 'Point', coordinates: [-129.123456789012, 55.123456789012, 0] }) =>
  ({ type: 'Feature', id: '001', properties, geometry });
const collection = features => ({ type: 'FeatureCollection', features });

describe('saved map layer data', () => {
  it('preserves full precision, geometry, metadata and all properties in GeoJSON without changing the layer', async () => {
    const layer = { name: 'Hidden collars', visible: false, geojson: { ...collection([feature({ hole: '001', value: null, nested: { a: [0, false] }, text: '=1+1' })]), bbox: [-130, 55, -129, 56] } };
    const before = JSON.stringify(layer);
    const result = layerDataFile(layer, 'geojson', 'My map');
    expect(result.filename).toBe('My map-Hidden collars.geojson');
    expect(JSON.parse(await blobAs(result.blob, 'text'))).toEqual(layer.geojson);
    expect(JSON.stringify(layer)).toBe(before);
  });
  it('round-trips mixed attributes, quotes/newlines, geometry and point coordinates through CSV', () => {
    const line = { type: 'LineString', coordinates: [[1, 2], [3, 4]] };
    const data = collection([feature({ text: 'copper,"gold"\nnext', '__geometry': 'original', '__longitude': 'original x', nested: { a: 1 }, value: -2.5 }), feature({ other: false }, line), feature(null, null)]);
    const rows = Papa.parse(layerCsv(data), { header: true, skipEmptyLines: true }).data;
    expect(rows).toHaveLength(3);
    expect(rows[0].__geometry).toBe('original');
    expect(JSON.parse(rows[0].__geometry_2)).toEqual(data.features[0].geometry);
    expect(rows[0].__longitude).toBe('original x');
    expect(rows[0].__longitude_2).toBe('-129.123456789012');
    expect(rows[0].__elevation).toBe('0');
    expect(rows[0].text).toBe('copper,"gold"\nnext');
    expect(rows[0].nested).toBe('{"a":1}');
    expect(rows[0].value).toBe('-2.5');
    expect(JSON.parse(rows[1].__geometry_2)).toEqual(line);
    expect(rows[1].__longitude_2).toBe('');
    expect(rows[1].other).toBe('false');
    expect(rows[2].__geometry_2).toBe('');
  });
  it('neutralizes formula strings and headers but preserves numeric negative values', () => {
    const data = collection([feature({ '=header': '@SUM(A1)', x: '\t=1+1', y: '-3', z: -3, plus: '+2' })]);
    const rows = Papa.parse(layerCsv(data), { skipEmptyLines: true }).data;
    expect(rows[0]).toContain("'=header");
    expect(rows[1]).toEqual(expect.arrayContaining(["'@SUM(A1)", "'\t=1+1", "'-3", '-3', "'+2"]));
  });
  it('supports empty collections and single features, and excludes external/raster-only data', () => {
    expect(layerCollection({ geojson: feature({}) }).features).toHaveLength(1);
    expect(layerCsv(collection([]))).toContain('__geometry');
    expect(layerCollection({ tiles: { url: 'https://example.test' } })).toBeNull();
    expect(() => layerDataFile({ geojson: null }, 'csv')).toThrow('no saved vector');
    expect(() => layerDataFile({ geojson: collection([]) }, 'png')).toThrow('CSV or GeoJSON');
  });
  it('uses safe filenames without traversing directories', () => {
    const result = layerDataFile({ name: '../collars:2026', geojson: collection([]) }, 'csv', 'A/B');
    expect(result.filename).toBe('A_B-.._collars_2026.csv');
  });
});
