// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// Published figure versions, Phase 5A (20261029100000): the server copies the
// saved figure, nobody changes or deletes a version, its data files stay in
// storage, and only the figure's readers see it. The workspace, data library
// and drill migrations come first; this one is applied twice.
//
// Tests run in order and share state: each describe builds on the last.
let db, as, one, val, su;
const MIGRATION = readMigration('20261029100000_figure_versions.sql');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1); // owner of the company, and of a personal figure
const E = id(3); // editor
const V = id(4); // viewer
const X = id(5); // someone else
const EMAIL = { [O]: 'owner@star.test', [E]: 'geo@star.test', [V]: 'investor@fund.test', [X]: 'rival@rival.test' };
const S = {};
const SETTINGS = { v: 1, settings: { title: 'RAILS', designVersion: 3, subtitle: 'Looking north' }, camera: { azimuth: 200, plunge: 35, zoom: 130 } };
const THUMB = 'data:image/jpeg;base64,AAAA';

const publish = (uid, kind, fig, label = 'News release 2026-10-21', date = '2026-10-21', expected = null) =>
  val(uid, `select public.publish_figure_version($1, $2, $3, $4, $5)`, [kind, fig, label, date, expected]);
const files = async (rows) => {
  for (const [name, size] of rows) await su(`insert into storage.objects (bucket_id, name, metadata) values ('three-d-files', $1, $2)`, [name, { size, eTag: `"${createHash('md5').update(name).digest('hex')}"` }]);
};

beforeAll(async () => {
  ({ db, as, one, val, su } = await createWorkspaceDb({ emails: EMAIL, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), MIGRATION, MIGRATION] }));
  await su(`alter table storage.objects add column if not exists metadata jsonb`); // as in Supabase
  S.org = (await val(O, `select public.create_organization('Star Copper Corp.')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`, [S.org, E, V]);
  S.prop = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Rails') returning id`, [S.org])).id;

  // A personal figure saved the way account-core.js saves one: its files in a folder of their own.
  S.fig = id(100);
  S.paths = [`${O}/${S.fig}/r1/collars.csv`, `${O}/${S.fig}/r1/assays.csv`];
  await files([[S.paths[0], 120], [S.paths[1], 3400]]);
  S.saved = (await one(O, `insert into public.three_d_projects (id, name, settings, file_paths, thumbnail) values ($1, 'Rails zone', $2, $3, $4) returning *`,
    [S.fig, SETTINGS, S.paths.map((p, i) => ({ name: p.split('/').pop(), path: p, size: [120, 3400][i], role: ['collar', 'assay'][i] })), THUMB]));
}, 120_000);
afterAll(async () => db?.close());

