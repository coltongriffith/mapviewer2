// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// Restoring a map from the trash must respect the plan's map limit, like
// creating one (docs/state-machines.md, ED-3).
let db, as, val;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F = id(1); // free user
const P = id(2); // pro user
const W = id(3); // workspace owner
const EMAIL = { [F]: 'free@x.test', [P]: 'pro@x.test', [W]: 'owner@x.test' };

beforeAll(async () => {
  ({ db, as, val } = await createWorkspaceDb({
    emails: EMAIL, pro: [P],
    migrations: [readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261106100000_restore_respects_map_limits.sql')],
  }));
}, 120_000);
afterAll(async () => db?.close());

const create = (u, name) => val(u, `select public.create_cloud_project($1, '{}')`, [name]);
const active = async (u) => Number(await val(u, `select count(*) from public.projects where user_id = $1 and org_id is null and deleted_at is null`, [u]));

describe('restore respects map limits', () => {
  it('a free user cannot restore past the 2-map limit', async () => {
    const a = await create(F, 'A');
    const b = await create(F, 'B');
    expect(await val(F, `select public.trash_cloud_project($1)`, [a])).toBe(true);
    expect(await val(F, `select public.trash_cloud_project($1)`, [b])).toBe(true);
    await create(F, 'C');
    await create(F, 'D');
    await expect(as(F, `select public.restore_cloud_project($1)`, [a])).rejects.toThrow(/PROJECT_LIMIT/);
    // A plain update of deleted_at, allowed by the row policy, is held to the same limit.
    await expect(as(F, `update public.projects set deleted_at = null where id = $1`, [b])).rejects.toThrow(/PROJECT_LIMIT/);
    expect(await active(F)).toBe(2);
  });

  it('a free user under the limit can still restore', async () => {
    const [{ id: c }] = (await as(F, `select id from public.projects where name = 'C'`)).rows;
    expect(await val(F, `select public.trash_cloud_project($1)`, [c])).toBe(true);
    const [{ id: a }] = (await as(F, `select id from public.projects where name = 'A'`)).rows;
    expect(await val(F, `select public.restore_cloud_project($1)`, [a])).toBe(true);
    expect(await active(F)).toBe(2);
  });

  it('a pro user is unlimited', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await create(P, `P${i}`));
    for (const x of ids) await val(P, `select public.trash_cloud_project($1)`, [x]);
    for (let i = 0; i < 3; i++) await create(P, `Q${i}`);
    for (const x of ids) expect(await val(P, `select public.restore_cloud_project($1)`, [x])).toBe(true);
    expect(await active(P)).toBe(6);
  });

  it('a company cannot restore past its workspace map limit', async () => {
    const org = (await val(W, `select public.create_organization('Limit Co') as r`)).id;
    const prop = (await as(W, `insert into public.properties (org_id, name) values ($1, 'Prop') returning id`, [org])).rows[0].id;
    const ids = [];
    for (let i = 0; i < 25; i++) ids.push(await val(W, `select public.create_org_project($1, $2, '{}')`, [prop, `M${i}`]));
    expect(await val(W, `select public.trash_cloud_project($1)`, [ids[0]])).toBe(true);
    await val(W, `select public.create_org_project($1, 'M25', '{}')`, [prop]);
    await expect(as(W, `select public.restore_cloud_project($1)`, [ids[0]])).rejects.toThrow(/ORG_PROJECT_LIMIT/);
  });
});
