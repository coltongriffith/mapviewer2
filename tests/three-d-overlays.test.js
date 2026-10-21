import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { parseOverlay, fromCSV, guessCrs, fromLatLon, crsName, pick, LL } from '../src/three-d/overlays.js';
import { clipLine, clipRing, densify, sightTest, drapeRuns } from '../src/three-d/drape.js';
import { ellipsePts, dimLength, lengthText, arrowShape, toPoint } from '../src/three-d/shapes.js';
import { shpToGeoJSON, prjName } from '../src/three-d/shp.js';
import { unzipDataFiles } from '../src/three-d/unzip.js';
import { parseCRS, ready, projFwd, projInv } from '../src/three-d/terrain.js';

const near = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
// The Example Ridge sample's overlays (fictional): a claims polygon, a fault line and 20 soil points.
const FIX = readFileSync('tests/fixtures/three-d/example-ridge-overlays.geojson', 'utf8');

describe('reading map overlays', () => {
  it('reads the Example Ridge fixture: one area, one line, twenty points, in the files\' metres', () => {
    const { feats, crs } = parseOverlay(FIX, 'example-ridge-overlays.geojson');
    expect(crs).toBeUndefined(); // the file names no coordinate system
    expect(feats.map((f) => f.g).join('')).toBe(`AL${'P'.repeat(20)}`);
    expect(feats[0].p).toEqual({ name: 'Example Ridge claims', tenure: 'ER-1094' });
    expect(feats[0].c[0][0]).toEqual([411840, 6421500]);
    expect(feats[2].p).toMatchObject({ sample: 'SS-001' });
    expect(guessCrs(feats, { x0: 411500, x1: 413100, y0: 6421200, y1: 6422400 }, false)).toBeNull();
  });
  it('splits multi-part geometries and collections, keeps holes, rounds and drops bad points', () => {
    const { feats } = parseOverlay({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { id: 7, nested: { a: 1 }, nil: null }, geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [10, 0], [10, 10], [0, 0]], [[2, 2], [3, 2], [3, 3], [2, 2]]], [[[20, 0], [30, 0], [30, 5], [20, 0]]]] } },
      { type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1.123456789, 2] }, { type: 'MultiLineString', coordinates: [[[0, 0], ['x', 1], [5, 5]]] }] } },
      { type: 'Feature', geometry: null },
    ] });
    expect(feats.map((f) => f.g)).toEqual(['A', 'A', 'P', 'L']);
    expect(feats[0].c).toHaveLength(2); // outer ring and its hole
    expect(feats[0].p).toEqual({ id: 7 }); // plain values only
    expect(feats[2].c).toEqual([1.1234568, 2]);
    expect(feats[3].c).toEqual([[0, 0], [5, 5]]);
  });
  it('takes the coordinate system a GeoJSON names', () => {
    expect(parseOverlay({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::26909' } }, features: [] }).crs).toBe('EPSG:26909');
    expect(crsName('urn:ogc:def:crs:OGC:1.3:CRS84')).toBe(LL);
    expect(crsName('EPSG:4326')).toBe(LL);
    expect(crsName('')).toBeNull();
  });
  it('reads KML placemarks: names, extended data, points, lines and polygons with holes, in latitude/longitude', () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name><![CDATA[Target A & B]]></name><ExtendedData><Data name="grade"><value>1.2</value></Data><SchemaData><SimpleData name="type">soil</SimpleData></SchemaData></ExtendedData>
        <Point><coordinates>-127.5,55.25,0</coordinates></Point></Placemark>
      <Placemark><name>Fault</name><LineString><coordinates>-127.5,55.2 -127.4,55.3</coordinates></LineString></Placemark>
      <Placemark><name>Claim</name><MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>0.2,0.1 0.3,0.1 0.3,0.2 0.2,0.1</coordinates></LinearRing></innerBoundaryIs></Polygon></MultiGeometry></Placemark>
    </Document></kml>`;
    const { feats, crs } = parseOverlay(kml, 'targets.kml');
    expect(crs).toBe(LL);
    expect(feats.map((f) => f.g)).toEqual(['P', 'L', 'A']);
    expect(feats[0]).toEqual({ g: 'P', c: [-127.5, 55.25], p: { name: 'Target A & B', grade: '1.2', type: 'soil' } });
    expect(feats[2].c).toHaveLength(2);
  });
  it('rejects text that is neither GeoJSON nor KML', () => {
    expect(() => parseOverlay('HoleID,East', 'x.json')).toThrow(/not GeoJSON or KML/);
  });
  it('reads a CSV of points given the overlay type, in metres or latitude/longitude', () => {
    const f = { name: 'soil.csv', header: ['Sample', 'East', 'North', 'Cu'], rows: [['S1', '100', '200', '45'], ['S2', '', '210', '5']], cols: { east: 1, north: 2 } };
    expect(fromCSV(f)).toEqual({ feats: [{ g: 'P', c: [100, 200], p: { Sample: 'S1', East: '100', North: '200', Cu: '45' } }], crs: null });
    expect(fromCSV({ ...f, cols: { lat: 2, lon: 1 } }).crs).toBe(LL);
    expect(() => fromCSV({ ...f, cols: {} })).toThrow(/easting and northing/);
  });
  it('draws a line overlay from the lines, or from the areas\' outlines when a file has no lines', () => {
    const feats = parseOverlay(FIX).feats;
    expect(pick('line', feats).map((f) => f.g)).toEqual(['L']);
    expect(pick('line', feats.filter((f) => f.g !== 'L')).map((f) => f.g)).toEqual(['A']);
    expect(pick('fill', feats)).toHaveLength(1);
    expect(pick('points', feats)).toHaveLength(20);
  });
});

describe('placing overlays', () => {
  it('takes coordinates as latitude/longitude only when they could be and the drilling is elsewhere', () => {
    const ll = [{ g: 'P', c: [-127.5, 55.2] }], B = { x0: 411500, x1: 413100, y0: 6421200, y1: 6422400 };
    expect(guessCrs(ll, B, false)).toBe(LL);
    expect(guessCrs(ll, null, false)).toBe(LL);
    expect(guessCrs([{ g: 'P', c: [50, 60] }], { x0: 0, x1: 500, y0: 0, y1: 400 }, false)).toBeNull(); // a local mine grid
    expect(guessCrs([{ g: 'P', c: [412000, 6421000] }], null, false)).toBeNull();
    expect(guessCrs([{ g: 'P', c: [-30, 20] }], { x0: -400, x1: 400, y0: -300, y1: 300 }, true)).toBe(LL); // collars in lat/lon
  });
  it('projects WGS 84 latitude/longitude like collars in latitude/longitude', () => {
    const o = { lat0: 55.2, lon0: -127.5 }, fwd = (x, y) => [o.lon0 + x / (Math.cos(o.lat0 * Math.PI / 180) * 111320), o.lat0 + y / 110540]; // studio.js geoFor
    const inv = fromLatLon(o);
    for (const [x, y] of [[0, 0], [350, -820], [-1200, 40]]) { const [a, b] = inv(...fwd(x, y)); near(a, x, 1e-6); near(b, y, 1e-6); }
  });
  it('projects latitude/longitude into a UTM figure with proj4, and back', async () => {
    const c = parseCRS('EPSG:26909', { code: LL, latlon: true }); await ready(c);
    const fwd = projFwd(c), inv = projInv(c), [x, y] = inv(-127.5, 55.25);
    expect(x).toBeGreaterThan(400000); expect(x).toBeLessThan(600000); expect(y).toBeGreaterThan(6100000);
    const [lon, lat] = fwd(x, y); near(lon, -127.5, 1e-7); near(lat, 55.25, 1e-7);
  });
});

describe('draping on the terrain', () => {
  const B = { x0: 0, x1: 100, y0: 0, y1: 100 };
  it('cuts lines and rings to the block', () => {
    expect(clipLine([[-50, 50], [150, 50]], B)).toEqual([[[0, 50], [100, 50]]]);
    expect(clipLine([[10, 10], [50, 50], [50, 150], [80, 150]], B)).toEqual([[[10, 10], [50, 50], [50, 100]]]);
    expect(clipLine([[10, 120], [90, 130]], B)).toEqual([]);
    const r = clipRing([[-50, -50], [50, -50], [50, 50], [-50, 50]], B);
    expect(r.map((p) => p.join()).sort()).toEqual(['0,0', '0,50', '50,0', '50,50']);
    expect(clipRing([[200, 200], [300, 200], [300, 300]], B)).toEqual([]);
  });
  it('samples along a line and closes rings', () => {
    expect(densify([[0, 0], [10, 0]], 2.5)).toEqual([[0, 0], [2.5, 0], [5, 0], [7.5, 0], [10, 0]]);
    expect(densify([[0, 0], [4, 0], [4, 3]], 10, true)).toEqual([[0, 0], [4, 0], [4, 3], [0, 0]]);
  });
  it('hides what a ridge stands in front of, and shows the rest', () => {
    const surf = (x) => (Math.abs(x - 50) < 5 ? 100 : 0), see = sightTest(B, surf, 100, { eye: [-1000, 50, 300] });
    expect(see(20, 50, 0)).toBe(true); // in front of the ridge
    expect(see(80, 50, 0)).toBe(false); // behind it
    expect(sightTest(B, surf, 100, { dir: [0, 0, 1] })(80, 50, 0)).toBe(true); // straight down
    expect(sightTest(B, surf, 100, { eye: [-1000, 50, 5000] })(80, 50, 0)).toBe(true); // from high above
  });
  it('drapes points on the surface and breaks the line where it is hidden', () => {
    const toScreen = (x, y, z) => [x, z, 0], runs = drapeRuns([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0, 9]], { surf: (x) => x * 10, toScreen, seen: (x) => x !== 2 });
    expect(runs).toEqual([[[0, 0], [1, 10]], [[3, 30], [4, 9]]]);
  });
});

describe('shape geometry', () => {
  it('lays an ellipse flat along its azimuth, or upright in its plane', () => {
    const flat = ellipsePts({ at: [100, 200], rx: 50, ry: 20, rotation: 90 }, 4);
    expect(flat).toHaveLength(5);
    flat.forEach((p, i) => { near(p[0], [150, 100, 50, 100, 150][i]); near(p[1], [200, 180, 200, 220, 200][i]); expect(p[2]).toBeUndefined(); });
    const up = ellipsePts({ at: [0, 0, 500], rx: 100, ry: 40, rotation: 0, vertical: true }, 4);
    up.forEach((p, i) => { near(p[0], 0); near(p[1], [100, 0, -100, 0, 100][i]); near(p[2], [500, 540, 500, 460, 500][i]); });
  });
  it('measures a dimension along the ground, or in 3D when both ends have elevations', () => {
    expect(dimLength([0, 0], [300, 400])).toBe(500);
    expect(dimLength([0, 0, 0], [300, 400, 1200])).toBe(1300);
    expect(dimLength([0, 0, 50], [300, 400])).toBe(500);
    expect(lengthText(1099.6)).toBe('1,100 m');
  });
  it('builds a wide arrow with its tip at the end', () => {
    const p = arrowShape([0, 0], [100, 0], 10, 20, 30);
    expect(p).toEqual([[0, 10], [70, 10], [70, 20], [100, 0], [70, -20], [70, -10], [0, -10]]);
    expect(arrowShape([0, 0], [20, 0], 10, 20, 30)[1][0]).toBe(8); // a short arrow keeps some shaft
  });
  it('reads points as arrays or objects, with an optional elevation', () => {
    expect(toPoint([412300.04, 6421800, 1100])).toEqual([412300, 6421800, 1100]);
    expect(toPoint({ east: 1, north: 2 })).toEqual([1, 2]);
    expect(toPoint([1, 2, null])).toEqual([1, 2]);
    expect(() => toPoint(['a', 2], 'from')).toThrow(/from must be/);
  });
});

// A shapefile written by hand: a polygon with a hole (clockwise outer, anticlockwise hole) and a point.
function shapefile() {
  const recs = [];
  const poly = [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]], n = poly.flat().length;
  const pb = new DataView(new ArrayBuffer(44 + 8 + n * 16)); pb.setInt32(0, 5, true); pb.setInt32(36, 2, true); pb.setInt32(40, n, true); pb.setInt32(44, 0, true); pb.setInt32(48, 5, true);
  poly.flat().forEach(([x, y], i) => { pb.setFloat64(52 + i * 16, x, true); pb.setFloat64(60 + i * 16, y, true); });
  recs.push(pb.buffer);
  const pt = new DataView(new ArrayBuffer(20)); pt.setInt32(0, 1, true); pt.setFloat64(4, 5.5, true); pt.setFloat64(12, 6.5, true); recs.push(pt.buffer);
  const shp = new Uint8Array(100 + recs.reduce((s, r) => s + 8 + r.byteLength, 0)), v = new DataView(shp.buffer); let o = 100;
  recs.forEach((r, i) => { v.setInt32(o, i + 1); v.setInt32(o + 4, r.byteLength / 2); shp.set(new Uint8Array(r), o + 8); o += 8 + r.byteLength; });
  // DBF: two fields (NAME C 10, CU N 6), two records.
  const dbf = new Uint8Array(32 + 64 + 1 + 2 * 17), d = new DataView(dbf.buffer); d.setUint32(4, 2, true); d.setUint16(8, 97, true); d.setUint16(10, 17, true);
  dbf.set(strToU8('NAME'), 32); dbf[43] = 67; dbf[48] = 10; dbf.set(strToU8('CU'), 64); dbf[75] = 78; dbf[80] = 6; dbf[96] = 0x0d;
  [['Claim 1', '12.5'], ['Soil 7', '310']].forEach(([n, c], i) => dbf.set(strToU8(` ${n.padEnd(10)}${c.padStart(6)}`), 97 + i * 17));
  return { shp, dbf };
}
describe('zipped shapefiles', () => {
  it('reads polygons with holes, points and their attributes', () => {
    const { shp, dbf } = shapefile(), g = shpToGeoJSON(shp.buffer, dbf.buffer, 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]');
    expect(g.crs.properties.name).toBe(LL);
    expect(g.features.map((f) => f.geometry.type)).toEqual(['Polygon', 'Point']);
    expect(g.features[0].geometry.coordinates).toHaveLength(2);
    expect(g.features.map((f) => f.properties)).toEqual([{ NAME: 'Claim 1', CU: 12.5 }, { NAME: 'Soil 7', CU: 310 }]);
    expect(g.features[1].geometry.coordinates).toEqual([5.5, 6.5]);
  });
  it('names a projected .prj so the page can place it', () => {
    expect(prjName('PROJCS["NAD_1983_UTM_Zone_9N",GEOGCS["GCS_North_American_1983"]]')).toBe('NAD 83 UTM Zone 9N');
    expect(parseCRS(prjName('PROJCS["NAD_1983_UTM_Zone_9N",GEOGCS[]]'), { code: LL, latlon: true }).code).toBe('EPSG:26909');
    expect(prjName('')).toBeNull();
  });
  it('turns a shapefile in a ZIP into one GeoJSON overlay file, beside the drill files', () => {
    const { shp, dbf } = shapefile();
    const zip = zipSync({ 'claims/Claims.shp': shp, 'claims/Claims.dbf': dbf, 'claims/Claims.shx': new Uint8Array(4), 'collars.csv': strToU8('HoleID,East,North\nA,1,2') });
    const files = unzipDataFiles(zip.buffer);
    expect(files.map((f) => f.name)).toEqual(['collars.csv', 'Claims.geojson']);
    const { feats } = parseOverlay(files[1].text, files[1].name);
    expect(feats.map((f) => f.g)).toEqual(['A', 'P']);
  });
});
