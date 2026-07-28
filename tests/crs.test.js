import { describe, it, expect } from 'vitest';
import {
  detectCRS, isProjected, reprojectGeoJSON, boundsLookSane, SUPPORTED_CRS,
} from '../src/hooks/useFileParser';

// P0-11: the importer used to assume ANY projected coordinate was BC Albers.
// A UTM or Web Mercator file then landed somewhere plausible but wrong.

const fc = (coords, extra = {}) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords } }],
  ...extra,
});

describe('projected detection', () => {
  it('recognises lon/lat as unprojected', () => {
    expect(isProjected(fc([-123.1, 49.3]))).toBe(false);
  });
  it('recognises metre-scale coordinates as projected', () => {
    expect(isProjected(fc([1200000, 460000]))).toBe(true);
  });
  it('handles an empty collection without throwing', () => {
    expect(isProjected({ type: 'FeatureCollection', features: [] })).toBe(false);
  });
});

describe('CRS detection — only from trustworthy declarations', () => {
  it('reads a GeoJSON named CRS', () => {
    expect(detectCRS(fc([1200000, 460000], { crs: { properties: { name: 'urn:ogc:def:crs:EPSG::3005' } } }))).toBe('EPSG:3005');
  });

  it('reads CRS84 as WGS84', () => {
    expect(detectCRS(fc([-123, 49], { crs: { properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } }))).toBe('EPSG:4326');
  });

  it('reads an EPSG AUTHORITY from a .prj', () => {
    const prj = 'PROJCS["NAD83 / UTM zone 11N",GEOGCS["NAD83"],AUTHORITY["EPSG","26911"]]';
    expect(detectCRS(fc([500000, 5400000], { __prj: prj }))).toBe('EPSG:26911');
  });

  it('reads a NAD83 UTM zone from .prj text', () => {
    const prj = 'PROJCS["NAD_1983_UTM_Zone_10N",GEOGCS["GCS_North_American_1983"],PROJECTION["Transverse_Mercator"]]';
    expect(detectCRS(fc([500000, 5400000], { __prj: prj }))).toBe('EPSG:26910');
  });

  it('reads BC Albers from .prj text', () => {
    const prj = 'PROJCS["NAD_1983_BC_Albers",PROJECTION["Albers"]]';
    expect(detectCRS(fc([1200000, 460000], { __prj: prj }))).toBe('EPSG:3005');
  });

  it('reads Web Mercator from .prj text', () => {
    const prj = 'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere"]';
    expect(detectCRS(fc([-13700000, 6300000], { __prj: prj }))).toBe('EPSG:3857');
  });

  // THE regression guard: no declaration means no guess.
  it('returns null when nothing declares the CRS', () => {
    expect(detectCRS(fc([1200000, 460000]))).toBeNull();
  });

  it('returns null for a bare projected file even with plausible BC Albers values', () => {
    // These ARE valid BC Albers numbers — previously auto-converted.
    expect(detectCRS(fc([1500000, 600000]))).toBeNull();
  });
});

describe('reprojection correctness', () => {
  it('BC Albers converts into British Columbia', () => {
    const out = reprojectGeoJSON(fc([1200000, 460000]), 'EPSG:3005');
    const [lon, lat] = out.features[0].geometry.coordinates;
    expect(lon).toBeGreaterThan(-130); expect(lon).toBeLessThan(-114);
    expect(lat).toBeGreaterThan(48); expect(lat).toBeLessThan(60);
  });

  it('UTM zone 11N converts into western North America', () => {
    const out = reprojectGeoJSON(fc([500000, 5400000]), 'EPSG:26911');
    const [lon, lat] = out.features[0].geometry.coordinates;
    expect(lon).toBeGreaterThan(-120); expect(lon).toBeLessThan(-114);
    expect(lat).toBeGreaterThan(47); expect(lat).toBeLessThan(50);
  });

  it('the SAME coordinates land in DIFFERENT places under different CRS', () => {
    // This is exactly the silent-corruption the old code caused.
    const coords = [500000, 5400000];
    const asUtm = reprojectGeoJSON(fc(coords), 'EPSG:26911').features[0].geometry.coordinates;
    const asAlbers = reprojectGeoJSON(fc(coords), 'EPSG:3005').features[0].geometry.coordinates;
    const kmApart = Math.hypot(asUtm[0] - asAlbers[0], asUtm[1] - asAlbers[1]);
    expect(kmApart).toBeGreaterThan(1); // degrees — far apart
  });

  it('WGS84 input passes through untouched', () => {
    const input = fc([-123.1, 49.3]);
    expect(reprojectGeoJSON(input, 'EPSG:4326')).toBe(input);
  });

  it('handles polygons and multipolygons at depth', () => {
    const poly = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [[[1200000, 460000], [1200100, 460000], [1200100, 460100], [1200000, 460000]]] },
      }],
    };
    const out = reprojectGeoJSON(poly, 'EPSG:3005');
    for (const [lon, lat] of out.features[0].geometry.coordinates[0]) {
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
  });
});

describe('post-conversion sanity check', () => {
  it('accepts in-world coordinates', () => {
    expect(boundsLookSane(fc([-123.1, 49.3]))).toBe(true);
  });
  it('rejects out-of-world coordinates', () => {
    expect(boundsLookSane(fc([999, 999]))).toBe(false);
  });
});

describe('supported CRS list', () => {
  it('covers Canadian and US UTM zones plus BC Albers and Web Mercator', () => {
    const codes = SUPPORTED_CRS.map((c) => c.code);
    expect(codes).toContain('EPSG:3005');
    expect(codes).toContain('EPSG:3857');
    expect(codes).toContain('EPSG:26910'); // NAD83 UTM 10N (BC)
    expect(codes).toContain('EPSG:32612'); // WGS84 UTM 12N (US Rockies)
  });
});
