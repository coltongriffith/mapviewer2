// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// Drill database, Phase 2A (20261027100000): import batches with a dry-run
// diff, soft-versioned rows, rollback, the property summary, column templates
// and the size limits, role by role. Both workspace migrations come first;
// this one is applied twice.
//
// Tests run in order and share state: each describe builds on the last.
let db, as, one, val, su;
const WORKSPACES = readMigration('20261023100000_workspaces_properties.sql');
const FILES = readMigration('20261025100000_property_files.sql');
const MIGRATION = readMigration('20261027100000_drill_database.sql');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1); // owner
const A = id(2); // admin
const E = id(3); // editor
const V = id(4); // viewer
const X = id(5); // owner of another company
const EMAIL = { [O]: 'owner@star.test', [A]: 'admin@star.test', [E]: 'geo@star.test', [V]: 'investor@fund.test', [X]: 'rival@rival.test' };
const S = {};

const imp = (uid, kind, rows, { dry = true, batch = null, property = S.prop, filename = `${kind}.csv`, mapping = {} } = {}) =>
  val(uid, `select public.drill_import_batch($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
    [property, kind, JSON.stringify(rows), JSON.stringify(mapping), filename, dry, batch]);
const rollback = (uid, batch) => val(uid, `select public.drill_rollback_batch($1)`, [batch]);
const summary = (uid, property = S.prop) => val(uid, `select public.drill_property_summary($1)`, [property]);
const current = async (table) => (await su(`select hole_id, ${table === 'drill_collars' ? 'x, y, z, depth' : 'from_m, to_m, "values", bdl, units, sample_id'}, batch_id
  from public.${table} where property_id = $1 and superseded_by_batch is null order by hole_id${table === 'drill_collars' ? '' : ', from_m'}`, [S.prop]));

const COLLARS = [
  { hole_id: 'R-1', x: 512000, y: 6700000, z: 1200.5, crs: 'EPSG:26910', azimuth: 90, dip: -60, depth: 300 },
  { hole_id: 'R-2', x: 512100, y: 6700050, z: 1190, crs: 'EPSG:26910', azimuth: 270, dip: -55, depth: 250.5 },
  { hole_id: 'R-3', x: 512200, y: 6700100, crs: 'EPSG:26910', depth: 400, status: 'planned', planned: true },
];
const au = (from, to, cu, aueq = null) => ({ hole_id: 'R-1', from_m: from, to_m: to, sample_id: `A${from}`,
  values: { Cu: cu, ...(aueq === null ? {} : { Au: aueq }) }, bdl: aueq === 0.0025 ? { Au: 0.005 } : {}, units: { Cu: '%', Au: 'g/t' } });

beforeAll(async () => {
  ({ db, as, one, val, su } = await createWorkspaceDb({ emails: EMAIL, migrations: [WORKSPACES, FILES, MIGRATION, MIGRATION] }));
  S.org = (await val(O, `select public.create_organization('Star Copper Corp.')`)).id;
  S.orgB = (await val(X, `select public.create_organization('Rival Metals')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'editor'), ($1, $4, 'viewer')`, [S.org, A, E, V]);
  S.prop = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Rails') returning id`, [S.org])).id;
  S.propB = (await one(X, `insert into public.properties (org_id, name) values ($1, 'Rival') returning id`, [S.orgB])).id;
}, 120_000);
afterAll(async () => db?.close());

