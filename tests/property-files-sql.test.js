// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// Property data library (20261025100000): files and versions of a property,
// their storage objects and activity, role by role. Both workspace
// migrations are applied, this one twice.
//
// Tests run in order and share state: each describe builds on the last.
let db, as, one, val, su;
const WORKSPACES = readMigration('20261023100000_workspaces_properties.sql');
const MIGRATION = readMigration('20261025100000_property_files.sql');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1); // owner
const A = id(2); // admin
const E = id(3); // editor
const V = id(4); // viewer
const X = id(5); // owner of another company
const EMAIL = { [O]: 'owner@star.test', [A]: 'admin@star.test', [E]: 'geo@star.test', [V]: 'investor@fund.test', [X]: 'rival@rival.test' };
const FILE = id(101), FILE2 = id(102);
const sha = (c) => c.repeat(64);
const S = {};

const put = (uid, path) => as(uid, `insert into storage.objects (bucket_id, name) values ('property-files', $1)`, [path]);
const add = (uid, { property = S.prop, file = FILE, name = 'assays.csv', kind = 'drill', role = 'assays', path, bytes = 1200, hash = sha('a'), note = null }) =>
  val(uid, `select public.add_property_file_version($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [property, file, name, kind, role, path, bytes, hash, note]);
const pathOf = (file, v, name = 'assays.csv', org = S.org, prop = S.prop) => `${org}/${prop}/${file}/v${v}/${name}`;

beforeAll(async () => {
  ({ db, as, one, val, su } = await createWorkspaceDb({ emails: EMAIL, migrations: [WORKSPACES, MIGRATION, MIGRATION] }));
  S.org = (await val(O, `select public.create_organization('Star Copper Corp.')`)).id;
  S.orgB = (await val(X, `select public.create_organization('Rival Metals')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'editor'), ($1, $4, 'viewer')`, [S.org, A, E, V]);
  S.prop = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Rails') returning id`, [S.org])).id;
  S.propB = (await one(X, `insert into public.properties (org_id, name) values ($1, 'Rival') returning id`, [S.orgB])).id;
}, 120_000);
afterAll(async () => db?.close());

describe('migration', () => {
  it('pins search_path, keeps functions from anon and internals from the browser', async () => {
    const fns = await su(`select proname, proconfig, has_function_privilege('anon', oid, 'execute') as anon,
      has_function_privilege('authenticated', oid, 'execute') as auth, prosecdef from pg_proc
      where proname in ('property_files_guard', 'ws_library_org', 'add_property_file_version', 'list_property_files', 'ws_activity_files', 'ws_property_has_content')`);
    expect(fns).toHaveLength(6);
    for (const f of fns) {
      expect(f.proconfig, f.proname).toEqual(['search_path=""']);
      expect(f.anon, f.proname).toBe(false);
    }
    const by = Object.fromEntries(fns.map((f) => [f.proname, f]));
    expect(by.ws_activity_files.auth).toBe(false);
    expect(by.ws_library_org.prosecdef).toBe(false); // evaluated by storage policies as the caller
    expect(by.property_files_guard.prosecdef).toBe(false);
  });

  it('applies twice without duplicating policies or triggers, with a private 100 MB bucket', async () => {
    expect(await su(`select tablename, policyname from pg_policies group by 1, 2 having count(*) > 1`)).toEqual([]);
    expect((await su(`select count(*)::int as n from pg_trigger where tgrelid in ('public.property_files'::regclass, 'public.property_file_versions'::regclass) and not tgisinternal`))[0].n).toBe(3);
    expect(await su(`select id, public, file_size_limit::int as max from storage.buckets where id = 'property-files'`)).toEqual([{ id: 'property-files', public: false, max: 104857600 }]);
  });
});

