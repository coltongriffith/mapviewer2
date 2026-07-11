import { describe, it, expect } from 'vitest';
import {
  loadCSV, csvToGeoJSON, loadShapefileSet, applyShapefileProjection, validateGeoJSON,
} from '../src/utils/importers.js';

// ── fixtures ─────────────────────────────────────────────────────────────────

const UTM10N_WKT = 'PROJCS["WGS_1984_UTM_Zone_10N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-123.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
const WGS84_WKT = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/** Minimal valid point .shp binary (shape type 1). */
function buildPointShp(points) {
  const recordBytes = points.length * (8 + 20);
  const fileBytes = 100 + recordBytes;
  const buf = new ArrayBuffer(fileBytes);
  const dv = new DataView(buf);
  dv.setInt32(0, 9994, false);               // file code (BE)
  dv.setInt32(24, fileBytes / 2, false);     // file length in 16-bit words (BE)
  dv.setInt32(28, 1000, true);               // version (LE)
  dv.setInt32(32, 1, true);                  // shape type: Point (LE)
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  dv.setFloat64(36, Math.min(...xs), true);
  dv.setFloat64(44, Math.min(...ys), true);
  dv.setFloat64(52, Math.max(...xs), true);
  dv.setFloat64(60, Math.max(...ys), true);
  let o = 100;
  points.forEach(([x, y], i) => {
    dv.setInt32(o, i + 1, false);            // record number (BE)
    dv.setInt32(o + 4, 10, false);           // content length in words (BE)
    dv.setInt32(o + 8, 1, true);             // shape type Point
    dv.setFloat64(o + 12, x, true);
    dv.setFloat64(o + 20, y, true);
    o += 28;
  });
  return buf;
}

const fileOf = (content, name, type = 'application/octet-stream') =>
  new File([content], name, { type });

// ── shapefile projection handling ────────────────────────────────────────────

describe('shapefile projection handling', () => {
  it('imports a WGS84 shapefile unchanged', async () => {
    const shp = fileOf(buildPointShp([[-123.1, 49.2], [-122.9, 49.4]]), 'claims.shp');
    const prj = fileOf(WGS84_WKT, 'claims.prj');
    const fc = await loadShapefileSet([shp, prj]);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].geometry.coordinates[0]).toBeCloseTo(-123.1, 5);
  });

  it('reprojects a UTM shapefile with a .prj to WGS84', async () => {
    const shp = fileOf(buildPointShp([[500000, 5457000]]), 'claims.shp');
    const prj = fileOf(UTM10N_WKT, 'claims.prj');
    const fc = await loadShapefileSet([shp, prj]);
    const [lng, lat] = fc.features[0].geometry.coordinates;
    expect(lng).toBeCloseTo(-123.0, 3);
    expect(lat).toBeCloseTo(49.2658, 3);
  });

  it('rejects a projected shapefile WITHOUT a .prj with a useful error', async () => {
    const shp = fileOf(buildPointShp([[500000, 5457000]]), 'claims.shp');
    await expect(loadShapefileSet([shp])).rejects.toThrow(/no \.prj file was included/i);
  });

  it('rejects an unsupported .prj definition with a useful error', async () => {
    const shp = fileOf(buildPointShp([[500000, 5457000]]), 'claims.shp');
    const prj = fileOf('PROJCS["Totally_Bogus_Projection",NONSENSE[]]', 'claims.prj');
    await expect(loadShapefileSet([shp, prj])).rejects.toThrow(/isn't supported/i);
  });

  it('rejects mismatched component basenames', async () => {
    const shp = fileOf(buildPointShp([[-123, 49]]), 'claims.shp');
    const prj = fileOf(WGS84_WKT, 'roads.prj');
    await expect(loadShapefileSet([shp, prj])).rejects.toThrow(/different shapefile/i);
  });

  it('does not mutate the source FeatureCollection when reprojecting', async () => {
    const src = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [500000, 5457000] } }] };
    const out = await applyShapefileProjection(src, UTM10N_WKT);
    expect(src.features[0].geometry.coordinates).toEqual([500000, 5457000]);
    expect(out.features[0].geometry.coordinates[0]).toBeCloseTo(-123.0, 3);
  });
});

// ── CSV parsing (RFC 4180) ───────────────────────────────────────────────────

