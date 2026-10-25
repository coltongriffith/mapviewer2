// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

const migration = readMigration('20261102110000_drill_structure.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(2), V = id(3), X = id(4);
let db, as, val, su, org, property, other, guardBefore;
const rows = [
  { hole_id: 'Z', depth_m: 12.5, type: 'vein', alpha: 45, beta: 210 },
  { hole_id: 'A', depth_m: 30, type: 'fault', dip: 70, dip_direction: 135, description: 'Gouge, 5 cm' },
  { hole_id: 'A', depth_m: 31, description: 'Broken core, no orientation' },
];
const imp = (user, input = rows, { dry = true, batch = null, prop = property, kind = 'structure' } = {}) =>
  val(user, 'select public.drill_import_batch($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)', [prop, kind, JSON.stringify(input), '{}', 'structure.csv', dry, batch]);
const rollback = (user, batch) => val(user, 'select public.drill_rollback_batch($1)', [batch]);
const current = () => su('select hole_id,depth_m,type,alpha,beta,dip,dip_direction,description,source_row,batch_id from public.drill_structure where property_id=$1 and superseded_by_batch is null order by hole_id,depth_m', [property]);
const full = (r, extra) => ({ type: null, alpha: null, beta: null, dip: null, dip_direction: null, description: null, ...r, ...extra });

beforeAll(async () => {
  ({ db, as, val, su } = await createWorkspaceDb({ emails: { [O]: 'owner@test.example', [E]: 'editor@test.example', [V]: 'viewer@test.example', [X]: 'other@test.example' }, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), readMigration('20261101110000_drill_qaqc_foundation.sql'),
    readMigration('20261101120000_drill_alteration.sql'), readMigration('20261102100000_drill_collar_source_coords.sql'),
  ] }));
  guardBefore = await su("select prosrc,proacl::text from pg_proc where oid='public.ws_property_has_content(uuid)'::regprocedure");
  await db.exec(migration); await db.exec(migration);
  org = (await val(O, "select public.create_organization('Structure test')")).id;
  const otherOrg = (await val(X, "select public.create_organization('Other')")).id;
  await su("insert into public.organization_members(org_id,user_id,role) values($1,$2,'editor'),($1,$3,'viewer')", [org, E, V]);
  property = (await as(E, "insert into public.properties(org_id,name) values($1,'Core logs') returning id", [org])).rows[0].id;
  other = (await as(X, "insert into public.properties(org_id,name) values($1,'Other logs') returning id", [otherOrg])).rows[0].id;
}, 30000);
afterAll(async () => { await db?.close(); });

it('keeps RLS, grants and the QA property guard after repeated migration', async () => {
  expect(await su("select prosrc,proacl::text from pg_proc where oid='public.ws_property_has_content(uuid)'::regprocedure")).toEqual(guardBefore);
  expect(await su("select relrowsecurity as enabled from pg_class where oid='public.drill_structure'::regclass")).toEqual([{ enabled: true }]);
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(await su('select has_table_privilege($1,$2,$3) as allowed', [role, 'public.drill_structure', privilege])).toEqual([{ allowed: false }]);
    for (const fn of ['drill_incoming(text,jsonb)', 'drill_current(text,uuid)', 'drill_table(text)', 'drill_row_errors(text,jsonb)']) expect(await su('select has_function_privilege($1,$2,$3) as allowed', [role, `public.${fn}`, 'EXECUTE'])).toEqual([{ allowed: false }]);
  }
  expect(await su("select has_table_privilege('anon','public.drill_structure','SELECT') as allowed")).toEqual([{ allowed: false }]);
  await expect(as(null, 'select * from public.drill_structure')).rejects.toThrow(/permission denied/);
  await expect(imp(null)).rejects.toThrow(/permission denied/);
  await expect(imp(V)).rejects.toThrow(/ORG_READ_ONLY/);
  await expect(imp(X)).rejects.toThrow(/NOT_FOUND|forbidden/);
  await expect(imp(E, rows, { prop: other })).rejects.toThrow(/NOT_FOUND|forbidden/);
});

it('dry runs, then imports point measurements keyed by hole and depth', async () => {
  expect(await imp(E)).toMatchObject({ ok: true, new: 3, changed: 0, holes: 2, missing_collars: 2, overlaps_existing: 0 });
  expect(await current()).toEqual([]);
  expect(await imp(E, rows, { dry: false, batch: id(101) })).toMatchObject({ committed: true, rows_written: 3 });
  expect(await current()).toEqual([
    full(rows[1], { source_row: 2, batch_id: id(101) }), full(rows[2], { source_row: 3, batch_id: id(101) }), full(rows[0], { source_row: 1, batch_id: id(101) }),
  ]);
  expect((await as(V, 'select * from public.drill_structure')).rows).toHaveLength(3);
  expect((await as(X, 'select * from public.drill_structure')).rows).toEqual([]);
  expect(await val(V, 'select public.drill_property_summary($1)', [property])).toMatchObject({ structure: 3, holes: 2, alteration: 0, collars: 0 });
  for (const user of [O, E, V]) await expect(as(user, 'update public.drill_structure set alpha=1')).rejects.toThrow(/permission denied/);
});

