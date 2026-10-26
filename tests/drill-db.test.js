import { describe, it, expect, vi } from 'vitest';
import {
  parseCsv, detectKind, autoMapping, applyTemplate, parseElementHeader, parseAssay, buildImport, diffSentence,
  serverErrors, drillError, drillDb, MAX_ROWS,
} from '../src/utils/drillDb.js';

// The drill database client (src/utils/drillDb.js): reading a file, mapping its
// columns, checking it, and the calls it makes. The database side is
// tests/drill-db-sql.test.js.

const table = async (csv) => parseCsv(csv);

describe('reading and detecting', () => {
  it('parses CSV, tab and semicolon files with a BOM, quotes and blank lines', async () => {
    expect(await table('\uFEFFHoleID,Easting,Northing\n"R-1",1,2\n\nR-2,3,4\n')).toEqual({ header: ['HoleID', 'Easting', 'Northing'], rows: [['R-1', '1', '2'], ['R-2', '3', '4']], lines: [2, 4] });
    expect((await table('Hole\tFrom\tTo\nR-1\t0\t2\n')).header).toEqual(['Hole', 'From', 'To']);
    expect((await table('Hole;From;To\nR-1;0;2\n')).rows).toEqual([['R-1', '0', '2']]);
  });

  it('keeps each row\'s own file line past blank lines and values that span lines; trailing empty cells are fine', async () => {
    const t = await table('HoleID,From,To,Description\r\n\r\nR-1,0,2,"Quartz\r\nmonzodiorite"\r\nR-1,2,4,Andesite,,\r\n\r\nR-1,4,6,Andesite\r\n');
    expect(t.rows).toEqual([['R-1', '0', '2', 'Quartz\r\nmonzodiorite'], ['R-1', '2', '4', 'Andesite'], ['R-1', '4', '6', 'Andesite']]);
    expect(t.lines).toEqual([3, 5, 7]);
    // Problems found later point at those lines too.
    const r = buildImport('lithology', t, { columns: { hole_id: 'HoleID', from_m: 'From', to_m: 'To', description: 'Description' } });
    expect(r.lines).toEqual([3, 5, 7]);
  });

  it('refuses a file with an unclosed quote instead of swallowing the rows after it', async () => {
    const csv = 'HoleID,From,To,Code,Description\nR-1,0,2,QMD,Quartz monzodiorite\nR-1,2,4,AND,"Andesite, chloritic\nR-1,4,6,AND,Andesite\nR-1,6,8,QMD,Quartz monzodiorite\n';
    await expect(table(csv)).rejects.toThrow('Line 3: a quoted value starts here and is never closed, so every row after it would be read as part of it. Close the quote (") or remove it.');
    await expect(table('HoleID,From,To,Description\nR-1,0,2,"Andesite" chloritic\n')).rejects.toThrow(/^Line 2: a quoted value is not closed properly/);
  });

  it('refuses rows with more or fewer values than the header, naming the first', async () => {
    await expect(table('HoleID,From,To,Cu\nR-1,0,2,0.4\nR-1,2,4,0,5\nR-1,4,6\n'))
      .rejects.toThrow('The header has 4 columns but line 3 has 5 values (and 1 more row do not match). Check that line for a stray comma or quote; nothing was imported.');
    await expect(table('HoleID\nR-1\n')).rejects.toThrow(/Could not tell how the columns are separated/);
  });

  it('tells collars, surveys, assays and lithology apart as the 3D maker does', async () => {
    const kind = async (csv, name = 'data.csv') => { const t = await table(csv); return detectKind(t.header, t.rows, name); };
    expect(await kind('HoleID,Easting,Northing,Elevation,Depth\nR-1,1,2,3,100')).toBe('collars');
    expect(await kind('BHID,Latitude,Longitude\nR-1,50.1,-120.2')).toBe('collars');
    expect(await kind('HoleID,Depth,Azimuth,Dip\nR-1,0,90,-60')).toBe('surveys');
    expect(await kind('HoleID,From,To,Cu_pct,Au_gpt\nR-1,0,2,0.4,0.1')).toBe('assays');
    expect(await kind('HoleID,From,To,Lith,Description\nR-1,0,2,QMD,Quartz monzodiorite')).toBe('lithology');
    expect(await kind('Name,Value\na,1', 'rails_collars.csv')).toBe('collars');
    expect(await kind('Name,Value\na,1', 'notes.csv')).toBe(null);
  });
});

