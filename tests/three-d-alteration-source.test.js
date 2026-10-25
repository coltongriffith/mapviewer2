import { describe, it, expect, vi } from 'vitest';
import { toFiles, snapshotOf, newerSince, noticeText, pull, FILE_NAMES } from '../src/three-d/property-data.js';
import { parseCsv } from '../src/utils/drillDb.js';
import { matchCols, roleOf, refineRole } from '../src/three-d/roles.js';
import { readLogs } from '../src/three-d/geology.js';
import { parseDrillFilter, matchesDrillFilter } from './fixtures/drill-filter.js';

// Synthetic records only; no real positions or observations are implied.
const prop = { id: 'synthetic-property', name: 'Synthetic test' };
const rows = () => ({
  collars: [{ hole_id: 'EXAMPLE', x: 1, y: 2, z: 3, crs: 'EPSG:32610' }],
  assays: [{ hole_id: 'EXAMPLE', from_m: 0, to_m: 2, values: { Au: 1 }, units: { Au: 'g/t' } }],
  lithology: [{ hole_id: 'EXAMPLE', from_m: 0, to_m: 2, code: 'ROCK', description: 'Rock' }],
  alteration: ['03', '0', 'weak–moderate', 'ND', null].map((intensity, i) => ({ hole_id: 'EXAMPLE', from_m: i * 2, to_m: i * 2 + 2, code: '01', description: 'Observed, not quantified', intensity })),
});
const batch = (kind, day = 1, more = {}) => ({ id: `${kind}-${day}`, kind, created_at: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, summary: { new: 1, changed: 2 }, ...more });
function fake({ cap = 1000, errorKind, errorCode = '42501', onRead } = {}) {
  const db = Object.fromEntries(Object.entries(rows()).map(([kind, data]) => [`drill_${kind}`, data]));
  db.drill_import_batches = [batch('collars'), batch('lithology', 2), batch('alteration', 3)];
  const reads = [];
  const sb = { from(table) {
    const filters = [], orders = []; let limit = Infinity;
    const q = {
      select: () => q,
      eq: (key, value) => { expect([key, value]).toEqual(['property_id', prop.id]); return q; },
      is: (key, value) => { expect([key, value]).toEqual(['superseded_by_batch', null]); return q; },
      order: (key, options) => { orders.push([key, options?.ascending !== false]); return q; },
      limit: n => { limit = n; return q; },
      gt: (key, value) => { filters.push(row => row[key] > value); return q; },
      gte: (key, value) => { filters.push(row => row[key] >= value); return q; },
      or: expression => { const tree = parseDrillFilter(`or(${expression})`); filters.push(row => matchesDrillFilter(row, tree)); return q; },
      then(resolve, reject) {
        reads.push(table); onRead?.(table, db, reads);
        const data = [...(db[table] || [])].filter(row => filters.every(test => test(row))).sort((a, b) => {
          for (const [key, asc] of orders) if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (asc ? 1 : -1);
          return 0;
        }).slice(0, Math.min(limit, table === 'drill_import_batches' ? Infinity : cap));
        return Promise.resolve({ data: structuredClone(data), error: table === `drill_${errorKind}` ? { code: errorCode, message: 'test failure' } : null }).then(resolve, reject);
      },
    };
    return q;
  } };
  return { sb, db, reads };
}

