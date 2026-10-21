// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';
import { defaultRecipe, checkRecipe } from '../shared/drillResults.js';

// Drill database, Phase 2C (20261028100000): a property's results recipe,
// versioned per name, saved by editors and read by members, role by role.
// The workspace, data library and drill database migrations come first; this
// one is applied twice. Tests share state in order.
let db, as, one, val, su;
const MIGRATION = readMigration('20261028100000_drill_intercepts.sql');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(3), V = id(4), X = id(5);
const EMAIL = { [O]: 'owner@star.test', [E]: 'geo@star.test', [V]: 'investor@fund.test', [X]: 'rival@rival.test' };
const S = {};

const RECIPE = { ...defaultRecipe(['Au', 'Cu'], { Cu: '%', Au: 'g/t' }), trueWidth: 'True widths are 70–90% of core lengths.' };
const save = (uid, recipe, { name = 'Default', base = null, property = S.prop } = {}) =>
  val(uid, `select public.drill_save_recipe($1, $2, $3::jsonb, $4)`, [property, name, JSON.stringify(recipe), base]);
const read = (uid, property = S.prop) => val(uid, `select public.drill_property_recipes($1)`, [property]);

beforeAll(async () => {
  ({ db, as, one, val, su } = await createWorkspaceDb({ emails: EMAIL, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), MIGRATION, MIGRATION] }));
  S.org = (await val(O, `select public.create_organization('Star Copper Corp.')`)).id;
  S.orgB = (await val(X, `select public.create_organization('Rival Metals')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`, [S.org, E, V]);
  S.prop = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Rails') returning id`, [S.org])).id;
  S.propB = (await one(X, `insert into public.properties (org_id, name) values ($1, 'Rival') returning id`, [S.orgB])).id;
}, 120_000);
afterAll(async () => db?.close());

describe('migration', () => {
  it('pins search_path, runs the RPCs as definer, and keeps every function from anon and the check from the browser', async () => {
    const fns = await su(`select proname, proconfig, prosecdef, has_function_privilege('anon', oid, 'execute') as anon,
      has_function_privilege('authenticated', oid, 'execute') as auth from pg_proc
      where proname in ('drill_recipe_error', 'drill_save_recipe', 'drill_property_recipes') order by proname`);
    expect(fns.map((f) => [f.proname, f.proconfig?.[0], f.prosecdef, f.anon, f.auth])).toEqual([
      ['drill_property_recipes', 'search_path=""', true, false, true],
      ['drill_recipe_error', 'search_path=""', false, false, false],
      ['drill_save_recipe', 'search_path=""', true, false, true],
    ]);
  });

  it('applies twice without duplicates; the table is read-only to members and closed to anon', async () => {
    expect(await su(`select tablename, policyname from pg_policies group by 1, 2 having count(*) > 1`)).toEqual([]);
    const pols = await su(`select policyname, cmd, qual from pg_policies where tablename = 'drill_result_recipes'`);
    expect(pols.map((p) => [p.policyname, p.cmd])).toEqual([['Members read drill_result_recipes', 'SELECT']]);
    expect(pols[0].qual).toMatch(/\(\s*SELECT auth\.uid\(\) AS uid\s*\)/);
    const grants = await su(`select grantee, privilege_type from information_schema.role_table_grants
      where table_name = 'drill_result_recipes' and grantee in ('anon', 'authenticated') order by 1, 2`);
    expect(grants).toEqual([{ grantee: 'authenticated', privilege_type: 'SELECT' }]);
    expect(await su(`select relrowsecurity from pg_class where relname = 'drill_result_recipes'`)).toEqual([{ relrowsecurity: true }]);
  });
});

describe('who can save and read', () => {
  it('refuses viewers, other companies, signed-out callers and direct writes', async () => {
    await expect(save(V, RECIPE)).rejects.toThrow(/ORG_READ_ONLY/);
    await expect(save(X, RECIPE)).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(save(E, RECIPE, { property: S.propB })).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(save(null, RECIPE)).rejects.toThrow(/permission denied/);
    await expect(read(null)).rejects.toThrow(/permission denied/);
    await expect(read(X)).rejects.toThrow(/forbidden/);
    for (const u of [O, E]) {
      await expect(as(u, `insert into public.drill_result_recipes (org_id, property_id, name, version, recipe) values ($1, $2, 'x', 1, '{}')`, [S.org, S.prop])).rejects.toThrow(/permission denied/);
      await expect(as(u, `update public.drill_result_recipes set recipe = '{}'`)).rejects.toThrow(/permission denied/);
      await expect(as(u, `delete from public.drill_result_recipes`)).rejects.toThrow(/permission denied/);
    }
    await expect(as(null, `select id from public.drill_result_recipes`)).rejects.toThrow(/permission denied/);
    await expect(val(E, `select public.drill_recipe_error('{}'::jsonb)`)).rejects.toThrow(/permission denied/);
  });

  it('an editor saves version 1; members read it, other companies see nothing', async () => {
    expect(checkRecipe(RECIPE)).toEqual([]);
    const r = await save(E, RECIPE);
    expect(r).toMatchObject({ name: 'Default', version: 1, recipe: RECIPE, created_by_email: 'geo@star.test', unchanged: false });
    S.v1 = r.id;
    for (const u of [O, E, V]) {
      const list = await read(u);
      expect(list.map((x) => [x.name, x.version, x.id])).toEqual([['Default', 1, S.v1]]);
      expect(list[0].recipe).toEqual(RECIPE);
      expect(list[0].versions.map((v) => [v.version, v.created_by_email])).toEqual([[1, 'geo@star.test']]);
      expect((await as(u, `select id from public.drill_result_recipes`)).rows).toEqual([{ id: S.v1 }]);
    }
    expect((await as(X, `select id from public.drill_result_recipes`)).rows).toEqual([]);
    expect(await su(`select action, entity_type, summary from public.org_activity where summary like 'Saved the results recipe%'`))
      .toEqual([{ action: 'updated', entity_type: 'property', summary: 'Saved the results recipe "Default" (version 1)' }]);
  });
});

