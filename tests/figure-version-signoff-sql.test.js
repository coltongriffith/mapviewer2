// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// QP sign-off on a published figure version (20261103100000): written once by an editor (or a personal
// version's owner), never edited or deleted, only retracted with a reason; read by whoever reads the version.
// The figure-versions migration and its own dependencies come first; this one is applied twice.
let db, as, one, val, su;
const MIGRATION = readMigration('20261103100000_figure_version_signoff.sql');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(3), V = id(4), X = id(5);
const EMAIL = { [O]: 'owner@star.test', [E]: 'geo@star.test', [V]: 'investor@fund.test', [X]: 'rival@rival.test' };
const S = {};
const sign = (uid, version, o = {}) => one(uid, `insert into public.figure_version_signoffs (version_id, qp_name, qp_credentials, signed_on, note)
  values ($1, $2, $3, $4, $5) returning *`, [version, o.name ?? ' A. Person ', o.cred ?? 'P.Geo.', o.date ?? '2026-10-21', o.note ?? null]);

beforeAll(async () => {
  ({ db, as, one, val, su } = await createWorkspaceDb({ emails: EMAIL, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), readMigration('20261029100000_figure_versions.sql'), MIGRATION, MIGRATION] }));
  await su(`alter table storage.objects add column if not exists metadata jsonb`);
  S.org = (await val(O, `select public.create_organization('Star Copper Corp.')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`, [S.org, E, V]);
  S.prop = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Rails') returning id`, [S.org])).id;
  await as(E, `insert into public.three_d_projects (id, name, settings, file_paths, org_id, property_id) values ($1, 'Rails 3D', '{"v":1}', '[]', $2, $3)`, [id(200), S.org, S.prop]);
  S.v = (await val(E, `select public.publish_figure_version('figure', $1, 'News release')`, [id(200)])).id;
  await as(O, `insert into public.three_d_projects (id, name, settings, file_paths) values ($1, 'Mine', '{"v":1}', '[]')`, [id(300)]);
  S.mine = (await val(O, `select public.publish_figure_version('figure', $1, 'Personal')`, [id(300)])).id;
}, 120_000);
afterAll(async () => db?.close());

describe('migration', () => {
  it('applies twice, gives anon nothing and the browser only the input columns', async () => {
    expect(await su(`select tablename, policyname from pg_policies group by 1, 2 having count(*) > 1`)).toEqual([]);
    expect(await su(`select tgname from pg_trigger where tgrelid = 'public.figure_version_signoffs'::regclass and not tgisinternal`)).toEqual([{ tgname: 'figure_version_signoff_guard' }]);
    const grants = await su(`select grantee, privilege_type from information_schema.role_table_grants
      where table_name = 'figure_version_signoffs' and grantee in ('anon', 'authenticated') order by 1, 2`);
    expect(grants).toEqual([{ grantee: 'authenticated', privilege_type: 'SELECT' }]);
    const cols = await su(`select privilege_type, string_agg(column_name, ',' order by column_name) as c from information_schema.column_privileges
      where table_name = 'figure_version_signoffs' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE') group by 1 order by 1`);
    expect(cols).toEqual([{ privilege_type: 'INSERT', c: 'note,qp_credentials,qp_name,signed_on,version_id' }, { privilege_type: 'UPDATE', c: 'retraction_reason' }]);
    const fns = await su(`select proname, proconfig, has_function_privilege('anon', oid, 'execute') as anon from pg_proc where proname like 'figure_version_signoff%' order by 1`);
    expect(fns.map((f) => [f.proname, f.anon, f.proconfig?.[0]])).toEqual([['figure_version_signoff_guard', false, 'search_path=""'], ['figure_version_signoff_may_write', false, 'search_path=""']]);
  });
});

