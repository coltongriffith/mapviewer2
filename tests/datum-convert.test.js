// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import proj4 from 'proj4';
import { convertCollars, DATUM_GRIDS, HELMERT_ERROR_M } from '../src/utils/datumConvert';

const get = async (url) => { const b = readFileSync(`public${url}`); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
const dms = (s) => { const [d, m, sec] = s.split(' ').map(Number); return d + m / 60 + sec / 3600; };
const utm = (zone, ellps, [lon, lat]) => proj4('+proj=longlat +ellps=' + ellps + ' +datum=none +no_defs', `+proj=utm +zone=${zone} +ellps=${ellps} +datum=none +units=m +no_defs`, [lon, lat]);
const metres = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const one = async (row, from, to, jurisdiction) => (await convertCollars([{ hole_id: 'CP', ...row }], from, to, { jurisdiction, get })).rows[0];

describe('NAD27 → NAD83 collar conversion', () => {
  it('ships the grid files the code expects', () => {
    for (const [key, g] of Object.entries(DATUM_GRIDS)) {
      const b = readFileSync(`public/grids/${key}.gsb`), v = new DataView(b.buffer, b.byteOffset, b.byteLength), s = (k) => v.getFloat64(176 + 16 * k + 8, true) / 3600;
      expect(createHash('sha256').update(b).digest('hex')).toBe(g.sha256);
      expect([-s(7), s(4), -s(6), s(5)]).toEqual(g.bbox);
    }
  });

  // Published NAD 27 and NAD 83(1986) positions from NGS datasheets
  // (https://www.ngs.noaa.gov/cgi-bin/ds_mark.prl?PidBox=<PID>, retrieved 2026-10-25),
  // converted to UTM on each datum's own ellipsoid. NADCON is NGS's own
  // NAD27→NAD83(1986) model, so US stations agree within 0.1 m.
  it.each([
    ['KG0640 Meades Ranch, KS', 14, 'us-ks', '39 13 26.68600', '98 32 30.50600', '39 13 26.71982', '98 32 31.74686'],
    ['LR0809 Lena, NV', 11, 'us-nv', '40 42 29.17240', '117 06 00.81050', '40 42 28.84313', '117 06 04.19411'],
    ['LR0374 Valmy 2, NV', 11, 'us-nv', '40 47 24.29790', '117 07 39.08850', '40 47 23.96207', '117 07 42.47926'],
  ])('%s within 0.1 m via NADCON', async (_name, zone, jurisdiction, la27, lo27, la83, lo83) => {
    const [x, y] = utm(zone, 'clrk66', [-dms(lo27), dms(la27)]);
    const r = await one({ x, y }, `EPSG:${26700 + zone}`, `EPSG:${26900 + zone}`, jurisdiction);
    expect(metres([r.x, r.y], utm(zone, 'GRS80', [-dms(lo83), dms(la83)]))).toBeLessThan(0.1);
    expect(r).toMatchObject({ x_src: x, y_src: y, crs_src: `EPSG:${26700 + zone}`, crs: `EPSG:${26900 + zone}`, transform: { method: 'grid', grid: 'us_noaa_conus.gsb' } });
  });

  // Canadian stations on the same NGS datasheets. Their NAD 27 values come from
  // the US network adjustment, not NRCan's, so NTv2 (and NADCON alike) agree
  // within 2.5 m rather than centimetres; the 3-parameter fallback is 3–12 m out.
  it.each([
    ['PH2248 Alouette, QC', 18, '45 00 24.83123', '74 09 57.31035', '45 00 24.95423', '74 09 55.92574'],
    ['TD1249 Altona, MB', 14, '49 07 06.95681', '97 30 22.48574', '49 07 06.94739', '97 30 23.62898'],
    ['TG1927 Agate, SK', 13, '49 01 29.38005', '103 50 42.30475', '49 01 29.46866', '103 50 44.05008'],
  ])('%s within 2.5 m via NRCan NTv2', async (_name, zone, la27, lo27, la83, lo83) => {
    const [x, y] = utm(zone, 'clrk66', [-dms(lo27), dms(la27)]);
    const r = await one({ x, y }, `EPSG:${26700 + zone}`, `EPSG:${26900 + zone}`, 'qc');
    expect(metres([r.x, r.y], utm(zone, 'GRS80', [-dms(lo83), dms(la83)]))).toBeLessThan(2.5);
    expect(r.transform).toMatchObject({ method: 'grid', source: expect.stringMatching(/NRCan/) });
  });

  // Reference: PROJ 9.8.1 `+proj=hgridshift +grids=ca_nrc_ntv2_0.tif` (the
  // unconverted CDN file), including Whitehorse's nested YUwhiteh subgrid.
  it.each([
    [[-123.1, 49.3], [-123.101321842, 49.299829886]], [[-120.3, 50.7], [-120.301250244, 50.699889114]],
    [[-135.05, 60.72], [-135.051873941, 60.719707493]], [[-81.0, 48.5], [-80.999898336, 48.500084981]],
    [[-77.8, 48.1], [-77.799748957, 48.100091672]], [[-128.7, 57.7], [-128.7018019, 57.699812853]],
  ])('NAD27 %j matches PROJ within 1 cm', async (from, expected) => {
    const r = await one({ x: from[0], y: from[1] }, 'EPSG:4267', 'EPSG:4269', 'bc');
    expect(metres([(r.x - expected[0]) * Math.cos(from[1] * Math.PI / 180), r.y - expected[1]], [0, 0]) * 111195).toBeLessThan(0.01);
  });
});

describe('fallbacks and other datums', () => {
  it('outside grid coverage falls back to a 3-parameter shift that needs acknowledgment', async () => {
    const result = await convertCollars([{ hole_id: 'MX-1', x: -110, y: 18 }, { hole_id: 'NV-1', x: -117.1, y: 40.7 }], 'EPSG:4267', 'EPSG:4269', { jurisdiction: 'us-nv', get });
    expect(result).toMatchObject({ needsAck: true, expectedErrorM: HELMERT_ERROR_M, outside: ['MX-1'], counts: { grid: 1, helmert: 1 } });
    expect(result.rows[0].transform).toMatchObject({ method: 'helmert', params: '-8,160,176', expected_error_m: 50 });
  });
  it('without a jurisdiction no grid is guessed; a missing grid file also falls back', async () => {
    const none = await convertCollars([{ hole_id: 'A', x: -123.1, y: 49.3 }], 'EPSG:4267', 'EPSG:4269', { get });
    expect(none).toMatchObject({ needsAck: true, grids: [], counts: { helmert: 1 } });
    vi.resetModules();
    const fresh = await import('../src/utils/datumConvert');
    const missing = await fresh.convertCollars([{ hole_id: 'A', x: -123.1, y: 49.3 }], 'EPSG:4267', 'EPSG:4269', { jurisdiction: 'bc', get: async () => ({ ok: false }) });
    expect(missing).toMatchObject({ needsAck: true, unavailable: ['The ca_nrc_ntv2_0_west grid could not be loaded.'], counts: { helmert: 1 } });
    // The 3-parameter result is within its stated bound of the grid here.
    const grid = await one({ x: -123.1, y: 49.3 }, 'EPSG:4267', 'EPSG:4269', 'bc');
    expect(Math.hypot((grid.x - missing.rows[0].x) * Math.cos(49.3 * Math.PI / 180), grid.y - missing.rows[0].y) * 111195).toBeLessThan(HELMERT_ERROR_M);
  });
  it('NAD83↔WGS84 and NAD27→WGS84 note the NAD83 = WGS84 assumption; same datum is a projection only', async () => {
    expect((await convertCollars([{ hole_id: 'A', x: 500000, y: 5500000 }], 'EPSG:26910', 'EPSG:32610', { get }))).toMatchObject({ needsAck: true, expectedErrorM: 2, counts: { null: 1 } });
    expect(await convertCollars([{ hole_id: 'A', x: -123.1, y: 49.3 }], 'EPSG:4267', 'EPSG:4326', { jurisdiction: 'bc', get })).toMatchObject({ needsAck: true, expectedErrorM: 2, counts: { grid: 1 } });
    const zone = await convertCollars([{ hole_id: 'A', x: 500000, y: 5500000 }], 'EPSG:26910', 'EPSG:26911', { get });
    expect(zone).toMatchObject({ needsAck: false, counts: { projection: 1 } });
    const back = await convertCollars(zone.rows.map(({ x, y, hole_id }) => ({ hole_id, x, y })), 'EPSG:26911', 'EPSG:26910', { get });
    expect(back.rows[0].x).toBeCloseTo(500000, 2); expect(back.rows[0].y).toBeCloseTo(5500000, 2);
  });
  it('NAD83 → NAD27 inverts the grid', async () => {
    const r = await one({ x: -123.101321842, y: 49.299829886 }, 'EPSG:4269', 'EPSG:4267', 'bc');
    expect(r.x).toBeCloseTo(-123.1, 7); expect(r.y).toBeCloseTo(49.3, 7);
  });
});