describe('versioning', () => {
  it('saving the same recipe again changes nothing', async () => {
    expect(await save(E, RECIPE, { base: 1 })).toMatchObject({ id: S.v1, version: 1, unchanged: true });
    expect(await su(`select count(*)::int as n from public.drill_result_recipes`)).toEqual([{ n: 1 }]);
  });

  it('a change is a new version; the old row is kept, superseded, and only one is current', async () => {
    const r = await save(O, { ...RECIPE, cutoff: 0.3 }, { base: 1 });
    expect(r).toMatchObject({ version: 2, unchanged: false });
    const rows = await su(`select version, superseded_at is null as current, recipe->'cutoff' as cutoff from public.drill_result_recipes order by version`);
    expect(rows).toEqual([{ version: 1, current: false, cutoff: 0.2 }, { version: 2, current: true, cutoff: 0.3 }]);
    const list = await read(V);
    expect(list.map((x) => [x.name, x.version])).toEqual([['Default', 2]]);
    expect(list[0].versions.map((v) => [v.version, v.created_by_email])).toEqual([[2, 'owner@star.test'], [1, 'geo@star.test']]);
    // Back to the first numbers: a third version, not a revival of the first.
    expect(await save(E, RECIPE, { base: 2 })).toMatchObject({ version: 3, recipe: RECIPE });
  });

  it('refuses a save based on an older version (someone saved meanwhile)', async () => {
    await expect(save(E, { ...RECIPE, minLength: 5 }, { base: 2 })).rejects.toThrow(/RECIPE_CONFLICT: version 3 of "Default"/);
    await expect(save(E, { ...RECIPE, minLength: 5 }, { name: 'Gold only', base: 1 })).rejects.toThrow(/RECIPE_CONFLICT: version 0/);
    expect(await su(`select max(version)::int as v from public.drill_result_recipes`)).toEqual([{ v: 3 }]);
  });

  it('keeps each name apart, listed by name', async () => {
    const gold = { ...defaultRecipe(['Au'], { Au: 'g/t' }), name: undefined };
    expect(await save(E, gold, { name: '  Gold only ', base: 0 })).toMatchObject({ name: 'Gold only', version: 1 });
    expect((await read(E)).map((x) => [x.name, x.version])).toEqual([['Default', 3], ['Gold only', 1]]);
    expect(await su(`select name, count(*)::int as n from public.drill_result_recipes where superseded_at is null group by 1 order by 1`))
      .toEqual([{ name: 'Default', n: 1 }, { name: 'Gold only', n: 1 }]);
  });
});

describe('checks', () => {
  it('refuses recipes the calculator cannot use, without casting errors', async () => {
    const bad = [
      [[], /must be an object/],
      [{ ...RECIPE, elements: [] }, /1 to 20 elements/],
      [{ ...RECIPE, elements: 'Cu' }, /1 to 20 elements/],
      [{ ...RECIPE, elements: [{ name: 'Cu', unit: 'lb' }] }, /a unit \(%, g\/t, ppm or ppb\)/],
      [{ ...RECIPE, elements: [{ name: 'Cu', unit: '%', price: 'four' }] }, /price and recovery/],
      [{ ...RECIPE, elements: [{ name: 'Cu', unit: '%', recovery: 120 }] }, /price and recovery/],
      [{ ...RECIPE, elements: [{ name: 'Cu', unit: '%' }, { name: 'Cu', unit: 'ppm' }] }, /listed twice/],
      [{ ...RECIPE, primary: 'Mo' }, /primary element/],
      [{ ...RECIPE, cutoff: '0.2' }, /cutoff, minLength and maxDilution/],
      [{ ...RECIPE, maxDilution: -1 }, /cutoff, minLength and maxDilution/],
      [{ ...RECIPE, inclCutoff: 0.1 }, /inclCutoff must be above/],
      [{ ...RECIPE, inclMinLength: 'x' }, /inclMinLength/],
      [{ ...RECIPE, bdl: 'ignore' }, /bdl must be/],
      [{ ...RECIPE, trueWidth: 'x'.repeat(1001) }, /true-width note/],
      [{ ...RECIPE, pad: 'x'.repeat(17000) }, /larger than 16 kB/],
    ];
    for (const [recipe, re] of bad) await expect(save(E, recipe, { name: 'Bad' }), JSON.stringify(recipe).slice(0, 80)).rejects.toThrow(re);
    await expect(save(E, RECIPE, { name: ' ' })).rejects.toThrow(/INVALID_RECIPE: the name/);
    // No incl. at all is a recipe too.
    expect(await save(E, { ...RECIPE, inclCutoff: null }, { name: 'No incl' })).toMatchObject({ version: 1 });
  });

  it('keeps at most 20 names per property', async () => {
    for (let i = 4; i <= 20; i++) await save(E, RECIPE, { name: `R${i}` });
    await expect(save(E, RECIPE, { name: 'R21' })).rejects.toThrow(/TOO_MANY_RECIPES: a property keeps at most 20 recipes/);
    // A new version of an existing name is still allowed.
    expect(await save(E, { ...RECIPE, cutoff: 0.25 }, { name: 'R20' })).toMatchObject({ version: 2 });
  });
});
