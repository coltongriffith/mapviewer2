// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(2), V = id(3), X = id(4);
let db, as, one, val, su, org, prop, other, rival, batch, file;
const migration = readMigration('20261101100000_drill_batch_certificates.sql');
const link = (uid, b = batch, f = file, v = 1) => as(uid, 'insert into public.drill_batch_files(batch_id,file_id,version) values($1,$2,$3)', [b, f, v]);
const list = (uid, b = batch) => as(uid, 'select * from public.drill_batch_certificates($1)', [b]);
async function upload(property, organization, name, uid = E, fileId = id(50), version = 1) {
  const path = `${organization}/${property}/${fileId}/v${version}/${name}`;
  await as(uid, `insert into storage.objects(bucket_id,name) values('property-files',$1)`, [path]);
  await val(uid, `select public.add_property_file_version($1,$2,$3,'document',null,$4,12,$5,null)`, [property, fileId, name, path, String(version).repeat(64)]);
  return fileId;
}
async function imp(kind = 'assays') {
  const rows = kind === 'assays' ? [{ hole_id:'TEST-1', from_m:0, to_m:1, values:{Au:1}, units:{Au:'g/t'}, bdl:{} }]
    : [{ hole_id:'TEST-1', x:1, y:2 }];
  return (await val(E, `select public.drill_import_batch($1,$2,$3::jsonb,'{}','fixture.csv',false,null)`, [prop, kind, JSON.stringify(rows)])).batch_id;
}
beforeAll(async () => {
  ({db, as, one, val, su} = await createWorkspaceDb({emails:{[O]:'owner@test.com',[E]:'editor@test.com',[V]:'viewer@test.com',[X]:'rival@test.com'}, migrations:[
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), migration, migration,
  ]}));
  org = (await val(O, `select public.create_organization('Test')`)).id;
  rival = (await val(X, `select public.create_organization('Rival')`)).id;
  await su(`insert into public.organization_members(org_id,user_id,role) values($1,$2,'editor'),($1,$3,'viewer')`,[org,E,V]);
  prop = (await one(E, `insert into public.properties(org_id,name) values($1,'One') returning id`,[org])).id;
  other = (await one(E, `insert into public.properties(org_id,name) values($1,'Two') returning id`,[org])).id;
  batch = await imp(); file = await upload(prop, org, 'lab.pdf');
},120000);
afterAll(async () => db?.close());

it('restricts all entry points and rejects other properties, kinds, versions and spoofed metadata', async () => {
  await expect(link(V)).rejects.toThrow(/CERTIFICATE_NOT_FOUND/);
  await expect(link(X)).rejects.toThrow(/CERTIFICATE_NOT_FOUND/);
  await expect(link(null)).rejects.toThrow(/permission denied/);
  await expect(list(null)).rejects.toThrow(/permission denied/);
  const otherFile = await upload(other,org,'other.pdf',E,id(51));
  await expect(link(E,batch,otherFile)).rejects.toThrow(/CERTIFICATE_NOT_FOUND/);
  const rivalProperty = (await one(X, `insert into public.properties(org_id,name) values($1,'Private') returning id`,[rival])).id;
  const rivalFile = await upload(rivalProperty,rival,'rival.pdf',X,id(52));
  await expect(link(E,batch,rivalFile)).rejects.toThrow(/CERTIFICATE_NOT_FOUND/);
  const text = await upload(prop,org,'not-pdf.csv',E,id(53));
  await expect(link(E,batch,text)).rejects.toThrow(/CERTIFICATE_NOT_FOUND/);
  await expect(link(E,batch,file,99)).rejects.toThrow(/CERTIFICATE_NOT_FOUND/);
  await expect(link(E,await imp('collars'))).rejects.toThrow(/CERTIFICATE_NOT_FOUND/);
  await expect(as(E, `insert into public.drill_batch_files(batch_id,file_id,version,name,sha256,linked_by) values($1,$2,1,'spoof','fake',$3)`,[batch,file,O])).rejects.toThrow(/permission denied/);
  expect((await list(X)).rows).toEqual([]);
});
it('pins the immutable version and snapshot, and prevents edits/deletion', async () => {
  await link(E);
  const first = (await list(V)).rows[0];
  expect(first).toMatchObject({file_id:file,version:1,name:'lab.pdf',sha256:'1'.repeat(64)});
  expect(first.storage_path).toContain('/v1/lab.pdf');
  await upload(prop,org,'lab.pdf',E,file,2);
  await as(E, `update public.property_files set name='renamed.pdf' where id=$1`,[file]);
  expect((await list(V)).rows[0]).toEqual(first);
  await expect(link(E)).rejects.toThrow(/duplicate key/);
  await expect(as(E, `update public.drill_batch_files set version=2`)).rejects.toThrow(/permission denied/);
  await expect(as(O, `delete from public.drill_batch_files`)).rejects.toThrow(/permission denied/);
  expect(await one(E, `select linked_by from public.drill_batch_files where batch_id=$1`,[batch])).toEqual({linked_by:E});
  const functions = await su(`select prosecdef, proconfig, has_function_privilege('anon',oid,'execute') as anon from pg_proc where proname in ('drill_batch_file_guard','drill_batch_certificates')`);
  expect(functions).toHaveLength(2);
  functions.forEach(f => { expect(f.prosecdef).toBe(false); expect(f.anon).toBe(false); expect(f.proconfig).toEqual(['search_path=""']); });
});
it('rollback retains certificate history and prevents new attachments', async () => {
  await val(E, `select public.drill_rollback_batch($1)`,[batch]);
  expect((await list(V)).rows).toHaveLength(1);
  await expect(link(E,batch,file,2)).rejects.toThrow(/CERTIFICATE_NOT_FOUND/);
  expect(await val(E, `select count(*)::int from public.drill_assays where superseded_by_batch is null`)).toBe(0);
});
it('editors can retract an incorrect link without rewriting provenance or deleting the file', async () => {
  const retract = (uid, reason) => as(uid, `update public.drill_batch_files set retraction_reason=$1 where batch_id=$2 returning *`,[reason,batch]);
  expect((await retract(V, 'Wrong job')).rows).toEqual([]);
  expect((await retract(X, 'Wrong job')).rows).toEqual([]);
  await expect(retract(E, ' ')).rejects.toThrow(/CERTIFICATE_RETRACTION_INVALID/);
  const row = (await retract(E, ' Wrong lab job ')).rows[0];
  expect(row).toMatchObject({name:'lab.pdf',sha256:'1'.repeat(64),version:1,linked_by:E,retracted_by:E,retraction_reason:'Wrong lab job'});
  expect(row.retracted_at).toBeTruthy();
  expect((await list(V)).rows[0].retraction_reason).toBe('Wrong lab job');
  await expect(retract(E, 'rewrite reason')).rejects.toThrow(/CERTIFICATE_RETRACTION_INVALID/);
  expect(await val(E, `select count(*)::int from public.property_file_versions where file_id=$1`,[file])).toBe(2);
});
it('soft deletion hides download paths while retaining provenance, including for admins', async () => {
  await as(O, `update public.property_files set deleted_at=now() where id=$1`,[file]);
  for (const user of [O,E,V]) expect((await list(user)).rows[0]).toMatchObject({name:'lab.pdf',version:1,storage_path:null});
  expect((await list(X)).rows).toEqual([]);
});
