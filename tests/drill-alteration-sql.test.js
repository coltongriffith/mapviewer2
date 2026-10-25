// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

const migration = readMigration('20261101120000_drill_alteration.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(2), V = id(3), X = id(4);
let db, as, val, su, org, property, other, guardBefore, guardAfter;
const rows = [
  { hole_id: 'Z', from_m: 0, to_m: 10, code: 'SER', intensity: '03' },
  { hole_id: 'A', from_m: 10, to_m: 20, description: 'Source observation', intensity: 'weak' },
];
const imp = (user, input = rows, { dry = true, batch = null, prop = property, mapping = {}, kind = 'alteration' } = {}) =>
  val(user, 'select public.drill_import_batch($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)', [prop, kind, JSON.stringify(input), JSON.stringify(mapping), 'alteration.csv', dry, batch]);
const rollback = (user, batch) => val(user, 'select public.drill_rollback_batch($1)', [batch]);
const current = () => su('select hole_id,from_m,to_m,code,description,intensity,source_row,batch_id from public.drill_alteration where property_id=$1 and superseded_by_batch is null order by hole_id', [property]);

beforeAll(async () => {
  ({ db, as, val, su } = await createWorkspaceDb({ emails: { [O]: 'owner@test.example', [E]: 'editor@test.example', [V]: 'viewer@test.example', [X]: 'other@test.example' }, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), readMigration('20261101110000_drill_qaqc_foundation.sql'),
  ] }));
  guardBefore = await su("select prosrc,proacl::text from pg_proc where oid='public.ws_property_has_content(uuid)'::regprocedure");
  await db.exec(migration); await db.exec(migration);
  guardAfter = await su("select prosrc,proacl::text from pg_proc where oid='public.ws_property_has_content(uuid)'::regprocedure");
  org = (await val(O, "select public.create_organization('Alteration test')")).id;
  const otherOrg = (await val(X, "select public.create_organization('Other')")).id;
  await su("insert into public.organization_members(org_id,user_id,role) values($1,$2,'editor'),($1,$3,'viewer')", [org, E, V]);
  property = (await as(E, "insert into public.properties(org_id,name) values($1,'Source logs') returning id", [org])).rows[0].id;
  other = (await as(X, "insert into public.properties(org_id,name) values($1,'Other logs') returning id", [otherOrg])).rows[0].id;
}, 30000);
afterAll(async () => { await db?.close(); });

it('retains the existing QA property guard and exact function/table grants after repeated migration', async () => {
  expect(guardAfter).toEqual(guardBefore);
  expect(guardAfter[0].prosrc).toContain('drill_qaqc_batches');
  expect(await su("select relrowsecurity as enabled from pg_class where oid='public.drill_alteration'::regclass")).toEqual([{ enabled: true }]);
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(await su('select has_table_privilege($1,$2,$3) as allowed', [role, 'public.drill_alteration', privilege])).toEqual([{ allowed: false }]);
    for (const fn of ['drill_incoming(text,jsonb)', 'drill_current(text,uuid)', 'drill_table(text)', 'drill_row_errors(text,jsonb)']) expect(await su('select has_function_privilege($1,$2,$3) as allowed', [role, `public.${fn}`, 'EXECUTE'])).toEqual([{ allowed: false }]);
  }
  expect(await su("select has_table_privilege('anon','public.drill_alteration','SELECT') as allowed")).toEqual([{ allowed: false }]);
  await expect(as(null, 'select * from public.drill_alteration')).rejects.toThrow(/permission denied/);
  await expect(imp(null)).rejects.toThrow(/permission denied/);
  await expect(imp(V)).rejects.toThrow(/ORG_READ_ONLY/);
  await expect(imp(V, rows, { dry: false })).rejects.toThrow(/ORG_READ_ONLY/);
  await expect(imp(X)).rejects.toThrow(/NOT_FOUND|forbidden/);
  await expect(imp(E, rows, { prop: other })).rejects.toThrow(/NOT_FOUND|forbidden/);
  await expect(imp(E, rows, { prop: id(999) })).rejects.toThrow(/NOT_FOUND|forbidden/);
  await expect(imp(E, rows, { kind: 'alteration; delete' })).rejects.toThrow(/INVALID_KIND/);
});