describe('migration', () => {
  it('pins search_path, keeps every function from anon and the helpers from the browser', async () => {
    const fns = await su(`select proname, proconfig, prosecdef, has_function_privilege('anon', oid, 'execute') as anon,
      has_function_privilege('authenticated', oid, 'execute') as auth from pg_proc where proname like 'drill\\_%'`);
    const by = Object.fromEntries(fns.map((f) => [f.proname, f]));
    expect(Object.keys(by).sort()).toEqual(['drill_current', 'drill_import_batch', 'drill_incoming', 'drill_kind_noun', 'drill_num',
      'drill_property_summary', 'drill_rollback_batch', 'drill_row_errors', 'drill_save_template', 'drill_table']);
    for (const f of fns) {
      expect(f.proconfig?.[0], f.proname).toBe('search_path=""');
      expect(f.anon, f.proname).toBe(false);
    }
    for (const f of ['drill_import_batch', 'drill_rollback_batch', 'drill_property_summary', 'drill_save_template']) {
      expect(by[f].auth, f).toBe(true);
      expect(by[f].prosecdef, f).toBe(true);
    }
    for (const f of ['drill_current', 'drill_incoming', 'drill_row_errors', 'drill_num', 'drill_table', 'drill_kind_noun']) expect(by[f].auth, f).toBe(false);
  });

  it('applies twice without duplicating policies, and every policy reads auth.uid() once per statement', async () => {
    expect(await su(`select tablename, policyname from pg_policies group by 1, 2 having count(*) > 1`)).toEqual([]);
    const pols = await su(`select tablename, policyname, cmd, qual from pg_policies where tablename like 'drill\\_%' order by 1, 2`);
    expect(pols.map((p) => [p.tablename, p.cmd])).toEqual([
      ['drill_assays', 'SELECT'], ['drill_collars', 'SELECT'], ['drill_column_templates', 'DELETE'], ['drill_column_templates', 'SELECT'],
      ['drill_import_batches', 'SELECT'], ['drill_lithology', 'SELECT'], ['drill_surveys', 'SELECT'],
    ]);
    for (const p of pols) expect(p.qual, p.policyname).toMatch(/\(\s*SELECT auth\.uid\(\) AS uid\s*\)/);
    const defs = (await su(`select pg_get_constraintdef(oid) as d from pg_constraint where conname in ('org_activity_action_check', 'org_activity_entity_type_check') order by conname`)).map((r) => r.d);
    expect(defs[0]).toMatch(/'uploaded'.*'imported'.*'rolled_back'/);
    expect(defs[1]).toMatch(/'file'.*'drill_batch'/);
  });
});

describe('who can import', () => {
  it('refuses viewers, other companies, signed-out callers and direct writes', async () => {
    await expect(imp(V, 'collars', COLLARS)).rejects.toThrow(/ORG_READ_ONLY/);
    await expect(imp(X, 'collars', COLLARS)).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(imp(null, 'collars', COLLARS)).rejects.toThrow(/permission denied/);
    await expect(imp(E, 'collars', COLLARS, { property: S.propB })).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(imp(E, 'geochem', COLLARS)).rejects.toThrow(/INVALID_KIND/);
    for (const u of [O, E]) {
      await expect(as(u, `insert into public.drill_import_batches (org_id, property_id, kind, row_count) values ($1, $2, 'collars', 1)`, [S.org, S.prop])).rejects.toThrow(/permission denied/);
      await expect(as(u, `update public.drill_collars set x = 0`)).rejects.toThrow(/permission denied/);
      await expect(as(u, `delete from public.drill_assays`)).rejects.toThrow(/permission denied/);
    }
  });
});

