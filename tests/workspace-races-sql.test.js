// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// Workspace and share-limit races (docs/state-machines.md, WS-1, WS-4, WS-6).
// PGlite runs one connection, so lock ORDER is checked in the function bodies
// and behaviour is checked where one connection can show it.
let db, as, one, val, su;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(3), U = id(6);
const EMAIL = { [O]: 'owner@star.test', [E]: 'geo@star.test', [U]: 'mover@star.test' };
const S = {};
const hash = 'a'.repeat(64);

beforeAll(async () => {
  ({ db, as, one, val, su } = await createWorkspaceDb({ emails: EMAIL, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), readMigration('20261028100000_drill_intercepts.sql'),
    readMigration('20261029100000_figure_versions.sql'), readMigration('20261103120000_release_packs.sql'),
    readMigration('20261106130000_workspace_and_share_races.sql')] }));
  S.org = (await val(O, `select public.create_organization('Star Copper Corp.')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'admin')`, [S.org, E, U]);
  S.prop = (await one(E, `insert into public.properties (org_id, name) values ($1, 'Rails') returning id`, [S.org])).id;
  S.fig = id(300);
  await as(E, `insert into public.three_d_projects (id, name, settings, file_paths, org_id, property_id) values ($1, 'Moved in', '{}', '[]', $2, $3)`, [S.fig, S.org, S.prop]);
}, 120_000);
afterAll(async () => db?.close());

const def = async (fn) => (await su(`select pg_get_functiondef($1::regprocedure) as d`, [fn]))[0].d;

describe('WS-4: release pack figures use versions from the pack’s company', () => {
  it('ignores a version published in another home before the figure moved in', async () => {
    await su(`insert into public.figure_versions (figure_kind, figure_id, version, label, name, owner_id, snapshot, content_hash)
      values ('figure', $1, 1, 'v1', 'Moved in', $2, '{}', $3)`, [S.fig, U, hash]);
    const items = JSON.stringify([{ kind: 'figure_3d', ref: S.fig }]);
    let [f] = (await su(`select public.release_pack_figures($1, $2::jsonb) as f`, [S.prop, items]))[0].f;
    expect(f.version_id).toBeNull();
    await su(`insert into public.figure_versions (figure_kind, figure_id, version, label, name, org_id, property_id, snapshot, content_hash)
      values ('figure', $1, 2, 'v2', 'Moved in', $2, $3, '{}', $4)`, [S.fig, S.org, S.prop, hash]);
    [f] = (await su(`select public.release_pack_figures($1, $2::jsonb) as f`, [S.prop, items]))[0].f;
    expect(f.version).toBe(2);
  });
});

describe('WS-1: share caps are counted under a per-caller lock', () => {
  it('locks before counting, in both share functions', async () => {
    for (const fn of ['public.create_shared_map(jsonb, text)', 'public.create_agent_share(uuid, jsonb, uuid)']) {
      const d = await def(fn);
      expect(d.indexOf('pg_advisory_xact_lock'), fn).toBeGreaterThan(0);
      expect(d.indexOf('pg_advisory_xact_lock'), fn).toBeLessThan(d.indexOf('count(*)'));
    }
  });
});

describe('WS-6: role changes re-check the caller after the owner lock', () => {
  it('re-checks admin after locking, in set_member_role and remove_member', async () => {
    for (const fn of ['public.set_member_role(uuid, uuid, text)', 'public.remove_member(uuid, uuid)']) {
      const d = await def(fn);
      const lock = d.indexOf("role = 'owner' for update");
      expect(lock, fn).toBeGreaterThan(0);
      expect(d.indexOf("has_org_role(p_org, 'admin')", lock), fn).toBeGreaterThan(lock);
    }
  });

  it('still lets an admin change a role and refuses a viewer', async () => {
    expect(await val(U, `select public.set_member_role($1, $2, 'viewer')`, [S.org, E])).toMatchObject({ role: 'viewer' });
    await expect(as(E, `select public.set_member_role($1, $2, 'viewer')`, [S.org, U])).rejects.toThrow(/forbidden/);
  });

  it('invites lock per person and re-check membership before issuing', async () => {
    const d = await def('public.create_org_invite(uuid, text, text)');
    expect(d).toMatch(/invites-by:/);
    const update = d.indexOf('set revoked_at = now()');
    expect(d.indexOf('ALREADY_MEMBER', update)).toBeGreaterThan(update);
  });
});