describe('mapping columns', () => {
  it('reads element names and units from headers', () => {
    expect(parseElementHeader('Cu_pct')).toEqual({ name: 'Cu', unit: '%' });
    expect(parseElementHeader('Au (g/t)')).toEqual({ name: 'Au', unit: 'g/t' });
    expect(parseElementHeader('Au_ppb')).toEqual({ name: 'Au', unit: 'ppb' });
    expect(parseElementHeader('Ag ppm')).toEqual({ name: 'Ag', unit: 'ppm' });
    expect(parseElementHeader('CuEq%')).toEqual({ name: 'CuEq', unit: '%' });
    expect(parseElementHeader('Mo')).toEqual({ name: 'Mo', unit: null });
  });

  it('maps assay columns, elements and per-element unit columns; other columns are listed unticked', async () => {
    const t = await table('HOLEID,SAMPLE,FROM,TO,Cu_pct,Au (g/t),Mo,Mo_units,Weight_kg,Lab\nR-1,A1,0,2,0.4,<0.005,12,ppm,3.2,ALS\n');
    expect(autoMapping('assays', t.header, t.rows)).toEqual({
      columns: { hole_id: 'HOLEID', from_m: 'FROM', to_m: 'TO', sample_id: 'SAMPLE' },
      bdl: 'half',
      elements: [
        { column: 'Cu_pct', name: 'Cu', unit: '%', unitColumn: null },
        { column: 'Au (g/t)', name: 'Au', unit: 'g/t', unitColumn: null },
        { column: 'Mo', name: 'Mo', unit: null, unitColumn: 'Mo_units' },
        { column: 'Weight_kg', name: 'Weight_kg', unit: null, unitColumn: null, skip: true },
        { column: 'Lab', name: 'Lab', unit: null, unitColumn: null, skip: true },
      ],
    });
  });

  it('finds an element whose only value is in the last of 301 rows, and imports it', async () => {
    const body = Array.from({ length: 301 }, (_, i) => `R-1,${i},${i + 1},0.${i % 9 + 1},${i === 300 ? '1.25' : ''}`).join('\n');
    const t = await table(`HoleID,From,To,Cu_pct,Au_ppb\n${body}\n`);
    const m = autoMapping('assays', t.header, t.rows);
    expect(m.elements).toEqual([{ column: 'Cu_pct', name: 'Cu', unit: '%', unitColumn: null }, { column: 'Au_ppb', name: 'Au', unit: 'ppb', unitColumn: null }]);
    const r = buildImport('assays', t, m);
    expect(r.errorCount).toBe(0);
    expect(r.rows[300]).toMatchObject({ from_m: 300, values: { Cu: 0.4, Au: 1.25 }, units: { Cu: '%', Au: 'ppb' } });
    expect(r.lines[300]).toBe(302);
    expect(r.rows[299].values).toEqual({ Cu: 0.3 });
  });

  it('an empty or unrecognised column can be ticked by hand', async () => {
    const t = await table('HoleID,From,To,Cu_pct,Pt_ppb\nR-1,0,2,0.4,\nR-1,2,4,0.5,\n');
    const m = autoMapping('assays', t.header, t.rows);
    expect(m.elements[1]).toEqual({ column: 'Pt_ppb', name: 'Pt', unit: 'ppb', unitColumn: null, skip: true });
    expect(buildImport('assays', t, m).rows[0].values).toEqual({ Cu: 0.4 });
    const ticked = { ...m, elements: m.elements.map((e) => ({ ...e, skip: false })) };
    expect(buildImport('assays', t, ticked).rows[0]).toMatchObject({ values: { Cu: 0.4 }, units: { Cu: '%' } });
  });

  it('maps collars, in latitude / longitude as WGS 84, and the property CRS otherwise', async () => {
    const t = await table('Hole,Easting,Northing,RL,Azimuth,Dip,Depth,Status\nR-1,1,2,3,90,-60,300,complete\n');
    expect(autoMapping('collars', t.header, t.rows, { crs: 'EPSG:26910' })).toEqual({
      columns: { hole_id: 'Hole', x: 'Easting', y: 'Northing', z: 'RL', azimuth: 'Azimuth', dip: 'Dip', depth: 'Depth', status: 'Status' }, bdl: 'half', crs: 'EPSG:26910' });
    const ll = await table('BHID,Latitude,Longitude\nR-1,50.1,-120.2\n');
    expect(autoMapping('collars', ll.header, ll.rows, { crs: 'EPSG:26910' })).toMatchObject({ columns: { hole_id: 'BHID', x: 'Longitude', y: 'Latitude' }, crs: 'EPSG:4326' });
    const lith = await table('HoleID,From,To,Rock_Code,Description\nR-1,0,2,QMD,Quartz\n');
    expect(autoMapping('lithology', lith.header, lith.rows).columns).toEqual({ hole_id: 'HoleID', from_m: 'From', to_m: 'To', code: 'Rock_Code', description: 'Description' });
  });

  it('applies a saved template to a new file by column name, dropping what is not there', () => {
    const template = { mapping: { columns: { hole_id: 'HOLEID', from_m: 'From', to_m: 'To', sample_id: 'SampleNo' }, bdl: 'dl',
      elements: [{ column: 'Cu_PCT', name: 'Cu', unit: '%' }, { column: 'Zn_pct', name: 'Zn', unit: '%' }] } };
    expect(applyTemplate(template, ['holeid', 'FROM', 'TO', 'cu_pct'])).toEqual({
      columns: { hole_id: 'holeid', from_m: 'FROM', to_m: 'TO' }, bdl: 'dl', elements: [{ column: 'cu_pct', name: 'Cu', unit: '%', unitColumn: null }] });
    // With this file's own candidates, a column the template does not know stays available, unticked.
    const candidates = [{ column: 'cu_pct', name: 'Cu', unit: '%', unitColumn: null }, { column: 'Au_ppb', name: 'Au', unit: 'ppb', unitColumn: null }];
    expect(applyTemplate(template, ['holeid', 'FROM', 'TO', 'cu_pct', 'Au_ppb'], candidates).elements).toEqual([
      { column: 'cu_pct', name: 'Cu', unit: '%', unitColumn: null },
      { column: 'Au_ppb', name: 'Au', unit: 'ppb', unitColumn: null, skip: true },
    ]);
  });
});

