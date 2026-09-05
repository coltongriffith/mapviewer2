// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Run the actual migration in an isolated PostgreSQL engine. No production
// credentials, remote database writes, or duplicate JS metrics implementation.
let db;
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const start = '2026-09-01T07:00:00Z', end = '2026-10-01T07:00:00Z';
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
    create table public.admin_users (user_id uuid);
    create table public.product_events (id uuid default gen_random_uuid(), session_id text, user_id uuid, event text, props jsonb, created_at timestamptz);
    create table public.page_views (session_id text, user_id uuid, created_at timestamptz, utm_source text, utm_medium text, referrer text, device text, city text, country text);
    create table public.export_events (session_id text, user_id uuid, created_at timestamptz);
    create table public.search_events (session_id text, user_id uuid, created_at timestamptz);
    create table public.leads (session_id text, email text, captured_at timestamptz);
    create table public.user_plans (user_id uuid, plan text default 'free', source text default 'signup', status text default 'active', billing_interval text, current_period_end timestamptz, pro_since timestamptz, updated_at timestamptz, stripe_customer_id text);
    create table public.custom_invoices (stripe_invoice_id text, user_id uuid, status text, amount_due integer, amount_paid integer, amount_refunded integer, currency text, created_at timestamptz);
    create function public.is_admin() returns boolean language sql as $$ select current_setting('test.admin', true) = 'yes' $$;
    create function public.em_is_active_event(e text) returns boolean language sql immutable as $$ select e in ('editor_opened','project_saved','signup_completed','export_completed') $$;
    create function public.admin_session_ids(p_start timestamptz, p_end timestamptz) returns table(session_id text) language sql as $$
      select e.session_id from public.product_events e join public.admin_users a on a.user_id = e.user_id where e.created_at >= p_start and e.created_at < p_end
      union select e.session_id from public.page_views e join public.admin_users a on a.user_id = e.user_id where e.created_at >= p_start and e.created_at < p_end
    $$;
    -- Match this project's bootstrap defaults: revoking PUBLIC alone is not enough.
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  await db.exec(readFileSync('supabase/migrations/20260905053221_growth_dashboard_performance.sql', 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("reset role; set test.admin = 'yes'; truncate auth.users, public.admin_users, public.product_events, public.page_views, public.export_events, public.search_events, public.leads, public.user_plans, public.custom_invoices;");
});
const report = async () => (await db.query('select public.admin_get_growth($1, $2) as d', [start,end])).rows[0].d;
const user = async (n, joined = '2026-09-06T12:00Z', plan = 'free', source = 'signup', status = 'active', interval = null) => {
  await db.query('insert into auth.users values ($1,$2,$3,$4)', [uid(n), `test${n}@example.test`, joined, { em_acquisition: { utm_source: 'founder', utm_medium: 'outreach' } }]);
  await db.query('insert into public.user_plans (user_id,plan,source,status,billing_interval) values ($1,$2,$3,$4,$5)', [uid(n),plan,source,status,interval]);
};
const event = (sid, event, at, props = {}, n = null) => db.query('insert into public.product_events (session_id,event,created_at,props,user_id) values ($1,$2,$3,$4,$5)', [sid,event,at,props,n == null ? null : uid(n)]);

