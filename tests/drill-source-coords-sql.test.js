// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

const migration = readMigration('20261102100000_drill_collar_source_coords.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(2), V = id(3);
let db, val, su, property;
const transform = { method: 'ntv2', grid: 'ca_nrc_ntv2_0_west.gsb', sha256: 'f064', library: 'proj4js 2.21.0' };
const converted = [
  { hole_id: 'SYN-1', x: 512267.1, y: 5432318.4, z: 1200, crs: 'EPSG:26910', x_src: 512345.678, y_src: 5432109.876, crs_src: 'EPSG:26710', transform },
  { hole_id: 'SYN-2', x: 513000, y: 5433000, crs: 'EPSG:26910' },
];
const imp = (input, { dry = true, batch = null, kind = 'collars' } = {}) =>
  val(E, 'select public.drill_import_batch($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)', [property, kind, JSON.stringify(input), '{}', 'collars.csv', dry, batch]);
const current = () => su('select hole_id,x,y,crs,x_src,y_src,crs_src,transform,batch_id from public.drill_collars where property_id=$1 and superseded_by_batch is null order by hole_id', [property]);

beforeAll(async () => {
  ({ db, val, su } = await createWorkspaceDb({ emails: { [O]: 'owner@test.example', [E]: 'editor@test.example', [V]: 'viewer@test.example' }, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), readMigration('20261101110000_drill_qaqc_foundation.sql'),
    readMigration('20261101120000_drill_alteration.sql'),
  ] }));
  const org = (await val(O, "select public.create_organization('Source coordinates')")).id;
  await su("insert into public.organization_members(org_id,user_id,role) values($1,$2,'editor'),($1,$3,'viewer')", [org, E, V]);
  // Collars imported before the migration keep working unchanged.
  property = (await su("insert into public.properties(org_id,name) values($1,'Synthetic') returning id", [org]))[0].id;
  expect(await imp([converted[1]], { dry: false, batch: id(100) })).toMatchObject({ committed: true, rows_written: 1 });
  expect(await imp(converted)).not.toHaveProperty('source_coordinates');
  await db.exec(migration); await db.exec(migration);
}, 30000);
afterAll(async () => { await db?.close(); });

it('keeps grants and still treats legacy collars and alteration imports as before', async () => {
  for (const role of ['anon', 'authenticated']) for (const fn of ['drill_incoming(text,jsonb)', 'drill_current(text,uuid)', 'drill_row_errors(text,jsonb)'])
    expect(await su('select has_function_privilege($1,$2,$3) as allowed', [role, `public.${fn}`, 'EXECUTE'])).toEqual([{ allowed: false }]);
  expect(await su("select has_function_privilege('authenticated','public.drill_import_batch(uuid,text,jsonb,jsonb,text,boolean,uuid)','EXECUTE') as allowed")).toEqual([{ allowed: true }]);
  expect(await imp([converted[1]])).toMatchObject({ unchanged: 1, source_coordinates: 0 });
  expect(await imp([{ hole_id: 'SYN-1', from_m: 0, to_m: 1, code: 'SER' }], { kind: 'alteration' })).toMatchObject({ ok: true, new: 1 });
  await expect(val(V, 'select public.drill_import_batch($1,$2,$3::jsonb)', [property, 'collars', JSON.stringify(converted)])).rejects.toThrow(/ORG_READ_ONLY/);
});

it('stores converted collars with their originals; unchanged on re-import, also with new method metadata', async () => {
  expect(await imp(converted)).toMatchObject({ ok: true, new: 1, unchanged: 1, source_coordinates: 1 });
  expect(await imp(converted, { dry: false, batch: id(101) })).toMatchObject({ committed: true, rows_written: 1 });
  expect((await current())[0]).toEqual({ hole_id: 'SYN-1', x: 512267.1, y: 5432318.4, crs: 'EPSG:26910', x_src: 512345.678, y_src: 5432109.876, crs_src: 'EPSG:26710', transform, batch_id: id(101) });
  expect((await current())[1]).toMatchObject({ hole_id: 'SYN-2', x_src: null, transform: null, batch_id: id(100) });
  expect(await imp(converted, { dry: false })).toMatchObject({ nothing_to_do: true, unchanged: 2 });
  const relabelled = [{ ...converted[0], transform: { ...transform, library: 'proj4js 2.22.0' } }];
  expect(await imp(relabelled, { dry: false })).toMatchObject({ nothing_to_do: true, unchanged: 1 });
});

it('versions a change of source values or of provenance, and rolls back to the originals', async () => {
  const resurveyed = [{ ...converted[0], x_src: 512345.7 }];
  expect(await imp(resurveyed)).toMatchObject({ changed: 1, changed_sample: [{ before: { x_src: 512345.678 }, after: { x_src: 512345.7 } }] });
  const direct = [{ hole_id: 'SYN-1', x: 512267.1, y: 5432318.4, z: 1200, crs: 'EPSG:26910' }];
  expect(await imp(direct, { dry: false, batch: id(102) })).toMatchObject({ changed: 1, rows_written: 1 });
  expect((await current())[0]).toMatchObject({ x_src: null, crs_src: null, transform: null, batch_id: id(102) });
  expect(await val(E, 'select public.drill_rollback_batch($1)', [id(102)])).toMatchObject({ rolled_back: true, restored: 1 });
  expect((await current())[0]).toMatchObject({ x_src: 512345.678, crs_src: 'EPSG:26710', transform, batch_id: id(101) });
  expect(await val(E, 'select public.drill_rollback_batch($1)', [id(101)])).toMatchObject({ rolled_back: true });
  expect((await current()).map(r => r.hole_id)).toEqual(['SYN-2']);
});

it('rejects incomplete or invalid source coordinates without writing', async () => {
  const c = converted[0];
  const { transform: _t, ...noTransform } = c;
  const bad = [noTransform, { ...c, hole_id: 'B', x_src: '512345' }, { ...c, hole_id: 'C', crs_src: '26710' }, { ...c, hole_id: 'D', crs_src: 'EPSG:26910' },
    { ...c, hole_id: 'F', crs: undefined }, { ...c, hole_id: 'G', transform: 'ntv2' }, { ...c, hole_id: 'H', transform: { grid: 'x' } },
    { ...c, hole_id: 'I', transform: { method: 'ntv2', note: 'x'.repeat(3000) } }];
  const result = await imp(bad);
  expect(result.ok).toBe(false);
  expect(result.errors.map(e => [e.row, e.message])).toEqual(expect.arrayContaining([
    [1, 'source coordinates need x_src, y_src, crs_src and transform together'], [2, 'x_src and y_src must be numbers'],
    [3, 'source coordinate system must be EPSG:<code>'], [4, 'a converted collar needs a coordinate system other than its source'],
    [5, 'a converted collar needs a coordinate system other than its source'], [6, 'transform must be an object naming its method'],
    [7, 'transform must be an object naming its method'], [8, 'transform must be an object naming its method']]));
  await expect(imp(bad, { dry: false })).rejects.toThrow(/INVALID_ROWS/);
  await expect(su("insert into public.drill_collars(org_id,property_id,batch_id,hole_id,x,y,crs,x_src) select org_id,property_id,id,'Z',1,2,'EPSG:26910',3 from public.drill_import_batches limit 1"))
    .rejects.toThrow(/drill_collars_source_coords_check/);
});