describe('below-detection and other assay values', () => {
  it('stores "<DL" as configured and flags it', () => {
    expect(parseAssay('<0.005')).toEqual({ value: 0.0025, dl: 0.005 });
    expect(parseAssay('< 0.005', 'dl')).toEqual({ value: 0.005, dl: 0.005 });
    expect(parseAssay('<5', 'zero')).toEqual({ value: 0, dl: 5 });
    expect(parseAssay('<5', 'null')).toEqual({ value: null, dl: 5 });
    expect(parseAssay('-0.01')).toEqual({ value: 0.005, dl: 0.01 });
    expect(parseAssay('BDL')).toEqual({ value: null, dl: true });
    expect(parseAssay('>10')).toEqual({ value: 10, over: true });
    expect(parseAssay(' 0.42 ')).toEqual({ value: 0.42 });
    expect(parseAssay('')).toEqual({ value: null, missing: true });
    for (const v of ['-', 'NS', 'IS', 'n/a']) expect(parseAssay(v)).toEqual({ value: null, missing: true, raw: v });
    expect(parseAssay('0.4%')).toMatchObject({ value: null, error: '"0.4%" is not a number' });
  });
});

describe('checking an import', () => {
  const assays = async (csv, patch = {}) => {
    const t = await table(csv);
    return buildImport('assays', t, { ...autoMapping('assays', t.header, t.rows), ...patch });
  };

  it('builds canonical assay rows with values, bdl flags and units', async () => {
    const r = await assays('HoleID,Sample,From,To,Cu_pct,Au_gpt\nR-1,A1,0,2,0.41,<0.005\nR-1,A2,2,4,0.55,0.12\n');
    expect(r.errorCount).toBe(0);
    expect(r.rows).toEqual([
      { hole_id: 'R-1', sample_id: 'A1', from_m: 0, to_m: 2, values: { Cu: 0.41, Au: 0.0025 }, bdl: { Au: 0.005 }, units: { Cu: '%', Au: 'g/t' } },
      { hole_id: 'R-1', sample_id: 'A2', from_m: 2, to_m: 4, values: { Cu: 0.55, Au: 0.12 }, units: { Cu: '%', Au: 'g/t' } },
    ]);
    expect(r.lines).toEqual([2, 3]);
    expect(r.warnings.map((w) => w.kind)).toEqual(['bdl']);
    expect(r.warnings[0].message).toBe('1 value below detection, stored as half the detection limit and flagged');
  });

  it('stops on bad rows with their line numbers: negative depths, from not before to, text in numbers, duplicates', async () => {
    const r = await assays('HoleID,From,To,Cu\nR-1,-2,0,0.1\nR-1,4,4,0.1\nR-1,x,6,0.1\n,6,8,0.1\nR-1,8,10,0.4%\nR-1,10,12,1\nR-1,10,12,2\n');
    expect(r.errors).toEqual([
      { line: 2, message: 'Negative depth (from -2)' },
      { line: 3, message: 'To (4) must be greater than From (4)' },
      { line: 4, message: 'From "x" is not a number' },
      { line: 5, message: 'Hole ID is empty' },
      { line: 6, message: 'Cu: "0.4%" is not a number' },
      { line: 8, message: 'This interval of R-1 is also on line 7' },
    ]);
    expect(r.rows).toHaveLength(1);
  });

  it('warns about overlaps and gaps down a hole, and over-limit values', async () => {
    const r = await assays('HoleID,From,To,Cu_pct\nR-1,0,2,0.1\nR-1,1.5,3,0.1\nR-2,0,2,>10\nR-2,5,6,0.2\n');
    expect(r.errorCount).toBe(0);
    expect(r.warnings.map((w) => w.message)).toEqual([
      'Overlapping intervals in 1 hole: R-1',
      'Unsampled gaps between intervals in 1 hole: R-2',
      '1 value over the upper detection limit (">") in Cu kept at the limit, not a measured grade; re-assay by an over-limit method',
    ]);
  });

  it('checks units: mixed units in a unit column stop the import, a missing unit warns', async () => {
    const mixed = await assays('HoleID,From,To,Mo,Mo_units\nR-1,0,2,12,ppm\nR-1,2,4,0.01,%\n');
    expect(mixed.errors).toEqual([{ line: null, message: 'Mo: mixed units in Mo_units (ppm, %). Import one unit at a time.' }]);
    const one = await assays('HoleID,From,To,Mo,Mo_units\nR-1,0,2,12,ppm\n');
    expect(one.rows[0].units).toEqual({ Mo: 'ppm' });
    const none = await assays('HoleID,From,To,Ag\nR-1,0,2,1.5\n');
    expect(none.warnings.map((w) => w.kind)).toEqual(['no-unit']);
    const skipped = await assays('HoleID,From,To,Ag\nR-1,0,2,1.5\n', { elements: [{ column: 'Ag', name: 'Ag', unit: 'g/t', skip: true }] });
    expect(skipped.errors).toEqual([{ line: null, message: 'Choose at least one element column.' }]);
  });

  it('needs the required columns and at most 20,000 rows', async () => {
    const t = await table('HoleID,From\nR-1,0\n');
    expect(buildImport('assays', t, autoMapping('assays', t.header, t.rows)).errors.map((e) => e.message))
      .toEqual(['Choose the column for To.', 'Choose at least one element column.']);
    const big = { header: ['HoleID', 'Depth', 'Dip'], rows: Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`H${i}`, '0', '-90']) };
    expect(buildImport('surveys', big, { columns: { hole_id: 'HoleID', depth_m: 'Depth', dip: 'Dip' } }).errors[0].message).toMatch(/20,001 rows; one import takes at most 20,000. Split files over 20,000 rows/);
  });

  it('collars: coordinates, ranges, the CRS, planned holes and positive-down dips', async () => {
    const t = await table('Hole,Easting,Northing,Dip,Azimuth,Depth,Status\nR-1,"512,000.5",6700000,60,90,300,complete\nR-2,512100,6700050,55,370,250,planned\nR-3,,6700100,50,0,-5,\n');
    const m = { ...autoMapping('collars', t.header, t.rows), crs: 'EPSG:26910' };
    const r = buildImport('collars', t, m);
    expect(r.errors).toEqual([
      { line: 3, message: 'Azimuth 370 is outside 0 to 360' },
      { line: 4, message: 'Easting / X is empty' },
      { line: 4, message: 'Negative depth (depth -5)' },
    ]);
    const ok = buildImport('collars', { header: t.header, rows: [t.rows[0], [...t.rows[1].slice(0, 4), '270', ...t.rows[1].slice(5)]] }, m);
    expect(ok.rows).toEqual([
      { hole_id: 'R-1', x: 512000.5, y: 6700000, dip: -60, azimuth: 90, depth: 300, status: 'complete', crs: 'EPSG:26910' },
      { hole_id: 'R-2', x: 512100, y: 6700050, dip: -55, azimuth: 270, depth: 250, status: 'planned', crs: 'EPSG:26910', planned: true },
    ]);
    expect(ok.warnings.map((w) => w.kind)).toEqual(['dips-positive']);
    expect(buildImport('collars', t, { ...m, crs: 'UTM 10N' }).errors[0].message).toMatch(/EPSG:<code>/);
  });

  it('maps server row errors back to file lines', () => {
    expect(serverErrors({ ok: false, errors: [{ row: 2, message: 'negative depth' }] }, [2, 4, 5])).toEqual([{ line: 4, message: 'negative depth' }]);
  });
});

