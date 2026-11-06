// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// One plan answer everywhere (docs/state-machines.md, BILL-4, BILL-5).
let db, su;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const users = { [id(1)]: 'c@x.test', [id(2)]: 'f@x.test', [id(3)]: 'g@x.test' };

beforeAll(async () => {
  ({ db, su } = await createWorkspaceDb({
    emails: users,
    migrations: [readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261106110000_plan_resolution_consistency.sql')],
  }));
  await su(`insert into public.user_plans values ($1, 'company', 'stripe'), ($2, 'free', 'signup'), ($3, 'free', 'grandfathered')`, [id(1), id(2), id(3)]);
}, 120_000);
afterAll(async () => db?.close());

describe('plan resolution', () => {
  it('BILL-5: a Company plan on an unprotected source has unlimited maps, like its tenures', async () => {
    const limit = async (u) => (await su(`select public.ws_personal_map_limit($1) as l`, [u]))[0].l;
    expect(await limit(id(1))).toBeNull();
    expect(await limit(id(2))).toBe(2);
    expect(await limit(id(3))).toBeNull();
  });

  it('BILL-4: the scheduler can read any owner’s limits, and they match the caller view', async () => {
    const forUser = async (u) => (await su(`select public.tenure_plan_limits_for($1) as l`, [u]))[0].l;
    expect((await forUser(id(1))).plan).toBe('company');
    expect(await forUser(id(2))).toMatchObject({ plan: 'free', max_monitored_tenures: 10, max_portfolios: 1 });
    expect((await forUser(id(3))).plan).toBe('pro');
    const grants = await su(`select has_function_privilege('authenticated', 'public.tenure_plan_limits_for(uuid)', 'execute') as ok`);
    expect(grants[0].ok).toBe(false);
  });
});
