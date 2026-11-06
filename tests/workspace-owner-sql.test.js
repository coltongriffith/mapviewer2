// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// docs/state-machines.md, WS-8: deleting the only owner's account must not
// leave the workspace without an owner.
let db, val, su;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), A = id(2), E = id(3), A2 = id(4);
beforeAll(async () => {
  ({ db, val, su } = await createWorkspaceDb({ emails: { [O]: 'o@x.test', [A]: 'a@x.test', [E]: 'e@x.test', [A2]: 'a2@x.test' }, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261106150000_workspace_keeps_an_owner.sql')] }));
}, 120_000);
afterAll(async () => db?.close());

const roles = async (org) => Object.fromEntries((await su(`select user_id, role from public.organization_members where org_id = $1`, [org])).map((r) => [r.user_id, r.role]));

it('promotes the longest-standing admin when the only owner’s account is deleted', async () => {
  const org = (await val(O, `select public.create_organization('Keep Co')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role, joined_at) values
    ($1, $2, 'admin', now() - interval '2 days'), ($1, $3, 'editor', now() - interval '9 days'), ($1, $4, 'admin', now() - interval '1 day')`, [org, A, E, A2]);
  await su(`delete from auth.users where id = $1`, [O]);
  expect(await roles(org)).toMatchObject({ [A]: 'owner', [A2]: 'admin', [E]: 'editor' });
});

it('leaves a workspace with another owner alone', async () => {
  const org = (await val(A, `select public.create_organization('Two Owners')`)).id;
  await su(`insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'admin')`, [org, E, A2]);
  await su(`delete from public.organization_members where org_id = $1 and user_id = $2`, [org, A]);
  expect(await roles(org)).toMatchObject({ [E]: 'owner', [A2]: 'admin' });
});
