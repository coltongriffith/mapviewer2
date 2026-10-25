// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';
import { defaultRecipe } from '../shared/drillResults.js';

// Release packs, Phase 5B (20261103120000): editors define a property's pack,
// members read it; an approval is checked against the database, stores the
// server's own copy of what was used, and never changes. Tests share state in order.
let db, as, one, val, su;
const MIGRATION = readMigration('20261103120000_release_packs.sql');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(3), V = id(4), X = id(5);
const EMAIL = { [O]: 'owner@star.test', [E]: 'geo@star.test', [V]: 'investor@fund.test', [X]: 'rival@rival.test' };
const S = {};

const imp = async (rows) => (await val(E, `select public.drill_import_batch($1, 'assays', $2::jsonb, '{}', 'assays.csv', false, null)`,
  [S.prop, JSON.stringify(rows)])).batch_id;
const assay = (hole, from) => ({ hole_id: hole, from_m: from, to_m: from + 1, values: { Au: 1.2 }, units: { Au: 'g/t' }, bdl: {} });
const live = () => su(`select id from public.drill_import_batches where property_id = $1 and rolled_back_at is null order by created_at, id`, [S.prop]).then((r) => r.map((x) => x.id));
const figures = async () => (await su(`select public.release_pack_figures($1, (select items from public.release_packs where id = $2)) as f`, [S.prop, S.pack]))[0].f;
const approve = (uid, { batches, figs, recipe, note = null } = {}) => one(uid, `insert into public.release_pack_approvals (pack_id, batch_ids, figures, recipe, note)
  values ($1, $2, $3, $4, $5) returning *`, [S.pack, batches, JSON.stringify(figs), recipe && JSON.stringify(recipe), note]);
const current = async () => ({
  batches: await live(),
  figs: (await figures()).map((f) => ({ kind: f.kind, id: f.id, version_id: f.version_id, revision: f.revision })),
  recipe: await one(E, `select id from public.drill_result_recipes where property_id = $1 and superseded_at is null`, [S.prop]),
});

beforeAll(async () => {
  ({ db, as, one, val, su } = await createWorkspaceDb({ emails: EMAIL, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), readMigration('20261028100000_drill_intercepts.sql'),
    readMigration('20261029100000_figure_versions.sql'), MIGRATION, MIGRATION] }));
  await su(`alter table storage.objects add column if not exists metadata jsonb`);
  S.org = (await val(O, `select public.create_organization('Star Copper Corp.')`)).id;
  S.orgB = (await val(X, `select public.create_organization('Rival Metals')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`, [S.org, E, V]);
  S.prop = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Rails') returning id`, [S.org])).id;
  S.other = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Other') returning id`, [S.org])).id;
  S.map = await val(E, `select public.create_org_project($1, 'Drill plan', '{}'::jsonb)`, [S.prop]);
  S.loc = await val(E, `select public.create_org_project($1, 'Location', '{}'::jsonb)`, [S.prop]);
  S.otherMap = await val(E, `select public.create_org_project($1, 'Elsewhere', '{}'::jsonb)`, [S.other]);
  S.fig = id(300);
  await as(E, `insert into public.three_d_projects (id, name, settings, file_paths, org_id, property_id) values ($1, 'Rails 3D', '{}', '[]', $2, $3)`, [S.fig, S.org, S.prop]);
  await val(E, `select public.drill_save_recipe($1, 'Default', $2::jsonb, 0)`, [S.prop, JSON.stringify(defaultRecipe(['Au'], { Au: 'g/t' }))]);
  S.b1 = await imp([assay('R-1', 0), assay('R-1', 1)]);
}, 120_000);
afterAll(async () => db?.close());

