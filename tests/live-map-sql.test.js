// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// Live investor web maps (20261103110000): one share link per saved map, republished in place by someone who can
// edit the map, on Pro or a paid company workspace. Applied twice to prove it is idempotent.
let as, val, su, db;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = id(1), F = id(2), E = id(3), X = id(4);
const S = {};
const state = (title = 'Star Copper', extra = {}) => ({ layout: { title }, layers: [{ id: 'c', role: 'claims', geojson: { type: 'FeatureCollection', features: [] } }], ...extra });
const publish = (uid, project, s = state()) => val(uid, 'select public.publish_live_map($1, $2::jsonb)', [project, JSON.stringify(s)]);
const live = (uid, project) => val(uid, 'select public.get_live_map($1)', [project]);
const age = (shareId) => su(`update public.shared_maps set updated_at = now() - interval '1 minute' where id = $1`, [shareId]);

beforeAll(async () => {
  const sharedMaps = `create table public.shared_maps (id text not null primary key, state jsonb not null,
    created_at timestamptz default now(), user_id uuid, view_count integer default 0);
    alter table public.shared_maps enable row level security;
    revoke all on table public.shared_maps from anon, authenticated;`;
  const migration = readMigration('20261103110000_live_map_embeds.sql');
  ({ db, as, val, su } = await createWorkspaceDb({
    emails: { [P]: 'pro@star.test', [F]: 'free@star.test', [E]: 'geo@star.test', [X]: 'rival@rival.test' }, pro: [P],
    migrations: [sharedMaps, readMigration('20260728000004_shared_maps_bounds.sql'), readMigration('20261023100000_workspaces_properties.sql'), migration, migration],
  }));
  S.mine = (await su(`insert into public.projects (user_id, name) values ($1, 'Rails') returning id`, [P]))[0].id;
  S.free = (await su(`insert into public.projects (user_id, name) values ($1, 'Free map') returning id`, [F]))[0].id;
  S.org = (await val(F, `select public.create_organization('Star Copper Corp.')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor')`, [S.org, E]);
  S.company = (await su(`insert into public.projects (user_id, org_id, name) values ($1, $2, 'Company map') returning id`, [F, S.org]))[0].id;
}, 120_000);
afterAll(async () => db?.close());

describe('publish_live_map', () => {
  const companyLink = async () => {
    await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor') on conflict (org_id, user_id) do update set role = 'editor'`, [S.org, E]);
    const project = (await su(`insert into public.projects (user_id, org_id, name) values ($1, $2, 'Another company map') returning id`, [F, S.org]))[0].id;
    return { project, share: await publish(E, project) };
  };
  it('creates one live link for a map and republishes the same link in place', async () => {
    const first = await publish(P, S.mine, state('v1'));
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect((await val(null, 'select public.get_shared_map($1)', [first])).layout.title).toBe('v1');
    await expect(publish(P, S.mine, state('too soon'))).rejects.toThrow(/SHARE_RATE_LIMIT/);
    await age(first);
    expect(await publish(P, S.mine, state('v2'))).toBe(first);
    expect((await val(null, 'select public.get_shared_map($1)', [first])).layout.title).toBe('v2');
    const info = await live(P, S.mine);
    expect(info).toMatchObject({ id: first, view_count: 1 }); // two reads inside get_shared_map's one-minute throttle
    expect(await val(P, 'select count(*)::int from public.list_my_shared_maps()')).toBe(1);
  });

  it('starts a new link once the live one is revoked', async () => {
    const { id: before } = await live(P, S.mine);
    expect(await val(P, 'select public.revoke_shared_map($1)', [before])).toBe(true);
    expect(await live(P, S.mine)).toBeNull();
    const after = await publish(P, S.mine);
    expect(after).not.toBe(before);
    expect(await val(null, 'select public.get_shared_map($1)', [before])).toBeNull();
  });

  it('refuses a free personal map, someone else\'s map, signed-out callers and bad payloads', async () => {
    await expect(publish(F, S.free)).rejects.toThrow(/LIVE_MAP_PLAN/);
    await expect(publish(X, S.mine)).rejects.toThrow(/NOT_FOUND/);
    await expect(publish(null, S.mine)).rejects.toThrow(/permission denied|not authenticated/);
    await expect(publish(P, S.mine, { nope: true })).rejects.toThrow(/SHARE_INVALID/);
    expect(await live(X, S.mine)).toBeNull();
    await expect(as(null, 'select public.get_live_map($1)', [S.mine])).rejects.toThrow(/permission denied/);
  });

  it('lets an editor of a paid company publish its map; a free company is refused', async () => {
    await expect(publish(E, S.company)).rejects.toThrow(/LIVE_MAP_PLAN/);
    await su(`update public.organizations set plan = 'team' where id = $1`, [S.org]);
    const shareId = await publish(E, S.company);
    expect((await live(F, S.company)).id).toBe(shareId);
    expect(await live(X, S.company)).toBeNull();
  });

  it('lets the company, not just the first publisher, revoke its live link', async () => {
    const revoke = (uid) => val(uid, 'select public.revoke_live_map($1)', [S.company]);
    await su(`delete from public.organization_members where org_id = $1 and user_id = $2`, [S.org, E]);
    await expect(revoke(E)).rejects.toThrow(/NOT_FOUND/);
    await expect(revoke(X)).rejects.toThrow(/NOT_FOUND/);
    expect(await revoke(F)).toBe(true);
    expect(await live(F, S.company)).toBeNull();
    expect(await revoke(F)).toBe(false);
  });

  it('removes legacy discovery and revocation rights when the original publisher leaves', async () => {
    const { share } = await companyLink();
    await su(`delete from public.organization_members where org_id = $1 and user_id = $2`, [S.org, E]);
    const listed = (uid) => val(uid, 'select exists(select 1 from public.list_my_shared_maps() where id = $1)', [share]);
    expect({ removedListed: await listed(E), ownerListed: await listed(F), removedRevoke: await val(E, 'select public.revoke_shared_map($1)', [share]) })
      .toEqual({ removedListed: false, ownerListed: true, removedRevoke: false });
    expect(await val(null, 'select public.get_shared_map($1)', [share])).not.toBeNull();
  });

  it('lets the current company owner revoke through the existing account share controls, even after trashing the map', async () => {
    const { project, share } = await companyLink();
    await su(`update public.projects set deleted_at = now() where id = $1`, [project]);
    expect(await val(F, 'select public.revoke_shared_map($1)', [share])).toBe(true);
    expect(await val(null, 'select public.get_shared_map($1)', [share])).toBeNull();
    expect((await su('select state from public.shared_maps where id = $1', [share]))[0].state).toEqual({});
  });

  it('preserves publisher ownership of ordinary snapshots and denies company viewers live revocation', async () => {
    const snapshot = await val(E, 'select public.create_shared_map($1::jsonb, null)', [JSON.stringify(state())]);
    expect(await val(F, 'select public.revoke_shared_map($1)', [snapshot])).toBe(false);
    expect(await val(E, 'select public.revoke_shared_map($1)', [snapshot])).toBe(true);
    const { share } = await companyLink();
    await su(`update public.organization_members set role = 'viewer' where org_id = $1 and user_id = $2`, [S.org, E]);
    expect(await val(E, 'select public.revoke_shared_map($1)', [share])).toBe(false);
    expect(await val(E, 'select exists(select 1 from public.list_my_shared_maps() where id = $1)', [share])).toBe(false);
  });
});
