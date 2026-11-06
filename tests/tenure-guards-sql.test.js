// @vitest-environment node
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Tenure state guards (docs/state-machines.md, TEN-5, TEN-8). Same minimal
// fixture as company-tenure-entitlements-sql.test.js, plus the new migration.
let db;
const userA = '10000000-0000-4000-8000-000000000001';
const migration = (name) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');

beforeAll(async () => {
  db = await PGlite.create();
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
    create table public.tenure_import_runs (id uuid primary key default gen_random_uuid(), status text not null
      constraint tenure_import_runs_status_check check (status in ('running', 'succeeded', 'aborted', 'failed')));
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const name of [
    '20260716000001_billing_plans',
    '20260801000002_tenure_portfolios',
    '20260801000003_tenure_quota_and_admin',
    '20260801000007_tenure_add_result_accuracy',
    '20260801000008_tenure_quota_integrity',
    '20260807000001_tenure_final_reminder_and_note_metadata',
    '20261028120000_company_tenure_entitlement',
    '20261106120000_tenure_state_guards',
  ]) await db.exec(migration(name));
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role; set test.uid = ''; truncate auth.users, public.tenures cascade;`);
  await db.query('insert into auth.users (id, email) values ($1, $2)', [userA, 'owner-a@example.test']);
});
const asUser = async () => {
  await db.exec('reset role');
  await db.query("select set_config('test.uid', $1, false)", [userA]);
  await db.exec('set role authenticated');
};

it('TEN-5: a dry run has its own status', async () => {
  await db.exec('reset role');
  await db.query(`insert into public.tenure_import_runs (status) values ('dry_run')`);
  await expect(db.query(`insert into public.tenure_import_runs (status) values ('bogus')`)).rejects.toThrow(/check/);
});

it('TEN-8: a removed tenure cannot be revived with a direct update, past the quota', async () => {
  await db.exec('insert into public.tenures (id) select gen_random_uuid() from generate_series(1, 20)');
  const ids = (await db.query('select id from public.tenures order by id')).rows.map((r) => r.id);
  await asUser();
  const portfolio = (await db.query("select public.create_monitored_portfolio('Test') as id")).rows[0].id;
  await db.query('select public.add_portfolio_tenures($1, $2::uuid[])', [portfolio, ids.slice(0, 10)]);
  for (const t of ids.slice(0, 10)) await db.query('select public.remove_portfolio_tenure($1, $2)', [portfolio, t]);
  await db.query('select public.add_portfolio_tenures($1, $2::uuid[])', [portfolio, ids.slice(10, 20)]);
  await expect(db.query('update public.monitored_portfolio_tenures set removed_at = null where portfolio_id = $1', [portfolio]))
    .rejects.toThrow(/permission denied/);
  await expect(db.query('update public.monitored_portfolio_tenures set tenure_id = $2 where portfolio_id = $1', [portfolio, ids[0]]))
    .rejects.toThrow(/permission denied/);
  // The columns the app edits still update.
  const edited = await db.query(`update public.monitored_portfolio_tenures set internal_notes = 'ok', monitoring_enabled = false
    where portfolio_id = $1 and removed_at is null`, [portfolio]);
  expect(edited.affectedRows).toBe(10);
  const live = (await db.query('select count(*)::int as n from public.monitored_portfolio_tenures where portfolio_id = $1 and removed_at is null', [portfolio])).rows[0].n;
  expect(live).toBe(10);
});

it('TEN-8: recipient updates are validated and cannot move past a policy limit', async () => {
  await asUser();
  const portfolio = (await db.query("select public.create_monitored_portfolio('Test') as id")).rows[0].id;
  const policy = (await db.query('select alert_policy_id from public.monitored_portfolios where id=$1', [portfolio])).rows[0].alert_policy_id;
  const recipients = (await db.query('select id from public.tenure_alert_recipients where policy_id = $1', [policy])).rows;
  expect(recipients.length).toBe(1); // the owner, at the free limit of 1
  await expect(db.query(`update public.tenure_alert_recipients set email = 'a@x.com, b@y.com' where id = $1`, [recipients[0].id]))
    .rejects.toThrow(/invalid recipient email/);
  // Renaming within the same policy is not a new recipient.
  await db.query(`update public.tenure_alert_recipients set email = ' New@Example.test ' where id = $1`, [recipients[0].id]);
  expect((await db.query('select email from public.tenure_alert_recipients where id = $1', [recipients[0].id])).rows[0].email).toBe('new@example.test');
});