describe('migration', () => {
  it('applies twice without duplicates; members read, editors write some columns, nobody updates or deletes an approval', async () => {
    expect(await su(`select tablename, policyname from pg_policies group by 1, 2 having count(*) > 1`)).toEqual([]);
    const pols = await su(`select tablename, policyname, cmd from pg_policies where tablename like 'release_pack%' order by 1, 2`);
    expect(pols.map((p) => [p.tablename, p.cmd])).toEqual([
      ['release_pack_approvals', 'INSERT'], ['release_pack_approvals', 'SELECT'],
      ['release_packs', 'INSERT'], ['release_packs', 'UPDATE'], ['release_packs', 'SELECT']]);
    const grants = await su(`select table_name, privilege_type from information_schema.role_table_grants
      where table_name like 'release_pack%' and grantee in ('anon', 'authenticated') order by 1, 2`);
    expect(grants).toEqual([{ table_name: 'release_pack_approvals', privilege_type: 'SELECT' }, { table_name: 'release_packs', privilege_type: 'SELECT' }]);
    const fns = await su(`select proname, proconfig, has_function_privilege('anon', oid, 'execute') as anon,
      has_function_privilege('authenticated', oid, 'execute') as auth from pg_proc where proname like 'release_pack%'`);
    expect(fns).toHaveLength(5);
    for (const f of fns) expect([f.proname, f.proconfig?.[0], f.anon, f.auth]).toEqual([f.proname, 'search_path=""', false, false]);
  });
});

describe('the pack', () => {
  it('is created and changed by editors only, with items in this property', async () => {
    const items = [{ kind: 'results_table', ref: 'Default' }, { kind: 'drill_plan', ref: S.map }, { kind: 'figure_3d', ref: S.fig }, { kind: 'location_map', ref: S.loc }];
    await expect(as(V, `insert into public.release_packs (property_id, items) values ($1, '[]')`, [S.prop])).rejects.toThrow(/row-level security/);
    await expect(as(X, `insert into public.release_packs (property_id, items) values ($1, '[]')`, [S.prop])).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(as(E, `insert into public.release_packs (property_id, items) values ($1, $2)`, [S.prop, JSON.stringify([{ kind: 'drill_plan', ref: S.otherMap }])])).rejects.toThrow(/not in this property/);
    await expect(as(E, `insert into public.release_packs (property_id, items) values ($1, $2)`, [S.prop, JSON.stringify([{ kind: 'drill_plan', ref: S.map }, { kind: 'drill_plan', ref: S.map }])])).rejects.toThrow(/listed twice/);
    await expect(as(E, `insert into public.release_packs (property_id, items) values ($1, '[{"kind":"video","ref":"x"}]')`, [S.prop])).rejects.toThrow(/INVALID_RELEASE_PACK/);
    await expect(as(E, `insert into public.release_packs (org_id, property_id, items) values ($1, $2, '[]')`, [S.orgB, S.prop])).rejects.toThrow(/permission denied/);
    const p = await one(E, `insert into public.release_packs (property_id, items) values ($1, $2) returning *`, [S.prop, JSON.stringify(items)]);
    expect(p).toMatchObject({ org_id: S.org, property_id: S.prop, updated_by: E, items });
    S.pack = p.id;
    await expect(as(E, `insert into public.release_packs (property_id, items) values ($1, '[]')`, [S.prop])).rejects.toThrow(/duplicate key/);
    expect((await as(V, `update public.release_packs set items = '[]' returning id`)).rows).toEqual([]);
    expect((await as(X, `select id from public.release_packs`)).rows).toEqual([]);
    expect((await as(V, `select items from public.release_packs`)).rows[0].items).toEqual(items);
    await expect(as(E, `update public.release_packs set property_id = $1`, [S.other])).rejects.toThrow(/permission denied/);
    await expect(as(O, `delete from public.release_packs`)).rejects.toThrow(/permission denied/);
  });
});