describe('CSV parsing', () => {
  it('handles commas inside quoted fields without shifting columns', async () => {
    const csv = 'HoleID,Company,Lat,Lon\nDH-01,"Acme Mining, Inc.",49.5,-122.7\nDH-02,"Smith, Jones & Co",49.6,-122.8\n';
    const result = await loadCSV(fileOf(csv, 'holes.csv', 'text/csv'));
    expect(result.needsMapping).toBeUndefined();
    expect(result.features).toHaveLength(2);
    expect(result.features[0].properties.Company).toBe('Acme Mining, Inc.');
    expect(result.features[0].geometry.coordinates).toEqual([-122.7, 49.5]);
  });

  it('handles escaped quotes, blank fields, CRLF line endings, and a UTF-8 BOM', async () => {
    const csv = '﻿HoleID,Note,Lat,Lon\r\nDH-01,"He said ""go north""",49.5,-122.7\r\nDH-02,,49.6,-122.8\r\n';
    const result = await loadCSV(fileOf(csv, 'holes.csv', 'text/csv'));
    expect(result.features).toHaveLength(2);
    expect(result.features[0].properties.Note).toBe('He said "go north"');
    expect(result.features[1].properties.Note).toBe('');
  });

  it('still supports tab-delimited files', async () => {
    const tsv = 'HoleID\tLat\tLon\nDH-01\t49.5\t-122.7\n';
    const result = await loadCSV(fileOf(tsv, 'holes.csv', 'text/csv'));
    expect(result.features).toHaveLength(1);
  });

  it('reports rows with invalid coordinates instead of silently dropping them', async () => {
    const csv = 'HoleID,Lat,Lon\nDH-01,49.5,-122.7\nDH-02,not-a-number,-122.8\nDH-03,49.7,-122.9\n';
    const result = await loadCSV(fileOf(csv, 'holes.csv', 'text/csv'));
    expect(result.features).toHaveLength(2);
    expect(result.meta.skippedRows).toBe(1);
  });

  it('multiline quoted fields parse as one row', async () => {
    const csv = 'HoleID,Comment,Lat,Lon\nDH-01,"line one\nline two",49.5,-122.7\n';
    const result = await loadCSV(fileOf(csv, 'holes.csv', 'text/csv'));
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.Comment).toContain('line two');
  });

  it('UTM-looking values still route to the manual mapper with a hint', async () => {
    const csv = 'HoleID,Easting,Northing\nDH-01,500000,5457000\n';
    const result = await loadCSV(fileOf(csv, 'holes.csv', 'text/csv'));
    expect(result.needsMapping).toBe(true);
    expect(result.hint).toMatch(/projected/i);
  });
});

// ── GeoJSON validation ───────────────────────────────────────────────────────

describe('GeoJSON validation', () => {
  it('accepts a valid FeatureCollection', () => {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] };
    expect(validateGeoJSON(fc)).toBe(fc);
  });

  it('wraps a bare Feature and a bare geometry into FeatureCollections', () => {
    const f = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } };
    expect(validateGeoJSON(f).type).toBe('FeatureCollection');
    const g = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
    expect(validateGeoJSON(g).features[0].geometry).toBe(g);
  });

  it('rejects unrecognized root types', () => {
    expect(() => validateGeoJSON({ some: 'random json' })).toThrow(/not a recognized geojson/i);
    expect(() => validateGeoJSON({ type: 'Topology' })).toThrow(/not a recognized geojson/i);
  });

  it('rejects malformed coordinate structures', () => {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: 'nope' } }] };
    expect(() => validateGeoJSON(fc)).toThrow(/malformed/i);
    const fc2 = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Whatever', coordinates: [1, 2] } }] };
    expect(() => validateGeoJSON(fc2)).toThrow(/malformed|unrecognized/i);
  });

  it('accepts null geometry and GeometryCollection', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: null },
        { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2] }] } },
      ],
    };
    expect(validateGeoJSON(fc)).toBe(fc);
  });
});

// ── csvToGeoJSON column mapping (existing behaviour preserved) ───────────────

describe('csvToGeoJSON', () => {
  it('keeps the manual mapping workflow intact', () => {
    const rows = [{ E: '-122.7', N: '49.5', Hole: 'DH-01' }];
    const fc = csvToGeoJSON(rows, { x: 'E', y: 'N', id: 'Hole' });
    expect(fc.features[0].geometry.coordinates).toEqual([-122.7, 49.5]);
    expect(fc.features[0].properties._holeid).toBe('DH-01');
  });
});
