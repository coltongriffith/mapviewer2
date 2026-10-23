import { describe, expect, it } from 'vitest';
import proj4 from 'proj4';
import { coordinateDefinitions, previewSourceCoordinates, sourceCoordinateMapping, keepFileSource } from '../src/utils/drillCoordinates';
import { buildImport, autoMapping } from '../src/utils/drillDb';

describe('source coordinate preview, never a datum shift', () => {
  it('matches published PROJ north and south UTM examples to centimetre input precision', async () => {
    // https://proj.org/en/stable/operations/projections/utm.html (GRS80 default;
    // WGS84 inverse differs by much less than the published 0.01 metre rounding).
    const north = (await previewSourceCoordinates([{ hole_id: 'synthetic', x: 687071.44, y: 6210141.33 }], 'EPSG:32632'))[0];
    expect(north.longitude).toBeCloseTo(12, 6); expect(north.latitude).toBeCloseTo(56, 6);
    const south = (await previewSourceCoordinates([{ hole_id: 'synthetic', x: 740526.32, y: 5123750.87 }], 'EPSG:32759'))[0];
    expect(south.longitude).toBeCloseTo(174, 6); expect(south.latitude).toBeCloseTo(-44, 6);
  });
  it.each(['EPSG:26910', 'EPSG:26710', 'EPSG:32610'])('round trips on the source ellipsoid for %s', async code => {
    const input = { hole_id: 'synthetic', x: 512345.678, y: 5432109.876 };
    const preview = (await previewSourceCoordinates([input], code))[0];
    const def = coordinateDefinitions(code);
    const back = proj4(def.geographic, def.source, [preview.longitude, preview.latitude]);
    expect(back[0]).toBeCloseTo(input.x, 6); expect(back[1]).toBeCloseTo(input.y, 6);
    expect(def.source).toContain('+datum=none'); expect(def.geographic).toContain('+datum=none');
    expect(preview.x).toBe(input.x); expect(preview.y).toBe(input.y);
  });
  it('preserves longitude/latitude order, refuses bad ranges and never guesses unsupported CRS', async () => {
    expect((await previewSourceCoordinates([{ x: -123, y: 49 }], 'EPSG:4326'))[0]).toMatchObject({ longitude: -123, latitude: 49, issue: null });
    expect((await previewSourceCoordinates([{ x: 49, y: -123 }], 'EPSG:4326'))[0].issue).toMatch(/longitude/);
    expect((await previewSourceCoordinates([{ x: -123, y: 49 }], 'EPSG:26910'))[0].issue).toMatch(/UTM metre range/);
    expect((await previewSourceCoordinates([{ x: 500000, y: Infinity }], 'EPSG:26910'))[0].issue).toMatch(/finite/);
    await expect(previewSourceCoordinates([{ x: 1, y: 2 }], 'EPSG:2955')).rejects.toThrow(/unavailable/);
  });
  it('does not mutate original values or add new fields to imported collars', async () => {
    const table = { header: ['HoleID', 'Easting', 'Northing'], rows: [['synthetic', '512345.678', '5432109.876']] };
    const old = autoMapping('collars', table.header, table.rows, { crs: 'EPSG:26910' });
    const baseline = buildImport('collars', table, old);
    const mapping = sourceCoordinateMapping(old, 'epsg:26910');
    const built = buildImport('collars', table, mapping);
    await previewSourceCoordinates(built.rows, mapping.crs);
    expect(built).toEqual(baseline);
    expect(mapping.coordinateSource).toEqual({ version: 1, crs: 'EPSG:26910', operation: 'preserve-source', axisOrder: 'xy' });
    expect(old).not.toHaveProperty('coordinateSource');
    expect(buildImport('collars', table, { ...old, crs: undefined }).rows[0]).not.toHaveProperty('crs');
    expect(buildImport('collars', table, { ...old, crs: 'EPSG:2955' }).rows[0].x).toBe(512345.678);
  });
  it('column templates keep the current file source, even when it is blank', () => {
    const template = sourceCoordinateMapping({ columns: { x: 'East' } }, 'EPSG:26710');
    expect(keepFileSource(template, {})).toEqual({ columns: { x: 'East' } });
    expect(keepFileSource(template, { crs: 'EPSG:26910' })).toEqual({ columns: { x: 'East' }, crs: 'EPSG:26910' });
  });
});