describe('approvals', () => {
  it('are refused to viewers and outsiders, and when the reviewer saw stale data', async () => {
    const c = await current();
    await expect(approve(V, c)).rejects.toThrow(/RELEASE_PACK_NOT_FOUND/);
    await expect(approve(X, c)).rejects.toThrow(/RELEASE_PACK_NOT_FOUND/);
    await expect(approve(E, { ...c, batches: [] })).rejects.toThrow(/APPROVAL_STALE: the drill data/);
    await expect(approve(E, { ...c, figs: c.figs.slice(1) })).rejects.toThrow(/APPROVAL_STALE: a map/);
    await expect(approve(E, { ...c, recipe: { id: id(9) } })).rejects.toThrow(/APPROVAL_STALE: the results recipe/);
    await expect(as(E, `insert into public.release_pack_approvals (pack_id, approved_by, batch_ids) values ($1, $2, '{}')`, [S.pack, O])).rejects.toThrow(/permission denied/);
  });

  it('record the server copy: live batches, map revisions, latest 3D figure versions, the recipe, approver and time', async () => {
    await val(E, `select public.publish_figure_version('figure', $1, 'News release', '2026-11-03')`, [S.fig]);
    const c = await current();
    const a = await approve(E, { ...c, note: '  NR 26-14 ' });
    const recipe = await one(E, `select id, version from public.drill_result_recipes where property_id = $1 and superseded_at is null`, [S.prop]);
    expect(a).toMatchObject({ org_id: S.org, property_id: S.prop, batch_ids: [S.b1], recipe: { name: 'Default', id: recipe.id, version: 1 },
      note: 'NR 26-14', approved_by: E, approved_by_email: 'geo@star.test' });
    expect(a.figures.map((f) => [f.item, f.kind, f.id, f.version, f.revision])).toEqual([[1, 'map', S.map, null, 1], [2, 'figure', S.fig, 1, null], [3, 'map', S.loc, null, 1]]);
    expect(a.figures[1].version_id).toBeTruthy();
    expect((await as(V, `select id from public.release_pack_approvals`)).rows).toEqual([{ id: a.id }]);
    expect((await as(X, `select id from public.release_pack_approvals`)).rows).toEqual([]);
    S.approval = a;
  });

  it('a new import makes the reviewed state stale until the reviewer sees it', async () => {
    const old = await current();
    S.b2 = await imp([assay('R-77', 0), assay('R-78', 0)]);
    await expect(approve(E, old)).rejects.toThrow(/APPROVAL_STALE: the drill data/);
    const a = await approve(E, await current());
    expect(a.batch_ids).toEqual([S.b1, S.b2]);
    // A reviewer that saw only the latest batches (the summary's window) still approves every live one.
    await val(E, `select public.drill_rollback_batch($1)`, [S.b2]);
    await expect(approve(E, { ...(await current()), batches: [S.b1, S.b2] })).rejects.toThrow(/APPROVAL_STALE/);
    expect((await approve(E, await current())).batch_ids).toEqual([S.b1]);
  });

  it('never change or disappear, for any role, until their pack is deleted with its property', async () => {
    await expect(as(E, `update public.release_pack_approvals set note = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(as(O, `delete from public.release_pack_approvals`)).rejects.toThrow(/permission denied/);
    await expect(su(`update public.release_pack_approvals set batch_ids = '{}' where id = $1`, [S.approval.id])).rejects.toThrow(/APPROVAL_IMMUTABLE/);
    await expect(su(`delete from public.release_pack_approvals where id = $1`, [S.approval.id])).rejects.toThrow(/APPROVAL_IMMUTABLE/);
    // Changing the pack's items keeps every approval as it was.
    await as(E, `update public.release_packs set items = $1`, [JSON.stringify([{ kind: 'drill_plan', ref: S.map }])]);
    expect(await one(V, `select items, batch_ids from public.release_pack_approvals where id = $1`, [S.approval.id])).toEqual({ items: S.approval.items, batch_ids: [S.b1] });
    await su(`delete from public.release_packs where id = $1`, [S.pack]);
    expect(await su(`select count(*)::int as n from public.release_pack_approvals`)).toEqual([{ n: 0 }]);
  });
});