it('re-imports unchanged as a no-op, versions a change and rolls it back', async () => {
  expect(await imp(E, [...rows].reverse(), { dry: false })).toMatchObject({ nothing_to_do: true, unchanged: 3 });
  const changed = [{ ...rows[0], alpha: 50 }, rows[1], rows[2]];
  const preview = await imp(E, changed);
  expect(preview).toMatchObject({ new: 0, changed: 1, unchanged: 2 });
  expect(preview.changed_sample).toEqual([{ hole_id: 'Z', k1: 12.5, k2: null, before: { type: 'vein', alpha: 45, beta: 210 }, after: { type: 'vein', alpha: 50, beta: 210 } }]);
  expect(await imp(E, changed, { dry: false, batch: id(102) })).toMatchObject({ changed: 1, rows_written: 1 });
  expect(await su('select replaces from public.drill_import_batches where id=$1', [id(102)])).toEqual([{ replaces: [id(101)] }]);
  expect((await current()).find(r => r.hole_id === 'Z')).toMatchObject({ alpha: 50, batch_id: id(102) });
  await expect(rollback(E, id(101))).rejects.toThrow(/LATER|DEPEND|BLOCK/i);
  await expect(rollback(V, id(102))).rejects.toThrow(/ORG_READ_ONLY/);
  expect(await rollback(E, id(102))).toMatchObject({ rolled_back: true });
  expect((await current()).find(r => r.hole_id === 'Z')).toMatchObject({ alpha: 45, batch_id: id(101) });
  expect(await imp(E, changed, { dry: false, batch: id(102) })).toMatchObject({ replayed: true, rolled_back: true });
});

it('rejects out-of-range angles, incomplete orientations and duplicate depths without writing', async () => {
  const r = rows[0];
  const cases = [
    [{ ...r, alpha: 91 }, 'alpha outside 0 to 90'], [{ ...r, alpha: -1 }, 'alpha outside 0 to 90'], [{ ...r, beta: 361 }, 'beta outside 0 to 360'],
    [{ ...rows[1], dip: 95 }, 'dip outside 0 to 90'], [{ ...rows[1], dip: -10 }, 'dip outside 0 to 90'], [{ ...rows[1], dip_direction: 400 }, 'dip direction outside 0 to 360'],
    [{ hole_id: 'Q', depth_m: 1, beta: 10, description: 'x' }, 'beta needs an alpha'], [{ hole_id: 'Q', depth_m: 1, dip_direction: 10, alpha: 5 }, 'dip direction needs a dip'],
    [{ hole_id: 'Q', depth_m: 1, type: 'joint' }, 'a structure needs an alpha, a dip or a description'], [{ ...r, alpha: '45' }, 'alpha, beta, dip and dip direction must be numbers'],
    [{ ...r, depth_m: null }, 'depth must be a number'], [{ ...r, depth_m: -1 }, 'negative depth'], [{ ...r, hole_id: 7 }, 'hole ID must be text'],
    [{ ...r, type: 3 }, 'type must be text'], [{ ...r, type: 'x'.repeat(61) }, 'type longer than 60 characters'],
    [{ ...r, description: 'x'.repeat(501) }, 'description longer than 500 characters'],
  ];
  for (const [row, message] of cases) {
    const result = await imp(E, [row]);
    expect(result.ok, message).toBe(false); expect(result.errors.map(e => e.message), message).toContain(message);
  }
  const dup = await imp(E, [r, { ...r, type: 'shear' }]);
  expect(dup.errors).toEqual([{ row: 2, message: 'the same hole and depth appears more than once (first on row 1)' }]);
  expect((await imp(E, [{ ...r, alpha: 0, beta: 0 }, { ...rows[1], dip: 90, dip_direction: 360 }])).ok).toBe(true);
  await expect(imp(E, [{ ...r, alpha: 91 }], { dry: false })).rejects.toThrow(/INVALID_ROWS/);
  expect(await current()).toHaveLength(3);
});

it('accepts structure templates, keeps legacy kinds working and reapplies without changing data', async () => {
  expect(await val(E, 'select public.drill_save_template($1,$2,$3,$4::jsonb)', [org, 'structure', 'Core', JSON.stringify({ columns: { alpha: 'Alpha' } })])).toMatchObject({ kind: 'structure' });
  expect(await imp(E, [{ hole_id: 'A', from_m: 0, to_m: 1, code: 'SER' }], { kind: 'alteration' })).toMatchObject({ ok: true, new: 1 });
  expect(await imp(E, [{ hole_id: 'A', depth_m: 30, dip: -60 }], { kind: 'surveys' })).toMatchObject({ ok: true, new: 1 });
  expect(await su("select public.drill_kind_noun('structure', 1) as one, public.drill_kind_noun('structure', 2) as many")).toEqual([{ one: 'structure measurement', many: 'structure measurements' }]);
  const before = await su('select * from public.drill_structure order by id');
  await db.exec(migration);
  expect(await su('select * from public.drill_structure order by id')).toEqual(before);
  expect(await imp(E, rows, { dry: false })).toMatchObject({ nothing_to_do: true });
});