describe('signing off', () => {
  it('records the QP, credentials, date and note; who and when come from the database', async () => {
    const s = await sign(E, S.v, { note: '  Reviewed the drill data.  ' });
    expect(s).toMatchObject({ version_id: S.v, qp_name: 'A. Person', qp_credentials: 'P.Geo.', note: 'Reviewed the drill data.', signed_by: E, retracted_at: null });
    expect(new Date(s.signed_on).toISOString().slice(0, 10)).toBe('2026-10-21');
    S.s = s;
    // The owner of a personal version signs it off as its publisher.
    expect((await sign(O, S.mine, { name: 'B. Person', cred: 'P.Eng.' })).signed_by).toBe(O);
  });

  it('refuses viewers, outsiders, anon, bad input and a second live sign-off', async () => {
    await expect(sign(V, S.v)).rejects.toThrow(/SIGNOFF_NOT_ALLOWED|row-level security/);
    await expect(sign(X, S.v)).rejects.toThrow(/SIGNOFF_NOT_ALLOWED|row-level security/);
    await expect(sign(E, S.mine)).rejects.toThrow(/SIGNOFF_NOT_ALLOWED|row-level security/);
    await expect(sign(null, S.v)).rejects.toThrow(/permission denied/);
    await expect(sign(E, S.v)).rejects.toThrow(/SIGNOFF_EXISTS/);
    await expect(sign(O, S.v, { name: '  ' })).rejects.toThrow(/check constraint|SIGNOFF_EXISTS/);
    await expect(as(E, `insert into public.figure_version_signoffs (version_id, qp_name, qp_credentials, signed_on, signed_by) values ($1, 'X', 'P.Geo.', '2026-10-21', $2)`, [S.v, O]))
      .rejects.toThrow(/permission denied/);
  });

  it('is read by everyone who reads the version, and nobody else', async () => {
    for (const u of [O, E, V]) expect((await as(u, `select qp_name from public.figure_version_signoffs where version_id = $1`, [S.v])).rows, u).toEqual([{ qp_name: 'A. Person' }]);
    expect((await as(X, `select id from public.figure_version_signoffs`)).rows).toEqual([]);
    expect((await as(E, `select id from public.figure_version_signoffs where version_id = $1`, [S.mine])).rows).toEqual([]);
    await expect(as(null, `select id from public.figure_version_signoffs`)).rejects.toThrow(/permission denied/);
  });
});

describe('a sign-off never changes', () => {
  it('cannot be edited or deleted, by the browser or the service role', async () => {
    await expect(as(E, `update public.figure_version_signoffs set qp_name = 'Someone else' where id = $1`, [S.s.id])).rejects.toThrow(/permission denied/);
    await expect(as(E, `delete from public.figure_version_signoffs where id = $1`, [S.s.id])).rejects.toThrow(/permission denied/);
    await expect(su(`update public.figure_version_signoffs set qp_name = 'x' where id = $1`, [S.s.id])).rejects.toThrow(/SIGNOFF_IMMUTABLE/);
    await expect(su(`delete from public.figure_version_signoffs where id = $1`, [S.s.id])).rejects.toThrow(/SIGNOFF_IMMUTABLE/);
    expect((await one(V, `select qp_name, note from public.figure_version_signoffs where id = $1`, [S.s.id]))).toEqual({ qp_name: 'A. Person', note: 'Reviewed the drill data.' });
  });

  it('is retracted once, by an editor, with a reason; then a new one may be recorded', async () => {
    expect((await as(V, `update public.figure_version_signoffs set retraction_reason = 'No' where id = $1`, [S.s.id])).affectedRows).toBe(0);
    await expect(as(E, `update public.figure_version_signoffs set retraction_reason = '  ' where id = $1`, [S.s.id])).rejects.toThrow(/SIGNOFF_RETRACTION_INVALID/);
    const r = await one(E, `update public.figure_version_signoffs set retraction_reason = ' Wrong figure ' where id = $1 returning *`, [S.s.id]);
    expect(r).toMatchObject({ retraction_reason: 'Wrong figure', retracted_by: E, qp_name: 'A. Person', note: 'Reviewed the drill data.', signed_by: E });
    expect(r.retracted_at).not.toBeNull();
    await expect(as(E, `update public.figure_version_signoffs set retraction_reason = 'Again' where id = $1`, [S.s.id])).rejects.toThrow(/SIGNOFF_RETRACTION_INVALID/);
    const again = await sign(O, S.v, { name: 'C. Person', cred: 'P.Geo.' });
    expect(again.signed_by).toBe(O);
    expect(await su(`select qp_name, retracted_at is not null as gone from public.figure_version_signoffs where version_id = $1 order by created_at, gone desc`, [S.v]))
      .toEqual([{ qp_name: 'A. Person', gone: true }, { qp_name: 'C. Person', gone: false }]);
  });

  it('keeps the record unattributed when an account goes, and goes with a personal version', async () => {
    await su(`delete from public.organization_members where user_id = $1`, [E]);
    await su(`delete from auth.users where id = $1`, [E]);
    expect(await su(`select signed_by, retracted_by, qp_name from public.figure_version_signoffs where qp_name = 'A. Person'`)).toEqual([{ signed_by: null, retracted_by: null, qp_name: 'A. Person' }]);
    await su(`delete from auth.users where id = $1`, [O]);
    expect(await su(`select count(*)::int as n from public.figure_version_signoffs where version_id = $1`, [S.mine])).toEqual([{ n: 0 }]);
  });
});