describe('migration', () => {
  it('pins search_path, gives anon nothing and the browser only the two RPCs and the storage check', async () => {
    const fns = await su(`select proname, proconfig, prosecdef, has_function_privilege('anon', oid, 'execute') as anon,
      has_function_privilege('authenticated', oid, 'execute') as auth from pg_proc
      where proname in ('figure_versions_immutable', 'figure_version_file', 'publish_figure_version', 'list_figure_versions') order by proname`);
    expect(fns.map((f) => [f.proname, f.prosecdef, f.anon, f.auth])).toEqual([
      ['figure_version_file', true, false, true], ['figure_versions_immutable', true, false, false],
      ['list_figure_versions', true, false, true], ['publish_figure_version', true, false, true]]);
    for (const f of fns) expect(f.proconfig?.[0], f.proname).toBe('search_path=""');
    const grants = await su(`select grantee, privilege_type from information_schema.role_table_grants
      where table_name = 'figure_versions' and grantee in ('anon', 'authenticated') order by 1, 2`);
    expect(grants).toEqual([{ grantee: 'authenticated', privilege_type: 'SELECT' }]);
  });

  it('applies twice without duplicating anything; the read policy asks auth.uid() once per statement', async () => {
    expect(await su(`select tablename, policyname from pg_policies group by 1, 2 having count(*) > 1`)).toEqual([]);
    expect(await su(`select tgname from pg_trigger where tgrelid = 'public.figure_versions'::regclass and not tgisinternal`)).toEqual([{ tgname: 'figure_versions_immutable' }]);
    const pols = await su(`select tablename, policyname, cmd, permissive, qual from pg_policies
      where tablename = 'figure_versions' or policyname like 'Published version files%' order by 2`);
    expect(pols.map((p) => [p.tablename, p.policyname, p.cmd, p.permissive])).toEqual([
      ['objects', 'Published version files are kept', 'DELETE', 'RESTRICTIVE'],
      ['objects', 'Published version files are not replaced', 'UPDATE', 'RESTRICTIVE'],
      ['figure_versions', 'Readers see published versions', 'SELECT', 'PERMISSIVE']]);
    expect(pols[2].qual).toMatch(/\(\s*SELECT auth\.uid\(\) AS uid\s*\)/);
    const def = (await su(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'org_activity_action_check'`))[0].d;
    expect(def).toMatch(/'uploaded'.*'imported'.*'rolled_back'.*'published'/);
  });
});

describe('publishing a personal figure', () => {
  it('copies the saved row server-side: settings, files and thumbnail verbatim, hashed', async () => {
    const v = await publish(O, 'figure', S.fig);
    expect(v).toMatchObject({ kind: 'figure', figure_id: S.fig, version: 1, label: 'News release 2026-10-21', release_date: '2026-10-21', name: 'Rails zone' });
    S.v1 = v;
    const row = await one(O, `select *, snapshot::text as text from public.figure_versions where id = $1`, [v.id]);
    expect(row.snapshot.settings).toEqual(S.saved.settings);
    expect(row.snapshot.file_paths).toEqual(S.saved.file_paths);
    expect(row.snapshot).toMatchObject({ kind: 'figure', id: S.fig, name: 'Rails zone' });
    expect(Date.parse(row.snapshot.saved_at)).toBe(new Date(S.saved.updated_at).getTime());
    expect(row.snapshot.files.map((f) => [f.path, f.size])).toEqual([[S.paths[0], 120], [S.paths[1], 3400]]);
    expect(row.snapshot.files[0].etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(row.thumbnail).toBe(THUMB);
    expect(row).toMatchObject({ owner_id: O, org_id: null, published_by: O, file_names: S.paths });
    expect(row.content_hash).toBe(createHash('sha256').update(row.text, 'utf8').digest('hex'));
    expect(v.content_hash).toBe(row.content_hash);
  });

  it('refuses a stale copy, a bad label, files outside the figure and files not in storage', async () => {
    await expect(publish(O, 'figure', S.fig, 'x', null, '2020-01-01T00:00:00Z')).rejects.toThrow(/VERSION_STALE/);
    expect((await publish(O, 'figure', S.fig, 'Same save again', null, S.saved.updated_at)).version).toBe(2);
    await expect(publish(O, 'figure', S.fig, '   ')).rejects.toThrow(/VERSION_INVALID/);
    await expect(publish(O, 'figure', S.fig, 'x'.repeat(201))).rejects.toThrow(/VERSION_INVALID/);
    await expect(publish(O, 'figure', S.fig, 'ok', '3001-01-01')).rejects.toThrow(/VERSION_INVALID/);
    await expect(publish(O, 'drawing', S.fig)).rejects.toThrow(/VERSION_INVALID/);
    await expect(publish(O, 'figure', id(999))).rejects.toThrow(/NOT_FOUND/);
    // Pinning someone else's files is refused (they could never delete them again).
    await files([[`${X}/${id(500)}/r1/theirs.csv`, 10]]);
    const bad = await one(O, `insert into public.three_d_projects (name, settings, file_paths) values ('Bad', '{"v":1}', $1) returning id`,
      [[{ name: 'theirs.csv', path: `${X}/${id(500)}/r1/theirs.csv` }]]);
    await expect(publish(O, 'figure', bad.id)).rejects.toThrow(/VERSION_FILES_UNEXPECTED/);
    await as(O, `update public.three_d_projects set file_paths = $2 where id = $1`, [bad.id, [{ name: 'gone.csv', path: `${O}/${bad.id}/r1/gone.csv` }]]);
    await expect(publish(O, 'figure', bad.id)).rejects.toThrow(/VERSION_FILES_MISSING/);
    await as(O, `update public.three_d_projects set deleted_at = now() where id = $1`, [bad.id]);
    await expect(publish(O, 'figure', bad.id)).rejects.toThrow(/NOT_FOUND/);
  });

  it('is invisible to anyone else, and anon can do nothing', async () => {
    await expect(publish(X, 'figure', S.fig)).rejects.toThrow(/NOT_FOUND/);
    expect((await as(X, `select id from public.figure_versions`)).rows).toEqual([]);
    expect((await as(X, `select * from public.list_figure_versions('figure', $1)`, [S.fig])).rows).toEqual([]);
    await expect(publish(null, 'figure', S.fig)).rejects.toThrow(/permission denied/);
    await expect(as(null, `select id from public.figure_versions`)).rejects.toThrow(/permission denied/);
    await expect(as(null, `select * from public.list_figure_versions('figure', $1)`, [S.fig])).rejects.toThrow(/permission denied/);
    const listed = (await as(O, `select * from public.list_figure_versions('figure', $1)`, [S.fig])).rows;
    expect(listed.map((r) => [r.version, r.label, r.published_by_email])).toEqual([[2, 'Same save again', 'owner@star.test'], [1, 'News release 2026-10-21', 'owner@star.test']]);
  });
});

describe('a published version never changes', () => {
  it('later edits leave it as it was; the next publish takes the new save', async () => {
    const before = await one(O, `select snapshot, content_hash from public.figure_versions where id = $1`, [S.v1.id]);
    const p3 = `${O}/${S.fig}/r2/collars.csv`;
    await files([[p3, 130]]);
    await as(O, `update public.three_d_projects set settings = jsonb_set(settings, '{settings,title}', '"RAILS EDITED"'), file_paths = $2 where id = $1`,
      [S.fig, [{ name: 'collars.csv', path: p3, size: 130 }]]);
    expect(await one(O, `select snapshot, content_hash from public.figure_versions where id = $1`, [S.v1.id])).toEqual(before);
    const v3 = await publish(O, 'figure', S.fig, 'Update');
    expect(v3.version).toBe(3);
    expect(v3.content_hash).not.toBe(before.content_hash);
    expect((await one(O, `select snapshot from public.figure_versions where id = $1`, [v3.id])).snapshot.settings.settings.title).toBe('RAILS EDITED');
  });

  it('refuses updates and deletes from the browser and from the service role', async () => {
    await expect(as(O, `update public.figure_versions set label = 'x' where id = $1`, [S.v1.id])).rejects.toThrow(/permission denied/);
    await expect(as(O, `delete from public.figure_versions where id = $1`, [S.v1.id])).rejects.toThrow(/permission denied/);
    await expect(as(O, `insert into public.figure_versions (figure_kind, figure_id, version, label, name, owner_id, snapshot, content_hash)
      values ('figure', $1, 9, 'forged', 'f', $2, '{}', repeat('0', 64))`, [S.fig, O])).rejects.toThrow(/permission denied/);
    await expect(as(O, `truncate public.figure_versions`)).rejects.toThrow(/permission denied/);
    await expect(su(`update public.figure_versions set label = 'x' where id = $1`, [S.v1.id])).rejects.toThrow(/VERSION_IMMUTABLE/);
    await expect(su(`update public.figure_versions set snapshot = '{}' where id = $1`, [S.v1.id])).rejects.toThrow(/VERSION_IMMUTABLE/);
    await expect(su(`delete from public.figure_versions where id = $1`, [S.v1.id])).rejects.toThrow(/VERSION_IMMUTABLE/);
    // A hard delete of the figure leaves its versions.
    expect((await as(O, `delete from public.three_d_projects where id = $1`, [S.fig])).affectedRows).toBe(1);
    const n = await su(`select count(*)::int as n from public.figure_versions where figure_id = $1`, [S.fig]);
    expect(n).toEqual([{ n: 3 }]);
  });

  it('keeps its data files: the owner can no longer delete or replace them, other files go as before', async () => {
    const del = await as(O, `delete from storage.objects where bucket_id = 'three-d-files' and name = any($1)`, [S.paths]);
    expect(del.affectedRows).toBe(0);
    expect((await as(O, `update storage.objects set metadata = '{}' where name = $1`, [S.paths[0]])).affectedRows).toBe(0);
    const p = `${O}/${S.fig}/r9/scratch.csv`;
    await files([[p, 1]]);
    expect((await as(O, `delete from storage.objects where name = $1`, [p])).affectedRows).toBe(1);
    expect(await su(`select count(*)::int as n from storage.objects where name = any($1)`, [S.paths])).toEqual([{ n: 2 }]);
    // Other buckets are untouched by the rule.
    expect(await val(O, `select public.figure_version_file('property-files', $1)`, [S.paths[0]])).toBe(false);
  });
});

describe('a company figure', () => {
  it('is published by editors, read by every member, logged, and refused to viewers and outsiders', async () => {
    S.org3d = id(200);
    const p = `org/${S.org}/${S.org3d}/r1/collars.csv`;
    await files([[p, 55]]);
    await as(E, `insert into public.three_d_projects (id, name, settings, file_paths, org_id, property_id) values ($1, 'Rails 3D', $2, $3, $4, $5)`,
      [S.org3d, SETTINGS, [{ name: 'collars.csv', path: p }], S.org, S.prop]);
    await expect(publish(V, 'figure', S.org3d)).rejects.toThrow(/VERSION_READ_ONLY/);
    await expect(publish(X, 'figure', S.org3d)).rejects.toThrow(/NOT_FOUND/);
    const v = await publish(E, 'figure', S.org3d, 'Investor deck');
    expect(v.version).toBe(1);
    expect(await one(E, `select org_id, property_id, owner_id, published_by from public.figure_versions where id = $1`, [v.id]))
      .toEqual({ org_id: S.org, property_id: S.prop, owner_id: null, published_by: E });
    for (const u of [O, E, V]) expect((await as(u, `select version from public.list_figure_versions('figure', $1)`, [S.org3d])).rows, u).toEqual([{ version: 1 }]);
    expect((await as(V, `select snapshot->'settings' as s from public.figure_versions where id = $1`, [v.id])).rows[0].s).toEqual(SETTINGS);
    expect((await as(X, `select id from public.figure_versions where id = $1`, [v.id])).rows).toEqual([]);
    const act = await su(`select action, entity_type, entity_id, property_id, actor, summary, detail from public.org_activity where action = 'published'`);
    expect(act).toEqual([{ action: 'published', entity_type: 'figure', entity_id: S.org3d, property_id: S.prop, actor: E,
      summary: 'Published version 1 of 3D figure "Rails 3D" · Investor deck',
      detail: { version_id: v.id, version: 1, label: 'Investor deck', release_date: '2026-10-21', content_hash: v.content_hash } }]);
    // Editors can no longer delete the published file either.
    expect((await as(E, `delete from storage.objects where name = $1`, [p])).affectedRows).toBe(0);
  });
});

describe('a 2D map', () => {
  it('is published from its saved payload by the same RPC', async () => {
    const payload = { layers: [{ id: 'claims', name: 'Claims' }], title: 'Rails claims' };
    S.map = await val(O, `select public.create_cloud_project('Rails map', $1)`, [payload]);
    const v = await publish(O, 'map', S.map, 'Map for release');
    const row = await one(O, `select snapshot, file_names from public.figure_versions where id = $1`, [v.id]);
    expect(row.snapshot).toMatchObject({ kind: 'map', name: 'Rails map', payload, revision: 1 });
    expect(row.file_names).toEqual([]);
    await expect(publish(X, 'map', S.map)).rejects.toThrow(/NOT_FOUND/);
    // A figure id is not a map.
    await expect(publish(O, 'map', S.fig)).rejects.toThrow(/NOT_FOUND/);
  });
});

describe('when the home is gone', () => {
  it('deleting an account removes its personal versions (the only delete allowed); company versions stay', async () => {
    const fig = id(300), path = `${X}/${fig}/r1/collars.csv`;
    await files([[path, 5]]);
    await as(X, `insert into public.three_d_projects (id, name, settings, file_paths) values ($1, 'Theirs', '{"v":1}', $2)`, [fig, [{ name: 'collars.csv', path }]]);
    await publish(X, 'figure', fig);
    expect(await su(`select count(*)::int as n from public.figure_versions where owner_id = $1`, [X])).toEqual([{ n: 1 }]);
    await su(`delete from auth.users where id = $1`, [X]);
    expect(await su(`select count(*)::int as n from public.figure_versions where figure_id = $1`, [fig])).toEqual([{ n: 0 }]);
    // The editor who published the company version leaves and deletes their account: the version stays, unattributed.
    await su(`delete from public.organization_members where user_id = $1`, [E]);
    await su(`delete from auth.users where id = $1`, [E]);
    expect(await su(`select published_by, label from public.figure_versions where figure_id = $1`, [S.org3d])).toEqual([{ published_by: null, label: 'Investor deck' }]);
    expect(await su(`select count(*)::int as n from public.figure_versions where owner_id = $1`, [O])).toEqual([{ n: 4 }]);
  });
});