describe('explicit property geology source', () => {
  it('exports only the selected log, preserving text intensity and existing categorical parsing', async () => {
    const files = toFiles(rows(), [], { geologySource: 'alteration' });
    expect(files.map(f => f.name)).toEqual([FILE_NAMES.collars, FILE_NAMES.assays, FILE_NAMES.alteration]);
    const file = files.at(-1), table = await parseCsv(file.text);
    expect(table.header).toEqual(['HoleID', 'From', 'To', 'Code', 'Description', 'Intensity']);
    expect(table.rows.map(r => r[5])).toEqual(['03', '0', 'weak–moderate', 'ND', '']);
    expect(table.rows.every(r => r[3] === '01')).toBe(true);
    const entry = { ...table, cols: matchCols(table.header) };
    expect(refineRole(entry, roleOf(entry.cols, file.name), file.name)).toBe('litho');
    expect(readLogs([entry]).codes.map(c => c.code)).toEqual(['01']);
    expect(readLogs([entry]).byHole.get('EXAMPLE')).toHaveLength(5);
    expect(toFiles(rows(), [], { geologySource: 'none' }).map(f => f.name)).toEqual([FILE_NAMES.collars, FILE_NAMES.assays]);
    expect(toFiles(rows()).at(-1).name).toBe(FILE_NAMES.lithology);
    expect(toFiles(rows(), [], { geologySource: 'lithology' })).toEqual(toFiles(rows()));
  });

  it('keeps legacy snapshot shape and records explicit source counts without unselected changes', () => {
    const batches = [batch('lithology', 2), batch('alteration', 3)];
    const legacy = snapshotOf({ propertyId: prop.id }, batches, rows());
    expect(legacy).not.toHaveProperty('geologySource');
    expect(legacy.latestBatchId).toBe('lithology-2');
    const alt = snapshotOf({ propertyId: prop.id, geologySource: 'alteration' }, batches, rows());
    expect(alt).toMatchObject({ latestBatchId: 'alteration-3', geologySource: 'alteration', geologyIntervals: 5 });
    expect(newerSince(alt, [batch('lithology', 4)])).toBeNull();
    const changes = newerSince(alt, [batch('alteration', 4), batch('lithology', 5)]);
    expect(changes).toMatchObject({ imports: 1, geologySource: 'alteration', geologyIntervals: 3 });
    expect(noticeText(changes)).toContain('3 alteration intervals');
    expect(newerSince(alt, [batch('alteration', 2, { rolled_back_at: batch('', 6).created_at })])).toMatchObject({ imports: 0, rolledBack: 1 });
    const none = snapshotOf({ propertyId: prop.id, geologySource: 'none' }, batches, rows());
    expect(none).toMatchObject({ latestBatchId: null, geologyIntervals: 0 });
    expect(newerSince(none, batches)).toBeNull();
  });

  it.each([undefined, 'lithology', 'alteration', 'none'])('reads only source %s plus the existing hole and assay tables', async geologySource => {
    const f = fake(), out = await pull(f.sb, prop, undefined, 2, { geologySource });
    const source = geologySource ?? 'lithology';
    expect([...new Set(f.reads)].sort()).toEqual(['drill_import_batches', 'drill_collars', 'drill_surveys', 'drill_assays', ...(source === 'none' ? [] : [`drill_${source}`])].sort());
    expect(out.rows).not.toHaveProperty(source === 'alteration' ? 'lithology' : 'alteration');
    expect(out.ref.geologySource).toBe(geologySource);
  });

  it('continues capped alteration pages across quoted hole IDs without losing raw intensity', async () => {
    const f = fake({ cap: 2 });
    f.db.drill_alteration = ['A,"quoted"', 'B\\slash', 'C,(paren)'].flatMap(hole_id => rows().alteration.map(row => ({ ...row, hole_id })));
    const out = await pull(f.sb, prop, undefined, 2, { geologySource: 'alteration' });
    expect(out.rows.alteration).toEqual(f.db.drill_alteration);
    expect(f.reads.filter(t => t === 'drill_alteration')).toHaveLength(9);
  });

  it.each(['42P01', 'PGRST205'])('reports missing alteration schema (%s) only when explicitly selected', async errorCode => {
    const f = fake({ errorKind: 'alteration', errorCode });
    await expect(pull(f.sb, prop)).resolves.toBeTruthy();
    await expect(pull(f.sb, prop, undefined, 2, { geologySource: 'none' })).resolves.toBeTruthy();
    await expect(pull(f.sb, prop, undefined, 2, { geologySource: 'alteration' })).rejects.toMatchObject({ code: 'ALTERATION_UNAVAILABLE' });
  });

  it('does not mislabel permissions as a missing migration or silently accept invalid sources', async () => {
    const f = fake({ errorKind: 'alteration' });
    await expect(pull(f.sb, prop, undefined, 2, { geologySource: 'alteration' })).rejects.toThrow('Could not read');
    f.reads.length = 0;
    await expect(pull(f.sb, prop, undefined, 2, { geologySource: 'both' })).rejects.toThrow('Choose lithology');
    expect(f.reads).toEqual([]);
    expect(() => toFiles(rows(), [], { geologySource: null })).toThrow('Choose lithology');
  });

  it('retries selected log changes while retaining source, but ignores unrelated log changes', async () => {
    const run = async changedKind => {
      let changed = false;
      const f = fake({ onRead(table, db) {
        if (table === 'drill_alteration' && !changed) { changed = true; db.drill_import_batches.push(batch(changedKind, 9)); }
      } });
      const progress = vi.fn();
      const out = await pull(f.sb, prop, progress, 2, { geologySource: 'alteration' });
      expect(out.ref.geologySource).toBe('alteration');
      expect(f.reads).not.toContain('drill_lithology');
      return f.reads.filter(t => t === 'drill_import_batches').length;
    };
    expect(await run('alteration')).toBe(4);
    expect(await run('lithology')).toBe(2);
  });
});