describe('the diff in words', () => {
  it.each([undefined, null, {}, { note: 'Published collars only' }, { new: 0, changed: 0 }, { unchanged: null }, { unchanged: 'unknown' }, { unchanged: -1 }])('handles missing or invalid change counts without inventing zeroes: %j', summary => {
    expect(diffSentence('collars', summary)).toBe('Change counts unavailable.');
  });

  it('keeps known counts when the rest of a historical summary is missing', () => {
    expect(diffSentence('collars', { new: 13 })).toBe('13 new holes');
    expect(diffSentence('assays', { changed: 2, unchanged: null })).toBe('2 changed assays');
    expect(diffSentence('assays', { new: {}, changed: 2 })).toBe('2 changed assays');
    expect(diffSentence('surveys', { new: 0, changed: 0, unchanged: 0 })).toBe('No changes: 0 survey stations already stored as they are');
  });

  it('reads like the plan: new holes, new rows, changed rows', () => {
    expect(diffSentence('assays', { new: 1340, changed: 0, unchanged: 0, new_holes: 12 })).toBe('12 new holes, 1,340 new assays');
    expect(diffSentence('collars', { new: 12, changed: 3, unchanged: 40, new_holes: 12 })).toBe('12 new holes, 3 changed collars, 40 unchanged');
    expect(diffSentence('lithology', { new: 0, changed: 1, unchanged: 0, new_holes: 0 })).toBe('1 changed lithology interval');
    expect(diffSentence('surveys', { new: 0, changed: 0, unchanged: 7 })).toBe('No changes: 7 survey stations already stored as they are');
  });
});