describe('uploading', () => {
  it('keeps viewers and other companies from uploading', async () => {
    await expect(put(V, pathOf(FILE, 1))).rejects.toThrow(/row-level security/);
    await expect(put(X, pathOf(FILE, 1))).rejects.toThrow(/row-level security/);
    await su(`insert into storage.objects (bucket_id, name) values ('property-files', $1)`, [pathOf(FILE, 1)]);
    await expect(add(V, { path: pathOf(FILE, 1) })).rejects.toThrow(/ORG_READ_ONLY/);
    await expect(add(X, { path: pathOf(FILE, 1) })).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(add(null, { path: pathOf(FILE, 1) })).rejects.toThrow(/permission denied/);
    expect(await su(`select id from public.property_files`)).toEqual([]);
  });

  it('lets an editor add a file once its bytes are in storage', async () => {
    await expect(add(E, { file: FILE2, path: pathOf(FILE2, 1) })).rejects.toThrow(/FILE_NOT_UPLOADED/);
    expect(await add(E, { path: pathOf(FILE, 1), note: ' 2026 program ' })).toEqual({ file_id: FILE, version: 1, unchanged: false });
    const f = await one(V, `select org_id, property_id, name, kind, role, current_version, created_by from public.property_files where id = $1`, [FILE]);
    expect(f).toEqual({ org_id: S.org, property_id: S.prop, name: 'assays.csv', kind: 'drill', role: 'assays', current_version: 1, created_by: E });
    expect(await one(V, `select version, storage_path, bytes::int, sha256, uploaded_by, note from public.property_file_versions where file_id = $1`, [FILE]))
      .toEqual({ version: 1, storage_path: pathOf(FILE, 1), bytes: 1200, sha256: sha('a'), uploaded_by: E, note: '2026 program' });
    const list = await val(V, `select public.list_property_files($1)`, [S.prop]);
    expect(list).toEqual([expect.objectContaining({ id: FILE, name: 'assays.csv', version: 1, path: pathOf(FILE, 1), uploaded_by_email: 'geo@star.test' })]);
  });

  it('only accepts uploads in the file\'s own folder, for the next version', async () => {
    await put(E, pathOf(FILE2, 1, 'collars.csv'));
    const own = { file: FILE2, name: 'collars.csv', role: 'collars' };
    await expect(add(E, { ...own, path: pathOf(FILE, 1, 'collars.csv') })).rejects.toThrow(/FILE_PATH_UNEXPECTED/);
    await expect(add(E, { ...own, path: `${S.org}/${S.prop}/${FILE2}/v1/../x.csv` })).rejects.toThrow(/FILE_PATH_UNEXPECTED/);
    await expect(add(E, { ...own, path: `${S.org}/${S.prop}/${FILE2}/collars.csv` })).rejects.toThrow(/FILE_PATH_UNEXPECTED/);
    await expect(add(E, { ...own, path: pathOf(FILE2, 2, 'collars.csv') })).rejects.toThrow(/VERSION_CONFLICT/);
    await expect(add(E, { ...own, property: S.propB, path: pathOf(FILE2, 1, 'collars.csv', S.orgB, S.propB) })).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(add(E, { ...own, kind: 'spreadsheet', path: pathOf(FILE2, 1, 'collars.csv') })).rejects.toThrow(/check constraint/);
    await expect(add(E, { ...own, hash: 'abc', path: pathOf(FILE2, 1, 'collars.csv') })).rejects.toThrow(/invalid file/);
    await expect(add(E, { ...own, bytes: 104857601, path: pathOf(FILE2, 1, 'collars.csv') })).rejects.toThrow(/invalid file/);
    expect((await add(E, { ...own, hash: sha('c'), path: pathOf(FILE2, 1, 'collars.csv') })).version).toBe(1);
    // A storage name that only looks right is refused too.
    await expect(put(E, `${S.org}/${S.propB}/${FILE2}/v1/x.csv`)).rejects.toThrow(/row-level security/);
    await expect(put(E, `${S.org}/${S.prop}/not-a-uuid/v1/x.csv`)).rejects.toThrow(/row-level security/);
    await expect(put(E, `${S.org}/${S.prop}/${FILE2}/v0/x.csv`)).rejects.toThrow(/row-level security/);
    await expect(put(E, `${S.org}/${S.prop}/${FILE2}/v1/a/x.csv`)).rejects.toThrow(/row-level security/);
  });

  it('numbers new versions and skips an upload identical to the current one', async () => {
    expect(await add(E, { path: pathOf(FILE, 2) })).toEqual({ file_id: FILE, version: 1, unchanged: true });
    await put(A, pathOf(FILE, 2, 'assays-2026.csv'));
    expect(await add(A, { name: 'ignored.csv', kind: 'other', path: pathOf(FILE, 2, 'assays-2026.csv'), hash: sha('b'), bytes: 1500 }))
      .toEqual({ file_id: FILE, version: 2, unchanged: false });
    // Back to the first bytes is a change from the current version.
    await put(E, pathOf(FILE, 3));
    expect((await add(E, { path: pathOf(FILE, 3), hash: sha('a') })).version).toBe(3);
    expect(await one(V, `select name, kind, current_version from public.property_files where id = $1`, [FILE])).toEqual({ name: 'assays.csv', kind: 'drill', current_version: 3 });
    expect((await as(V, `select version from public.property_file_versions where file_id = $1 order by version`, [FILE])).rows.map((r) => r.version)).toEqual([1, 2, 3]);
    expect((await val(V, `select public.list_property_files($1)`, [S.prop])).map((f) => [f.name, f.version])).toEqual([['assays.csv', 3], ['collars.csv', 1]]);
  });
});