it('dry runs then stores source text and source order without creating collars', async () => {
  expect(await imp(E)).toMatchObject({ ok: true, new: 2, changed: 0, missing_collars: 2 });
  expect(await current()).toEqual([]);
  expect(await imp(E, rows, { dry: false, batch: id(101) })).toMatchObject({ committed: true, rows_written: 2 });
  expect(await current()).toEqual([
    { ...rows[1], code: null, source_row: 2, batch_id: id(101) },
    { ...rows[0], description: null, source_row: 1, batch_id: id(101) },
  ]);
  expect((await as(V, 'select * from public.drill_alteration')).rows).toHaveLength(2);
  expect((await as(X, 'select * from public.drill_alteration')).rows).toEqual([]);
  expect(await su('select count(*)::int as n from public.drill_collars')).toEqual([{ n: 0 }]);
  expect(await val(V, 'select public.drill_property_summary($1)', [property])).toMatchObject({ alteration: 2, holes: 2, collars: 0, lithology: 0 });
  for (const user of [O, E, V]) {
    await expect(as(user, 'update public.drill_alteration set intensity=$1', ['changed'])).rejects.toThrow(/permission denied/);
    await expect(as(user, 'delete from public.drill_alteration')).rejects.toThrow(/permission denied/);
  }
  await expect(rollback(V, id(101))).rejects.toThrow(/ORG_READ_ONLY/);
  await expect(rollback(X, id(101))).rejects.toThrow(/NOT_FOUND|forbidden/);
});

it('unchanged reimports preserve provenance; intensity-only changes version and roll back correctly', async () => {
  expect(await imp(E, [...rows].reverse(), { dry: false })).toMatchObject({ nothing_to_do: true, unchanged: 2 });
  const changed = [{ ...rows[0], intensity: '0' }, rows[1]];
  expect(await imp(E, changed, { dry: false, batch: id(102) })).toMatchObject({ new: 0, changed: 1, unchanged: 1, rows_written: 1 });
  expect(await su('select replaces from public.drill_import_batches where id=$1', [id(102)])).toEqual([{ replaces: [id(101)] }]);
  expect((await current()).find(r => r.hole_id === 'A')).toMatchObject({ batch_id: id(101), source_row: 2 });
  expect((await current()).find(r => r.hole_id === 'Z')).toMatchObject({ intensity: '0', batch_id: id(102) });
  await expect(rollback(E, id(101))).rejects.toThrow(/LATER|DEPEND|BLOCK/i);
  expect(await rollback(E, id(102))).toMatchObject({ rolled_back: true });
  expect((await current()).find(r => r.hole_id === 'Z')).toMatchObject({ intensity: '03', batch_id: id(101) });
  // Original importer returns the stored batch result on retry, including after rollback.
  expect(await imp(E, [{ ...rows[0], intensity: 'another payload' }], { dry: false, batch: id(102) })).toMatchObject({ replayed: true, rolled_back: true, batch_id: id(102) });
  expect(await su('select count(*)::int as n from public.drill_alteration')).toEqual([{ n: 3 }]);
});

it('canonicalizes blank/null/absent intensity equally and versions code/description', async () => {
  const r = { hole_id: 'N', from_m: 0, to_m: 1, code: 'ALT' };
  await imp(E, [r], { dry: false, batch: id(103) });
  for (const intensity of [null, '', '   ']) expect(await imp(E, [{ ...r, intensity }], { dry: false })).toMatchObject({ nothing_to_do: true });
  expect(await imp(E, [{ ...r, code: 'NEW', description: 'changed' }], { dry: false, batch: id(104) })).toMatchObject({ changed: 1 });
  await rollback(E, id(104)); await rollback(E, id(103));
});