describe('collars', () => {
  it('a dry run returns the diff and writes nothing', async () => {
    const d = await imp(E, 'collars', COLLARS);
    expect(d).toMatchObject({ ok: true, dry_run: true, kind: 'collars', rows: 3, new: 3, changed: 0, unchanged: 0, holes: 3, new_holes: 3, error_count: 0, limit: 20000 });
    expect(await su(`select count(*)::int as n from public.drill_import_batches`)).toEqual([{ n: 0 }]);
    expect(await su(`select count(*)::int as n from public.drill_collars`)).toEqual([{ n: 0 }]);
  });

  it('reports bad rows by row number and refuses to commit them', async () => {
    const bad = [COLLARS[0], { hole_id: ' ', x: 1, y: 2 }, { hole_id: 'R-5', x: '512000', y: 1, dip: -95, azimuth: 400, depth: -3 },
      { hole_id: 'R-6', x: 1, y: 2, crs: 'UTM 10N' }, { ...COLLARS[0], x: 1 }];
    const d = await imp(E, 'collars', bad);
    expect(d).toMatchObject({ ok: false, dry_run: true, error_count: 7 });
    expect(d.errors.map((e) => [e.row, e.message])).toEqual([
      [2, 'missing hole ID'],
      [3, 'azimuth outside 0 to 360'], [3, 'dip outside -90 to 90'], [3, 'negative depth'], [3, 'x (easting) must be a number'],
      [4, 'coordinate system must be EPSG:<code>'],
      [5, 'the same hole appears more than once (first on row 1)'],
    ]);
    await expect(imp(E, 'collars', bad, { dry: false })).rejects.toThrow(/INVALID_ROWS: 7 problems/);
    await expect(imp(E, 'collars', [])).rejects.toThrow(/EMPTY_IMPORT/);
    await expect(imp(E, 'collars', { hole_id: 'R-1' })).rejects.toThrow(/INVALID_ROWS/);
  });

  it('commits atomically: one batch, its rows, one activity entry', async () => {
    S.c1 = id(201);
    const d = await imp(E, 'collars', COLLARS, { dry: false, batch: S.c1, filename: 'Rails collars.csv', mapping: { columns: { hole_id: 'HoleID' } } });
    expect(d).toMatchObject({ dry_run: false, committed: true, batch_id: S.c1, new: 3, rows_written: 3 });
    expect(await one(E, `select kind, filename, row_count, rows_written, created_by, mapping, replaces from public.drill_import_batches where id = $1`, [S.c1]))
      .toEqual({ kind: 'collars', filename: 'Rails collars.csv', row_count: 3, rows_written: 3, created_by: E, mapping: { columns: { hole_id: 'HoleID' } }, replaces: [] });
    expect((await current('drill_collars')).map((r) => [r.hole_id, r.x, r.z, r.depth, r.batch_id])).toEqual([
      ['R-1', 512000, 1200.5, 300, S.c1], ['R-2', 512100, 1190, 250.5, S.c1], ['R-3', 512200, null, 400, S.c1]]);
    expect(await su(`select planned, status from public.drill_collars where hole_id = 'R-3'`)).toEqual([{ planned: true, status: 'planned' }]);
    const act = await su(`select action, entity_type, entity_id, property_id, actor, summary from public.org_activity where entity_type = 'drill_batch'`);
    expect(act).toEqual([{ action: 'imported', entity_type: 'drill_batch', entity_id: S.c1, property_id: S.prop, actor: E,
      summary: 'Imported 3 collars from "Rails collars.csv" (3 new, 0 changed)' }]);
  });

  it('shows rows and batches to members only', async () => {
    for (const u of [O, A, E, V]) {
      expect((await as(u, `select hole_id from public.drill_collars order by hole_id`)).rows.map((r) => r.hole_id)).toEqual(['R-1', 'R-2', 'R-3']);
      expect((await as(u, `select id from public.drill_import_batches`)).rows).toEqual([{ id: S.c1 }]);
    }
    expect((await as(X, `select id from public.drill_collars`)).rows).toEqual([]);
    expect((await as(X, `select id from public.drill_import_batches`)).rows).toEqual([]);
    await expect(as(null, `select id from public.drill_collars`)).rejects.toThrow(/permission denied/);
    await expect(summary(X)).rejects.toThrow(/forbidden/);
  });

  it('is idempotent: the same file again changes nothing, and a retried commit is not applied twice', async () => {
    expect(await imp(E, 'collars', COLLARS)).toMatchObject({ new: 0, changed: 0, unchanged: 3, new_holes: 0 });
    // Numbers that are equal but written differently are unchanged too.
    expect(await imp(E, 'collars', [{ ...COLLARS[0], z: 1200.50, depth: 3e2 }])).toMatchObject({ unchanged: 1 });
    expect(await imp(E, 'collars', COLLARS, { dry: false })).toMatchObject({ committed: false, nothing_to_do: true, unchanged: 3 });
    expect(await imp(E, 'collars', COLLARS, { dry: false, batch: S.c1 })).toMatchObject({ committed: true, replayed: true, batch_id: S.c1, new: 3 });
    expect(await su(`select count(*)::int as n from public.drill_import_batches`)).toEqual([{ n: 1 }]);
    expect(await su(`select count(*)::int as n from public.drill_collars`)).toEqual([{ n: 3 }]);
    // A batch id belongs to its property.
    await expect(imp(X, 'collars', COLLARS, { dry: false, batch: S.c1, property: S.propB })).rejects.toThrow(/NOT_FOUND/);
  });
});

