// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// docs/state-machines.md, ED-7: a rename moves the revision, so a tab with
// the map open cannot silently save the old name back.
let db, val, as;
const U = '00000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  ({ db, val, as } = await createWorkspaceDb({ emails: { [U]: 'u@x.test' }, pro: [U], migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261106140000_rename_bumps_revision.sql')] }));
}, 120_000);
afterAll(async () => db?.close());

it('a rename bumps the revision; saves and thumbnail updates behave as before', async () => {
  const id = await val(U, `select public.create_cloud_project('Old', '{}')`);
  expect(await val(U, `select public.save_cloud_project($1, 'Old', '{"v":1}', 1)`, [id])).toBe(2);
  const renamed = (await as(U, `update public.projects set name = 'New' where id = $1 returning revision`, [id])).rows[0].revision;
  expect(renamed).toBe(3);
  // The open tab still expects revision 2: its autosave is refused, not applied.
  await expect(as(U, `select public.save_cloud_project($1, 'Old', '{"v":2}', 2)`, [id])).rejects.toThrow(/SAVE_CONFLICT/);
  expect(await val(U, `select public.save_cloud_project($1, 'New', '{"v":2}', 3)`, [id])).toBe(4);
  const thumb = (await as(U, `update public.projects set thumbnail = 'data:x' where id = $1 returning revision`, [id])).rows[0].revision;
  expect(thumb).toBe(4);
});