it('rejects ambiguous interval identity and invalid text/numbers without partial writes', async () => {
  const bad = [rows[0], rows[0], { ...rows[0], hole_id: ' ' }, { ...rows[0], hole_id: 123 },
    { ...rows[0], from_m: -1 }, { ...rows[0], to_m: 0 }, { ...rows[0], to_m: 1e12 }, { ...rows[0], from_m: '0' },
    { ...rows[0], code: null }, { ...rows[0], intensity: 3 }, { ...rows[0], intensity: {} },
    { ...rows[0], intensity: 'x'.repeat(61) }, { ...rows[0], code: 'x'.repeat(61) },
    { ...rows[0], description: 'x'.repeat(501) }, { ...rows[0], description: false }, null];
  const result = await imp(E, bad);
  expect(result.ok).toBe(false); expect(result.error_count).toBeGreaterThan(15);
  expect(result.errors.some(e => /same hole and interval/.test(e.message))).toBe(true);
  expect(result.errors.some(e => e.message === 'intensity must be text')).toBe(true);
  await expect(imp(E, bad, { dry: false })).rejects.toThrow(/INVALID_ROWS/);
  expect(await current()).toHaveLength(2);
});

it('preserves overlapping logged intervals and exposes editable alteration templates', async () => {
  const overlaps = [{ ...rows[0], from_m: 5, to_m: 12 }, { ...rows[0], from_m: 8, to_m: 15 }];
  expect(await imp(E, overlaps, { dry: false, batch: id(105) })).toMatchObject({ new: 2, overlaps_existing: 1, rows_written: 2 });
  expect(await current()).toHaveLength(4);
  const template = await val(E, 'select public.drill_save_template($1,$2,$3,$4::jsonb)', [org, 'alteration', 'Logs', JSON.stringify({ columns: { intensity: 'Intensity' } })]);
  expect(template).toBeTruthy();
  expect((await as(V, "select mapping from public.drill_column_templates where kind='alteration'")).rows).toEqual([{ mapping: { columns: { intensity: 'Intensity' } } }]);
  expect((await as(X, "select * from public.drill_column_templates where kind='alteration'")).rows).toEqual([]);
  await expect(val(V, 'select public.drill_save_template($1,$2,$3,$4::jsonb)', [org, 'alteration', 'No', '{}'])).rejects.toThrow(/forbidden|ORG_READ_ONLY/);
  await rollback(E, id(105));
});

it('keeps row/byte/mapping/history limits and does not inflate history on no-op', async () => {
  await expect(imp(E, Array(20001).fill(rows[0]))).rejects.toThrow(/BATCH_TOO_LARGE/);
  await expect(imp(E, [{ ...rows[0], extra: 'x'.repeat(13 * 1024 * 1024) }])).rejects.toThrow(/BATCH_TOO_LARGE/);
  await expect(imp(E, rows, { mapping: { extra: 'x'.repeat(65536) } })).rejects.toThrow(/INVALID_MAPPING/);
  const written = await su('select sum(rows_written)::int as n from public.drill_import_batches where property_id=$1', [property]);
  await imp(E, rows, { dry: false });
  expect(await su('select sum(rows_written)::int as n from public.drill_import_batches where property_id=$1', [property])).toEqual(written);
  await su('update public.drill_import_batches set rows_written=2000000 where id=$1', [id(101)]);
  await expect(imp(E, [{ ...rows[0], hole_id: 'FULL' }], { dry: false })).rejects.toThrow(/DRILL_PROPERTY_FULL/);
  await su('update public.drill_import_batches set rows_written=2 where id=$1', [id(101)]);
  expect(await current()).toHaveLength(2);
});

it('can reapply with populated alteration history and templates without changing data', async () => {
  const before = await su('select * from public.drill_alteration order by id');
  await db.exec(migration);
  expect(await su('select * from public.drill_alteration order by id')).toEqual(before);
  expect(await su("select prosrc,proacl::text from pg_proc where oid='public.ws_property_has_content(uuid)'::regprocedure")).toEqual(guardBefore);
  expect(await imp(E, rows, { dry: false })).toMatchObject({ nothing_to_do: true });
});