describe('assays and the diff', () => {
  it('counts new intervals, new holes and holes without a collar', async () => {
    const rows = [au(0, 2, 0.41, 0.0025), au(2, 4, 0.55, 0.12), au(4, 6, 0.3), au(6, 8, 1.2),
      { hole_id: 'R-9', from_m: 0, to_m: 1.5, values: { Cu: 0.2 }, units: { Cu: '%' } }, { hole_id: 'R-9', from_m: 1.5, to_m: 3, values: { Cu: 0.1 } }];
    expect(await imp(E, 'assays', rows)).toMatchObject({ ok: true, rows: 6, new: 6, changed: 0, holes: 2, new_holes: 2,
      missing_collars: 1, missing_collar_holes: ['R-9'], overlaps_existing: 0 });
    S.a1 = (await imp(E, 'assays', rows, { dry: false, filename: 'assays-2025.csv' })).batch_id;
    S.before = await current('drill_assays');
    expect(S.before).toHaveLength(6);
    expect(S.before[0]).toMatchObject({ hole_id: 'R-1', from_m: 0, to_m: 2, values: { Cu: 0.41, Au: 0.0025 }, bdl: { Au: 0.005 }, units: { Cu: '%', Au: 'g/t' }, sample_id: 'A0' });
  });

  it('flags bad intervals: negative depths, to not after from, non-numeric values', async () => {
    const d = await imp(E, 'assays', [{ hole_id: 'R-1', from_m: -1, to_m: 2 }, { hole_id: 'R-1', from_m: 5, to_m: 5 },
      { hole_id: 'R-1', from_m: 8, to_m: 9, values: { Cu: '<0.01' } }, { hole_id: 'R-1', from_m: 9, to_m: 10, units: { Cu: 5 } }]);
    expect(d.errors.map((e) => [e.row, e.message])).toEqual([
      [1, 'negative depth'], [2, 'to must be greater than from'],
      [3, 'assay values must be numbers (element names up to 40 characters)'], [4, 'units must map elements to a unit'],
    ]);
  });

  it('a second batch: new, changed and unchanged intervals, overlaps with what is stored', async () => {
    const rows = [au(0, 2, 0.41, 0.0025), au(2, 4, 0.58, 0.12), au(8, 10, 0.9), au(10, 12, 0.7), au(5, 7, 2.1)];
    const d = await imp(A, 'assays', rows);
    expect(d).toMatchObject({ new: 3, changed: 1, unchanged: 1, holes: 1, new_holes: 0, missing_collars: 0, overlaps_existing: 1, overlap_holes: ['R-1'] });
    expect(d.changed_sample).toEqual([{ hole_id: 'R-1', k1: 2, k2: 4, before: expect.objectContaining({ values: { Cu: 0.55, Au: 0.12 } }), after: expect.objectContaining({ values: { Cu: 0.58, Au: 0.12 } }) }]);
    const c = await imp(A, 'assays', rows, { dry: false, filename: 'assays-2026.csv' });
    S.a2 = c.batch_id;
    expect(c).toMatchObject({ committed: true, new: 3, changed: 1, rows_written: 4 });
    expect(await one(V, `select replaces from public.drill_import_batches where id = $1`, [S.a2])).toEqual({ replaces: [S.a1] });
    const now = await current('drill_assays');
    expect(now).toHaveLength(9);
    expect(now.find((r) => r.from_m === 2).values).toEqual({ Cu: 0.58, Au: 0.12 });
    // History is kept: the old 2-4 m interval is still there, superseded.
    expect(await su(`select "values", superseded_by_batch from public.drill_assays where from_m = 2 and batch_id = $1`, [S.a1]))
      .toEqual([{ values: { Cu: 0.55, Au: 0.12 }, superseded_by_batch: S.a2 }]);
  });

  it('a changed collar is reported with what changed', async () => {
    const d = await imp(E, 'collars', [{ ...COLLARS[1], x: 512105 }, COLLARS[0], { hole_id: 'R-9', x: 512300, y: 6700200, depth: 120 }]);
    expect(d).toMatchObject({ new: 1, changed: 1, unchanged: 1, new_holes: 1 });
    expect(d.changed_sample[0]).toMatchObject({ hole_id: 'R-2', before: { x: 512100 }, after: { x: 512105 } });
  });
});