describe('reading', () => {
  it('shows files, versions and their bytes to members only', async () => {
    for (const u of [O, A, E, V]) {
      expect((await as(u, `select id from public.property_files order by name`)).rows.map((r) => r.id)).toEqual([FILE, FILE2]);
      expect((await as(u, `select name from storage.objects where name = $1`, [pathOf(FILE, 2, 'assays-2026.csv')])).rows).toHaveLength(1);
    }
    expect((await as(X, `select id from public.property_files`)).rows).toEqual([]);
    expect((await as(X, `select id from public.property_file_versions`)).rows).toEqual([]);
    expect((await as(X, `select name from storage.objects where bucket_id = 'property-files'`)).rows).toEqual([]);
    await expect(as(X, `select public.list_property_files($1)`, [S.prop])).rejects.toThrow(/forbidden/);
    await expect(as(null, `select id from public.property_files`)).rejects.toThrow(/permission denied/);
  });

  it('never lets another company add to a file it cannot see', async () => {
    await su(`insert into storage.objects (bucket_id, name) values ('property-files', $1)`, [pathOf(FILE, 4, 'x.csv', S.orgB, S.propB)]);
    await expect(add(X, { property: S.propB, path: pathOf(FILE, 4, 'x.csv', S.orgB, S.propB), hash: sha('d') })).rejects.toThrow(/NOT_FOUND/);
    expect(await one(O, `select current_version from public.property_files where id = $1`, [FILE])).toEqual({ current_version: 3 });
  });
});

