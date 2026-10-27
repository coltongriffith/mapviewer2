// @vitest-environment node
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { entitlementsFor } from '../src/utils/entitlements.js';

let db;
const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
const migration = name => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const companyMigration = '20261028120000_company_tenure_entitlement';

beforeAll(async () => {
  db = await PGlite.create();
  // Auth identity and the public registry are minimal fixtures. All private
  // tables, RLS, quota RPCs and policy/recipient triggers below are real SQL.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create table public.tenures (id uuid primary key);
    create table public.tenure_change_events (id uuid primary key);
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const name of [
    '20260716000001_billing_plans',
    '20260801000002_tenure_portfolios',
    '20260801000003_tenure_quota_and_admin',
    '20260801000007_tenure_add_result_accuracy',
    '20260801000008_tenure_quota_integrity',
    '20260807000001_tenure_final_reminder_and_note_metadata',
    companyMigration,
  ]) await db.exec(migration(name));
  await db.exec(migration(companyMigration)); // Replacement remains idempotent.
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role; set test.uid = ''; truncate auth.users, public.tenures cascade;`);
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)',
    [userA, 'owner-a@example.test', userB, 'owner-b@example.test']);
});
const asUser = async (id = userA) => {
  await db.exec('reset role');
  await db.query("select set_config('test.uid', $1, false)", [id]);
  await db.exec('set role authenticated');
};
const assign = async (plan, source = 'signup', id = userA) => {
  await db.exec('reset role');
  await db.query('update public.user_plans set plan=$1, source=$2 where user_id=$3', [plan, source, id]);
  await asUser(id);
};
const limits = async () => (await db.query('select public.tenure_plan_limits() as value')).rows[0].value;
const createPortfolio = async () => (await db.query("select public.create_monitored_portfolio('Test claims') as id")).rows[0].id;

it.each([
  ['free', 'signup', 'free'], ['pro', 'stripe', 'pro'],
  ['free', 'grandfathered', 'pro'], ['pro', 'grandfathered', 'pro'], ['free', 'admin', 'pro'],
  ['company', 'admin', 'company'], ['company', 'grandfathered', 'company'],
])('resolves stored %s/%s to %s with the client quotas and reminder ladder', async (plan, source, tier) => {
  await assign(plan, source);
  const expected = entitlementsFor(tier);
  expect(await limits()).toEqual({
    plan: tier,
    max_monitored_tenures: expected.max_monitored_tenures,
    max_portfolios: Number.isFinite(expected.max_portfolios) ? expected.max_portfolios : null,
    max_alert_recipients: expected.max_alert_recipients,
    alert_offsets: expected.alert_offsets_days,
  });
});

it('keeps a missing plan Free and cannot read or change another account’s assignment', async () => {
  await assign('company', 'admin', userB);
  await db.exec('reset role');
  await db.query('delete from public.user_plans where user_id=$1', [userA]);
  await asUser();
  expect((await limits()).plan).toBe('free');
  expect((await db.query('select * from public.user_plans')).rows).toEqual([]);
  await expect(db.query("insert into public.user_plans (user_id, plan, source) values ($1, 'company', 'admin')", [userA])).rejects.toThrow(/permission denied/);
  await expect(db.query("update public.user_plans set plan='company' where user_id=$1", [userA])).rejects.toThrow(/permission denied/);
  await asUser(userB);
  expect((await limits()).plan).toBe('company');
});

it('keeps the function inaccessible to anon and returns no entitlement without identity', async () => {
  await db.exec("set test.uid = ''; set role anon;");
  await expect(limits()).rejects.toThrow(/permission denied/);
  await db.exec('reset role; set role service_role;');
  expect(await limits()).toEqual({ plan: 'anonymous', max_monitored_tenures: 0,
    max_portfolios: 0, max_alert_recipients: 0, alert_offsets: [] });
});

it.each([['free', 'signup', 10, 1], ['pro', 'stripe', 50, 2], ['company', 'admin', 500, 10]])(
  'enforces %s title and recipient limits through the existing write paths', async (plan, source, maxTitles, maxRecipients) => {
    await db.exec('insert into public.tenures (id) select gen_random_uuid() from generate_series(1, 501)');
    const ids = (await db.query('select id from public.tenures order by id')).rows.map(row => row.id);
    await assign(plan, source);
    const portfolio = await createPortfolio();
    const add = async batch => (await db.query('select public.add_portfolio_tenures($1, $2::uuid[]) as value', [portfolio, batch])).rows[0].value;
    // The intended 19-title portfolio is accepted in full by Company.
    const first = await add(ids.slice(0, 19));
    expect(first.added).toBe(Math.min(19, maxTitles));
    const rest = await add(ids.slice(19));
    expect(rest.current_total).toBe(maxTitles);
    expect(first.added + rest.added).toBe(maxTitles);
    expect((await add([ids[500]])).added).toBe(0);
    const policy = (await db.query('select alert_policy_id from public.monitored_portfolios where id=$1', [portfolio])).rows[0].alert_policy_id;
    for (let i = 1; i < maxRecipients; i++) {
      await db.query('insert into public.tenure_alert_recipients (policy_id, user_id, email) values ($1, $2, $3)',
        [policy, userA, `recipient-${i}@example.test`]);
    }
    await expect(db.query('insert into public.tenure_alert_recipients (policy_id, user_id, email) values ($1, $2, $3)',
      [policy, userA, 'over-limit@example.test'])).rejects.toThrow(/RECIPIENT_LIMIT/);
    await expect(db.query('insert into public.monitored_portfolio_tenures (portfolio_id, tenure_id) values ($1, $2)',
      [portfolio, ids[500]])).rejects.toThrow(/permission denied/);
    if (plan === 'free') await expect(createPortfolio()).rejects.toThrow(/PORTFOLIO_LIMIT/);
    else expect(await createPortfolio()).toBeTruthy();
    await asUser(userB);
    expect((await db.query('select * from public.monitored_portfolios')).rows).toEqual([]);
    await expect(add([ids[500]])).rejects.toThrow(/portfolio not found/);
  }, 15000);

it.each(['free', 'pro', 'company'])('preserves the 1-day reminder and filters saved offsets for %s', async plan => {
  await assign(plan, plan === 'company' ? 'admin' : 'signup');
  const portfolio = await createPortfolio();
  const policy = (await db.query('select alert_policy_id from public.monitored_portfolios where id=$1', [portfolio])).rows[0].alert_policy_id;
  await db.query('update public.tenure_alert_policies set expiry_offsets=$1 where id=$2',
    [[365, 180, 120, 90, 60, 30, 14, 7, 3, 1], policy]);
  const offsets = (await db.query('select expiry_offsets from public.tenure_alert_policies where id=$1', [policy])).rows[0].expiry_offsets;
  expect(offsets).toEqual(entitlementsFor(plan).alert_offsets_days);
  expect(offsets).toContain(1);
});