describe('growth report SQL', () => {
  it('runs with no activity and preserves empty cohorts', async () => {
    const d = await report();
    expect(d.funnel).toEqual({ sessions: 0, opened: 0, imported: 0, exported: 0, real_exported: 0 });
    expect(d.sources).toEqual([]);
    expect(d.cohort.activation_eligible).toBe(0);
  });
  it('enforces event order, half-open windows, admin exclusion and duplicate export suppression', async () => {
    await user(99);
    await db.query('insert into public.admin_users values ($1)', [uid(99)]);
    for (const sid of ['good','backwards','admin']) {
      await event(sid, 'editor_opened', '2026-09-06T12:00Z');
      await event(sid, 'registry_claims_imported', '2026-09-06T12:02Z', {}, sid === 'admin' ? 99 : null);
      await event(sid, 'export_completed', sid === 'backwards' ? '2026-09-06T12:01Z' : '2026-09-06T12:03Z', { real_data: true });
    }
    await db.query("insert into public.export_events values ('good',null,'2026-09-06T12:03:01Z')");
    await event('after', 'editor_opened', end);
    await event('unknown', 'export_completed', '2026-09-07T12:00Z');
    const d = await report();
    expect(d.funnel).toEqual({ sessions: 3, opened: 2, imported: 2, exported: 1, real_exported: 1 });
    expect(d.exports).toEqual({ total: 3, real: 2, unclassified: 1, other: 0 });
  });
  it('excludes young cohorts and activity after the reporting cutoff', async () => {
    await user(1); // mature, real-data export + week-two return
    await user(2, '2026-09-26T12:00Z'); // pending
    await user(3); // action outside the 7–13 day return interval
    await user(4, '2026-09-02T12:00Z'); // predates real_data instrumentation
    await event('one', 'export_completed', '2026-09-07T12:00Z', { real_data: true }, 1);
    await event('one', 'project_saved', '2026-09-14T12:00Z', {}, 1);
    await event('three', 'project_saved', '2026-09-21T12:00Z', {}, 3);
    await event('two', 'export_completed', '2026-10-02T12:00Z', { real_data: true }, 2);
    const d = await report();
    expect(d.cohort).toMatchObject({ signups: 4, activated: 1, activation_eligible: 2, activation_pending: 1, activation_untracked: 1, return_eligible: 3, returned: 1, return_pending: 1 });
    expect(d.signup_sources).toEqual([{ source: 'founder / outreach', signups: 4, current_subscribers: 0 }]);
  });
  it('counts active subscriptions and estimates only known intervals; excludes trials, comps and admins', async () => {
    await user(1, undefined, 'pro','stripe','active','month');
    await user(2, undefined, 'pro','stripe','active','year');
    await user(3, undefined, 'pro','stripe','trialing','month');
    await user(4, undefined, 'pro','stripe','active',null);
    await user(5, undefined, 'pro','grandfathered','active','month');
    await user(99, undefined, 'pro','stripe','active','month');
    await db.query('insert into public.admin_users values ($1)', [uid(99)]);
    const d = await report();
    expect(d.billing).toMatchObject({ active_subscribers: 3, trials: 1, unknown_interval: 1 });
    expect(d.billing.estimated_mrr_cents).toBeCloseTo(2900 + 29000/12);
    const r = (await db.query('select public.admin_get_billing_metrics() as d')).rows[0].d;
    expect(r.paying_subscribers).toBe(3);
    expect(r.mrr_cents).toBeCloseTo(d.billing.estimated_mrr_cents);
    expect(r.subscribers).toHaveLength(5);
  });
  it('keeps refund currencies separate', async () => {
    await db.exec("insert into public.custom_invoices (currency,amount_refunded) values ('usd',100),('cad',200),('usd',300)");
    const d = (await db.query('select public.admin_get_billing_metrics() as d')).rows[0].d;
    expect(d.refunds_by_currency).toEqual([{ currency: 'CAD', cents: 200 }, { currency: 'USD', cents: 400 }]);
  });
  it('rejects anon and authenticated non-admin calls and permits admin calls', async () => {
    await db.exec("set test.admin = 'no'; set role anon");
    await expect(report()).rejects.toMatchObject({ code: '42501' });
    await db.exec('set role authenticated');
    await expect(report()).rejects.toMatchObject({ code: '42501', message: 'forbidden' });
    await db.exec("set test.admin = 'yes'");
    expect((await report()).funnel.sessions).toBe(0);
  });
  it('rejects unbounded and reversed windows', async () => {
    for (const args of [[null,end], [end,start], ['2020-01-01',end]]) {
      await expect(db.query('select public.admin_get_growth($1,$2)', args)).rejects.toMatchObject({ code: '22023' });
    }
  });
  it('counts day events once and does not extend a session past the selected day', async () => {
    await db.exec("insert into public.page_views (session_id,created_at) values ('one','2026-09-06T07:00Z'),('one','2026-09-06T12:00Z'),('one','2026-09-07T07:00Z')");
    const d = (await db.query('select public.admin_get_day_activity($1,$2) as d', ['2026-09-06T07:00Z','2026-09-07T07:00Z'])).rows[0].d;
    expect(d.summary).toMatchObject({ page_views: 2, sessions: 1 });
    expect(d.sessions[0].page_view_count).toBe(2);
    expect(Date.parse(d.sessions[0].last_seen)).toBe(Date.parse('2026-09-06T12:00Z'));
  });
});