describe('changing and deleting', () => {
  it('refuses every direct write except an editor\'s rename', async () => {
    await expect(as(E, `insert into public.property_files (org_id, property_id, name) values ($1, $2, 'x')`, [S.org, S.prop])).rejects.toThrow(/permission denied/);
    await expect(as(E, `update public.property_files set property_id = $2 where id = $1`, [FILE, S.propB])).rejects.toThrow(/permission denied/);
    await expect(as(O, `update public.property_files set org_id = $2 where id = $1`, [FILE, S.orgB])).rejects.toThrow(/permission denied/);
    await expect(as(O, `update public.property_files set current_version = 1 where id = $1`, [FILE])).rejects.toThrow(/permission denied/);
    await expect(as(O, `insert into public.property_file_versions (file_id, version, storage_path, bytes, sha256) values ($1, 9, 'x', 1, $2)`, [FILE, sha('e')])).rejects.toThrow(/permission denied/);
    await expect(as(O, `update public.property_file_versions set sha256 = $1`, [sha('f')])).rejects.toThrow(/permission denied/);
    await expect(as(O, `delete from public.property_file_versions`)).rejects.toThrow(/permission denied/);
    await expect(as(O, `delete from public.property_files`)).rejects.toThrow(/permission denied/);
    expect((await as(O, `update storage.objects set name = 'x' where bucket_id = 'property-files'`)).affectedRows).toBe(0);
    expect((await as(O, `delete from storage.objects where bucket_id = 'property-files'`)).affectedRows).toBe(0);
    expect((await as(V, `update public.property_files set name = 'viewer' where id = $1`, [FILE2])).affectedRows).toBe(0);
    expect((await as(E, `update public.property_files set name = ' drill collars.csv ', role = 'collars' where id = $1`, [FILE2])).affectedRows).toBe(1);
    expect((await one(V, `select name from public.property_files where id = $1`, [FILE2])).name).toBe('drill collars.csv');
  });

  it('leaves deleting and restoring a file to admins', async () => {
    await expect(as(E, `update public.property_files set deleted_at = now() where id = $1`, [FILE2])).rejects.toThrow(/only an owner or admin/);
    expect((await as(V, `update public.property_files set deleted_at = now() where id = $1`, [FILE2])).affectedRows).toBe(0);
    expect((await as(X, `update public.property_files set deleted_at = now() where id = $1`, [FILE2])).affectedRows).toBe(0);
    expect((await as(A, `update public.property_files set deleted_at = now() where id = $1`, [FILE2])).affectedRows).toBe(1);
    expect((await as(E, `select id from public.property_files where id = $1`, [FILE2])).rows).toEqual([]);
    expect((await as(E, `select id from public.property_file_versions where file_id = $1`, [FILE2])).rows).toEqual([]);
    expect((await as(A, `select id from public.property_files where id = $1`, [FILE2])).rows).toEqual([{ id: FILE2 }]);
    expect((await val(E, `select public.list_property_files($1)`, [S.prop])).map((f) => f.id)).toEqual([FILE]);
    await put(E, pathOf(FILE2, 2, 'collars.csv'));
    await expect(add(E, { file: FILE2, path: pathOf(FILE2, 2, 'collars.csv'), hash: sha('9') })).rejects.toThrow(/NOT_FOUND/);
    await expect(as(E, `update public.property_files set deleted_at = null where id = $1`, [FILE2])).resolves.toMatchObject({ affectedRows: 0 });
    expect((await as(O, `update public.property_files set deleted_at = null where id = $1`, [FILE2])).affectedRows).toBe(1);
    expect((await as(A, `update public.property_files set deleted_at = now() where id = $1`, [FILE2])).affectedRows).toBe(1);
  });

  it('will not delete a property that still holds live files', async () => {
    await expect(as(A, `update public.properties set deleted_at = now() where id = $1`, [S.prop])).rejects.toThrow(/PROPERTY_NOT_EMPTY/);
    const empty = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Empty') returning id`, [S.org])).id;
    expect((await as(A, `update public.properties set deleted_at = now() where id = $1`, [empty])).affectedRows).toBe(1);
    // And nothing is added to a deleted property.
    await su(`insert into storage.objects (bucket_id, name) values ('property-files', $1)`, [pathOf(id(103), 1, 'x.csv', S.org, empty)]);
    await expect(add(E, { property: empty, file: id(103), path: pathOf(id(103), 1, 'x.csv', S.org, empty) })).rejects.toThrow(/PROPERTY_NOT_FOUND/);
  });
});

describe('activity', () => {
  // E's rename falls in log_org_activity's ten-minute "updated" debounce
  // after E added the file; new versions are 'uploaded' and never do.
  it('records new files, every new version and deletes, by whom', async () => {
    const rows = await su(`select action, entity_type, entity_id, property_id, summary, actor, detail from public.org_activity
      where entity_type = 'file' order by created_at, summary`);
    expect(rows.map((r) => [r.action, r.summary, r.actor])).toEqual([
      ['created', 'Added data file "assays.csv"', E],
      ['created', 'Added data file "collars.csv"', E],
      ['uploaded', 'Uploaded version 2 of "assays.csv"', A],
      ['uploaded', 'Uploaded version 3 of "assays.csv"', E],
      ['deleted', 'Deleted data file "drill collars.csv"', A],
      ['updated', 'Restored data file "drill collars.csv"', O],
      ['deleted', 'Deleted data file "drill collars.csv"', A],
    ]);
    expect(rows.every((r) => r.property_id === S.prop)).toBe(true);
    expect(rows[3].detail).toEqual({ version: 3, bytes: 1200 });
    const feed = await val(V, `select public.get_org_activity($1, $2, 50)`, [S.org, S.prop]);
    expect(feed.some((a) => a.summary === 'Uploaded version 3 of "assays.csv"' && a.actor_email === 'geo@star.test')).toBe(true);
  });
});
