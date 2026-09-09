import { describe, it, expect } from 'vitest';
import {
  parseWorldFile, boundsFromWorldFile, looksLikeLatLng, reprojectBounds, utmProjString, validBounds,
  leafletBounds, worldFileFor, isRasterName, isWorldFileName, rasterLayer, tileLayer, validateTileSource,
  tileLayerCredits,
} from '../src/utils/rasterOverlay.js';

// The magnetics image every target map is read against had no way in: uploads
// were vector only. A picture with a world file, or a picture and four edges,
// is now a layer under the claims — and exports from the same bounds.

describe('world files', () => {
  it('reads the six lines and places the image by pixel centres', () => {
    const wf = parseWorldFile('10\n0\n0\n-10\n593005\n6981995\n');
    expect(wf).toEqual({ a: 10, d: 0, b: 0, e: -10, c: 593005, f: 6981995 });
    const b = boundsFromWorldFile(wf, 200, 100);
    expect(b).toEqual({ west: 593000, east: 595000, south: 6981000, north: 6982000 });
    expect(looksLikeLatLng(b)).toBe(false);
  });

  it('boxes a rotated world file rather than warping it', () => {
    const wf = parseWorldFile('0\n1\n1\n0\n0\n0\n');
    const b = boundsFromWorldFile(wf, 100, 50);
    expect(b.east - b.west).toBeCloseTo(50, 5);
    expect(b.north - b.south).toBeCloseTo(100, 5);
  });

  it('rejects garbage', () => {
    expect(parseWorldFile('a\nb\nc')).toBeNull();
    expect(parseWorldFile('0\n0\n0\n0\n1\n1')).toBeNull();
    expect(boundsFromWorldFile(null, 10, 10)).toBeNull();
  });

  it('matches the world file to its image by stem', () => {
    const files = [{ name: 'Mag_RTP.png' }, { name: 'mag_rtp.pgw' }, { name: 'other.pgw' }];
    expect(worldFileFor('Mag_RTP.png', files).name).toBe('mag_rtp.pgw');
    expect(worldFileFor('nothing.png', files)).toBeNull();
    expect(isRasterName('grid.JPG')).toBe(true);
    expect(isWorldFileName('grid.jgw')).toBe(true);
    expect(isRasterName('grid.tif')).toBe(false);
  });
});

describe('reprojection', () => {
  it('passes lat/long through untouched', async () => {
    const b = { west: -133.1, east: -133.0, south: 61.4, north: 61.5 };
    expect(await reprojectBounds(b, 'EPSG:4326')).toEqual(b);
  });

  it('turns a UTM zone 8 box into Yukon longitudes', async () => {
    const b = await reprojectBounds({ west: 593000, east: 595000, south: 6981000, north: 6982000 }, utmProjString(8, 'N', 'NAD83'));
    expect(validBounds(b)).toBe(true);
    expect(b.west).toBeGreaterThan(-134);
    expect(b.east).toBeLessThan(-132);
    expect(b.south).toBeGreaterThan(62);
    expect(b.north).toBeLessThan(63.5);
    expect(b.east).toBeGreaterThan(b.west);
    expect(leafletBounds(b)).toEqual([[b.south, b.west], [b.north, b.east]]);
  });

  it('refuses edges that are not a place', () => {
    expect(validBounds({ west: 10, east: 5, south: 0, north: 1 })).toBe(false);
    expect(validBounds({ west: -200, east: 5, south: 0, north: 1 })).toBe(false);
    expect(validBounds({ west: 1, east: 2, south: 1, north: 2 })).toBe(true);
  });
});

describe('layers', () => {
  it('builds a raster layer no vector path will touch', () => {
    const l = rasterLayer({ id: 'r1', name: 'Mag_RTP.png', dataUri: 'data:image/png;base64,AA', width: 10, height: 10, bounds: { west: 1, east: 2, south: 1, north: 2 } });
    expect(l.type).toBe('raster');
    expect(l.geojson).toBeNull();
    expect(l.userStyled).toBe(true);
    expect(l.legend.enabled).toBe(false);
    expect(l.displayName).toBe('Mag_RTP');
    expect(l.raster.opacity).toBe(0.85);
  });

  it('validates a tile source before it becomes a layer', () => {
    expect(validateTileSource({ kind: 'xyz', url: 'http://host/{z}/{x}/{y}.png' })).toMatch(/https/);
    expect(validateTileSource({ kind: 'xyz', url: 'https://host/tiles/1/2/3.png' })).toMatch(/\{z\}/);
    expect(validateTileSource({ kind: 'xyz', url: 'https://host/{z}/{x}/{y}.png?apikey=abc' })).toMatch(/API key/);
    expect(validateTileSource({ kind: 'xyz', url: 'https://host/{z}/{x}/{y}.png' })).toBe('');
    expect(validateTileSource({ kind: 'wms', url: 'https://host/geoserver/wms' })).toBe('');
  });

  it('keeps WMS parameters and credits the service on export', () => {
    const l = tileLayer({ id: 't1', name: '', kind: 'wms', url: 'https://host/wms ', layers: 'geo:mag', attribution: 'Yukon Geological Survey' });
    expect(l.tiles).toMatchObject({ kind: 'wms', url: 'https://host/wms', wms: { layers: 'geo:mag', transparent: true } });
    expect(l.displayName).toBe('WMS layer');
    expect(tileLayerCredits([l])).toEqual(['WMS layer: Yukon Geological Survey']);
    const anon = tileLayer({ id: 't2', kind: 'xyz', url: 'https://tiles.example.org/{z}/{x}/{y}.png' });
    expect(tileLayerCredits([anon, { ...anon, visible: false }])).toEqual(['Tile layer: tiles.example.org']);
  });
});