describe('rollback', () => {
  it('cannot skip a later import that replaced its rows', async () => {
    await expect(rollback(E, S.a1)).rejects.toThrow(/BATCH_SUPERSEDED: a later import \(assays-2026\.csv/);
    const s = await summary(V);
    expect(s.batches.map((b) => [b.filename, b.blocked_by])).toEqual([['assays-2026.csv', null], ['assays-2025.csv', S.a2], ['Rails collars.csv', null]]);
  });

  it('is for editors of the workspace only', async () => {
    await expect(rollback(V, S.a2)).rejects.toThrow(/ORG_READ_ONLY/);
    await expect(rollback(X, S.a2)).rejects.toThrow(/NOT_FOUND/);
    await expect(rollback(null, S.a2)).rejects.toThrow(/permission denied/);
    await expect(rollback(E, id(999))).rejects.toThrow(/NOT_FOUND/);
  });

  it('restores exactly the state before the batch, keeping its rows as history', async () => {
    expect(await rollback(E, S.a2)).toEqual({ batch_id: S.a2, rolled_back: true, already: false, withdrawn: 4, restored: 1 });
    expect(await current('drill_assays')).toEqual(S.before);
    expect(await su(`select count(*)::int as n from public.drill_assays where batch_id = $1 and superseded_by_batch = $1`, [S.a2])).toEqual([{ n: 4 }]);
    const b = await one(V, `select rolled_back_at is not null as done, rolled_back_by from public.drill_import_batches where id = $1`, [S.a2]);
    expect(b).toEqual({ done: true, rolled_back_by: E });
    expect(await rollback(A, S.a2)).toMatchObject({ already: true, withdrawn: 0, restored: 0 });
    // The same file can then be imported again, as a new batch.
    expect(await imp(E, 'assays', [au(2, 4, 0.58, 0.12)])).toMatchObject({ changed: 1 });
  });

  it('then the earlier batch can go too, back to no assays at all', async () => {
    expect(await rollback(A, S.a1)).toMatchObject({ withdrawn: 6, restored: 0 });
    expect(await current('drill_assays')).toEqual([]);
    const act = await su(`select action, actor, summary from public.org_activity where entity_type = 'drill_batch' order by created_at, summary`);
    expect(act.map((a) => [a.action, a.summary])).toEqual([
      ['imported', 'Imported 3 collars from "Rails collars.csv" (3 new, 0 changed)'],
      ['imported', 'Imported 6 assay intervals from "assays-2025.csv" (6 new, 0 changed; 2 new holes)'],
      ['imported', 'Imported 5 assay intervals from "assays-2026.csv" (3 new, 1 changed)'],
      ['rolled_back', 'Rolled back the assay intervals import of "assays-2026.csv" (4 rows withdrawn, 1 restored)'],
      ['rolled_back', 'Rolled back the assay intervals import of "assays-2025.csv" (6 rows withdrawn, 0 restored)'],
    ]);
  });
});

describe('summary', () => {
  it('counts current rows and lists the imports for members', async () => {
    S.s1 = (await imp(E, 'surveys', [{ hole_id: 'R-1', depth_m: 0, azimuth: 90, dip: -60 }, { hole_id: 'R-1', depth_m: 150, azimuth: 92, dip: -58 }], { dry: false })).batch_id;
    S.l1 = (await imp(E, 'lithology', [{ hole_id: 'R-1', from_m: 0, to_m: 12, code: 'QMD', description: 'Quartz monzodiorite' }, { hole_id: 'R-4', from_m: 0, to_m: 5, code: 'OVB' }], { dry: false })).batch_id;
    await imp(E, 'assays', [au(0, 2, 0.41, 0.0025), { hole_id: 'R-2', from_m: 0, to_m: 1, values: { Cu: 0.1, Mo: 12 }, units: { Mo: 'ppm' } }], { dry: false });
    const s = await summary(V);
    expect(s).toMatchObject({ collars: 3, planned: 1, metres: 550.5, surveys: 2, assays: 2, lithology: 2, holes: 4, elements: ['Au', 'Cu', 'Mo'], limit: 20000 });
    expect(s.batches).toHaveLength(6);
    expect(s.batches[0]).toMatchObject({ kind: 'assays', rows: 2, created_by_email: 'geo@star.test', rolled_back_at: null });
    expect(s.batches[0].summary).toMatchObject({ new: 2 });
    expect(s.batches[0].summary.changed_sample).toBeUndefined();
    expect(s.batches.find((b) => b.id === S.a2)).toMatchObject({ rolled_back_by_email: 'geo@star.test' });
  });
});

describe('limits', () => {
  it('refuses more than 20,000 rows in one import, even as a dry run', async () => {
    const rows = Array.from({ length: 20001 }, (_, i) => ({ hole_id: `H-${i}`, depth_m: 0, dip: -90 }));
    await expect(imp(E, 'surveys', rows)).rejects.toThrow(/BATCH_TOO_LARGE: 20001 rows; one import takes at most 20,000\. Split files over 20,000 rows/);
    await expect(imp(E, 'surveys', rows, { dry: false })).rejects.toThrow(/BATCH_TOO_LARGE/);
    expect(await su(`select count(*)::int as n from public.drill_surveys`)).toEqual([{ n: 2 }]);
  }, 60_000);

  it('takes 20,000 rows', async () => {
    const rows = Array.from({ length: 20000 }, (_, i) => ({ hole_id: `H-${Math.floor(i / 50)}`, from_m: (i % 50) * 2, to_m: (i % 50) * 2 + 2, values: { Cu: (i % 97) / 100 } }));
    const d = await imp(E, 'assays', rows, { dry: false, filename: 'big.csv' });
    expect(d).toMatchObject({ committed: true, new: 20000, holes: 400, new_holes: 400, missing_collars: 400, rows_written: 20000 });
    expect(d.missing_collar_holes).toHaveLength(10);
    expect(await rollback(E, d.batch_id)).toMatchObject({ withdrawn: 20000 });
  }, 120_000);
});

describe('column templates', () => {
  it('editors save and replace them by name; members read them', async () => {
    const t = await val(E, `select public.drill_save_template($1, 'assays', ' ALS export ', $2::jsonb)`, [S.org, JSON.stringify({ columns: { hole_id: 'HOLEID' } })]);
    expect(t).toMatchObject({ org_id: S.org, kind: 'assays', name: 'ALS export', mapping: { columns: { hole_id: 'HOLEID' } } });
    const t2 = await val(A, `select public.drill_save_template($1, 'assays', 'ALS export', $2::jsonb)`, [S.org, JSON.stringify({ columns: { hole_id: 'BHID' } })]);
    expect(t2.id).toBe(t.id);
    expect((await as(V, `select name, mapping, created_by from public.drill_column_templates`)).rows).toEqual([{ name: 'ALS export', mapping: { columns: { hole_id: 'BHID' } }, created_by: E }]);
    expect((await as(X, `select id from public.drill_column_templates`)).rows).toEqual([]);
    await expect(val(V, `select public.drill_save_template($1, 'assays', 'Mine', '{}'::jsonb)`, [S.org])).rejects.toThrow(/ORG_READ_ONLY/);
    await expect(val(X, `select public.drill_save_template($1, 'assays', 'Mine', '{}'::jsonb)`, [S.org])).rejects.toThrow(/NOT_FOUND/);
    await expect(val(E, `select public.drill_save_template($1, 'assays', '', '{}'::jsonb)`, [S.org])).rejects.toThrow(/INVALID_TEMPLATE/);
    await expect(as(E, `insert into public.drill_column_templates (org_id, kind, name, mapping) values ($1, 'assays', 'x', '{}')`, [S.org])).rejects.toThrow(/permission denied/);
    expect((await as(V, `delete from public.drill_column_templates`)).affectedRows).toBe(0);
    expect((await as(X, `delete from public.drill_column_templates`)).affectedRows).toBe(0);
    expect((await as(E, `delete from public.drill_column_templates where id = $1`, [t.id])).affectedRows).toBe(1);
  });
});

describe('the property', () => {
  it('will not be deleted while it holds live drill imports', async () => {
    await expect(as(A, `update public.properties set deleted_at = now() where id = $1`, [S.prop])).rejects.toThrow(/PROPERTY_NOT_EMPTY/);
    const p = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Rolled back') returning id`, [S.org])).id;
    const b = (await imp(E, 'collars', COLLARS, { dry: false, property: p })).batch_id;
    await rollback(E, b);
    expect((await as(A, `update public.properties set deleted_at = now() where id = $1`, [p])).affectedRows).toBe(1);
    await expect(imp(E, 'collars', COLLARS, { property: p })).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(rollback(E, b)).rejects.toThrow(/NOT_FOUND/);
  });
});