describe('the client', () => {
  const fakeSb = (result = { data: { ok: true }, error: null }) => {
    const calls = [];
    const q = { select: vi.fn(() => q), eq: vi.fn(() => q), order: vi.fn(async () => ({ data: [{ id: 't1' }], error: null })), delete: vi.fn(() => q) };
    return { calls, q, rpc: vi.fn(async (fn, args) => { calls.push([fn, args]); return result; }), from: vi.fn(() => q) };
  };

  it('dry-runs, commits with a batch id and rolls back through the RPCs', async () => {
    const sb = fakeSb();
    const db = drillDb(sb);
    const args = { propertyId: 'p1', kind: 'assays', rows: [{ hole_id: 'R-1' }], mapping: { bdl: 'half' }, filename: 'a.csv' };
    await db.dryRun(args);
    await db.commit({ ...args, batchId: 'b1' });
    await db.rollback('b1');
    await db.summary('p1');
    await db.saveTemplate('o1', 'assays', 'ALS', { columns: {} });
    expect(sb.calls).toEqual([
      ['drill_import_batch', { p_property: 'p1', p_kind: 'assays', p_rows: args.rows, p_mapping: { bdl: 'half' }, p_filename: 'a.csv', p_dry_run: true, p_batch: null }],
      ['drill_import_batch', { p_property: 'p1', p_kind: 'assays', p_rows: args.rows, p_mapping: { bdl: 'half' }, p_filename: 'a.csv', p_dry_run: false, p_batch: 'b1' }],
      ['drill_rollback_batch', { p_batch: 'b1' }],
      ['drill_property_summary', { p_property: 'p1' }],
      ['drill_save_template', { p_org: 'o1', p_kind: 'assays', p_name: 'ALS', p_mapping: { columns: {} } }],
    ]);
    expect(await db.templates('o1', 'assays')).toEqual([{ id: 't1' }]);
    expect(sb.q.eq.mock.calls).toEqual([['org_id', 'o1'], ['kind', 'assays']]);
  });

  it('turns database errors into sentences', async () => {
    const sb = fakeSb({ data: null, error: { message: 'BATCH_SUPERSEDED: a later import (assays-2026.csv, 2026-10-21 10:00 UTC) changed rows from this one; roll that back first' } });
    await expect(drillDb(sb).rollback('b1')).rejects.toThrow('A later import (assays-2026.csv, 2026-10-21 10:00 UTC) changed rows from this one; roll that back first.');
    expect(drillError({ message: 'BATCH_TOO_LARGE: 20001 rows' }).message).toMatch(/at most 20,000 rows \(13 MB\)\. Split files over 20,000 rows/);
    expect(drillError({ message: 'ORG_READ_ONLY: viewers cannot import drill data' }).code).toBe('ORG_READ_ONLY');
    expect(() => drillDb(null)).toThrow(/needs an Exploration Maps account/);
  });
});
