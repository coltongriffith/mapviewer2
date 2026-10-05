// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Run admin_get_summary (the Overview tab, src/components/admin/SummaryTab.jsx)
// in an isolated PostgreSQL engine: real people are counted, you and bots are
// not, and each section has the shape the tab renders.
let db;
const start = '2026-09-01T07:00:00Z', end = '2026-09-04T07:00:00Z', tz = 'Etc/GMT+7';

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, created_at timestamptz, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
    create table public.admin_users (user_id uuid);
    create table public.page_views (session_id text, user_id uuid, path text, referrer text, utm_source text, utm_medium text,
      device text, city text, country text, created_at timestamptz);
    create table public.product_events (session_id text, user_id uuid, event text, props jsonb, created_at timestamptz);
    create table public.live_pings (session_id text, created_at timestamptz);
    create table public.landing_clicks (session_id text, element text, created_at timestamptz);
    create table public.search_events (session_id text, user_id uuid, kind text, province text, result_count integer,
      outcome text, query_text text, created_at timestamptz);
    create table public.error_events (session_id text, user_id uuid, message text, path text, fingerprint text, kind text, source text, seen_count integer, occurred_at timestamptz);
    create table public.feedback (id serial, status text, created_at timestamptz);
    create table public.shared_maps (id text, state jsonb, user_id uuid, creator_key text, created_at timestamptz);
    create function public.is_admin() returns boolean language sql as $$ select current_setting('test.admin', true) = 'yes' $$;
    create function public.admin_session_ids(p_start timestamptz, p_end timestamptz) returns table(session_id text) language sql as $$
      select e.session_id from public.product_events e where e.event = 'internal_session'
    $$;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  // The newest migration that defines the function is the one in effect.
  const sql = readFileSync('supabase/migrations/20261002130000_admin_summary_real_visitors.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql); // idempotent
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role; set test.admin = 'yes'; truncate auth.users, public.admin_users, public.page_views,
    public.product_events, public.live_pings, public.landing_clicks, public.search_events, public.error_events,
    public.feedback, public.shared_maps;`);
});

const summary = async () => (await db.query('select public.admin_get_summary($1, $2, $3) as d', [start, end, tz])).rows[0].d;
const view = (sid, at, extra = {}) => db.query(
  'insert into public.page_views (session_id, path, referrer, city, country, device, user_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)',
  [sid, extra.path || '/', extra.referrer || null, extra.city || 'Vancouver', 'CA', extra.device || 'desktop', extra.user || null, at]);
const event = (sid, ev, at, props = null) => db.query('insert into public.product_events (session_id, event, props, created_at) values ($1,$2,$3,$4)', [sid, ev, props, at]);

describe('admin summary SQL', () => {
  it('returns the empty shape the Overview tab renders', async () => {
    const d = await summary();
    expect(d.totals).toEqual({ people: 0, engaged: 0, bounced: 0, made_map: 0, signups: 0, you: 0, bots: 0 });
    expect(d.daily.map(r => String(r.d).slice(0, 10))).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(d.sources).toEqual([]);
    expect(d.pages).toEqual([]);
    expect(d.usage.steps.map(s => s.key)).toEqual(['visited', 'engaged', 'editor', 'data', 'made', 'signup']);
    expect(d.problems).toMatchObject({ errors: [], failed_searches: [], feedback_open: 0 });
    expect(d.signups).toEqual([]);
    expect(d.recent).toEqual([]);
  });

  it('counts real people and leaves out you and bots', async () => {
    // Engaged: two pages, from Google, then made a map.
    await view('real', '2026-09-02T15:00:00Z', { referrer: 'https://www.google.com/' });
    await view('real', '2026-09-02T15:01:00Z', { path: '/app' });
    await event('real', 'export_completed', '2026-09-02T15:05:00Z');
    // Bounced: one page, sent by LinkedIn.
    await view('quick', '2026-09-02T16:00:00Z', { referrer: 'https://www.linkedin.com/' });
    // Bot: data-centre town; and a no-referrer one-page hit.
    await view('dc', '2026-09-02T17:00:00Z', { city: 'Ashburn' });
    await view('ghost', '2026-09-02T17:30:00Z');
    // You: marked internal session.
    await view('me', '2026-09-02T18:00:00Z');
    await view('me', '2026-09-02T18:01:00Z');
    await event('me', 'internal_session', '2026-09-02T18:00:00Z');

    const d = await summary();
    expect(d.totals).toMatchObject({ people: 2, engaged: 1, bounced: 1, made_map: 1, you: 1, bots: 2 });
    expect(d.sources.map(s => s.channel).sort()).toEqual(['Google', 'LinkedIn']);
    expect(d.recent.map(r => r.session_id)).toEqual(['real']);
    expect(d.daily[1]).toMatchObject({ engaged: 1, bounced: 1 });
  });

  it('does not count the editor loading a demo map as engagement', async () => {
    await view('demo', '2026-09-02T15:00:00Z', { referrer: 'https://www.google.com/', path: '/app' });
    await event('demo', 'editor_opened', '2026-09-02T15:00:01Z');
    await event('demo', 'layer_added', '2026-09-02T15:00:02Z', { source: 'demo' });
    const d = await summary();
    expect(d.totals).toMatchObject({ engaged: 0, bounced: 1 });
  });

  it('lists failed searches and errors people saw', async () => {
    await view('s', '2026-09-02T15:00:00Z', { referrer: 'https://www.bing.com/' });
    await db.query("insert into public.search_events (session_id, kind, province, result_count, outcome, query_text, created_at) values ('s','company','BC',0,'empty','juggernaut exploration','2026-09-02T15:01:00Z')");
    await db.query("insert into public.error_events (session_id, message, path, seen_count, occurred_at) values ('s','Unable to preload CSS','/app',1,'2026-09-02T15:02:00Z')");
    const d = await summary();
    expect(d.problems.failed_searches[0]).toMatchObject({ query: 'juggernaut exploration', province: 'BC' });
    expect(d.problems.errors[0]).toMatchObject({ message: 'Unable to preload CSS', people: 1 });
  });

  it('lists only errors and failed searches from real visitors', async () => {
    const error = (sid, at, seen = 1) => db.query("insert into public.error_events (session_id, message, path, seen_count, occurred_at) values ($1,'Map failed to load','/app',$2,$3)", [sid, seen, at]);
    const failedSearch = (sid, q) => db.query("insert into public.search_events (session_id, kind, province, result_count, outcome, query_text, created_at) values ($1,'company','BC',0,'empty',$2,'2026-09-02T16:01:00Z')", [sid, q]);
    // Two real visitors saw the error (one of them twice).
    await view('a', '2026-09-02T15:00:00Z', { referrer: 'https://www.google.com/' });
    await view('b', '2026-09-02T15:10:00Z', { referrer: 'https://www.bing.com/' });
    await error('a', '2026-09-02T15:01:00Z', 2);
    await error('b', '2026-09-02T15:11:00Z');
    // A data-centre bot and your own session hit errors and failed searches too.
    await view('dc', '2026-09-02T16:00:00Z', { city: 'Ashburn' });
    await error('dc', '2026-09-02T16:01:00Z', 40);
    await failedSearch('dc', 'bot query');
    await view('me', '2026-09-02T17:00:00Z');
    await event('me', 'internal_session', '2026-09-02T17:00:00Z');
    await db.query("insert into public.error_events (session_id, message, path, seen_count, occurred_at) values ('me','Only you saw this','/admin',1,'2026-09-02T17:01:00Z')");
    await failedSearch('me', 'my test query');
    await failedSearch('a', 'juggernaut exploration');

    const d = await summary();
    expect(d.problems.errors).toEqual([expect.objectContaining({ message: 'Map failed to load', people: 2, times: 3 })]);
    expect(d.problems.failed_searches.map((f) => f.query)).toEqual(['juggernaut exploration']);
  });

  it('lists problems from a real tab opened before the range, without counting the tab in it', async () => {
    // The tab records its one page view the evening before; its heartbeat and
    // error fall inside the range.
    await view('early', '2026-08-31T23:30:00Z', { referrer: 'https://www.google.com/' });
    await db.query("insert into public.live_pings values ('early', '2026-09-01T08:00:00Z')");
    await db.query("insert into public.error_events (session_id, message, path, seen_count, occurred_at) values ('early','Map failed to load','/app',1,'2026-09-01T08:01:00Z')");
    await db.query("insert into public.search_events (session_id, kind, province, result_count, outcome, query_text, created_at) values ('early','company','BC',0,'empty','late night search','2026-09-01T08:02:00Z')");
    // A data-centre tab from before the range stays out.
    await view('dc-early', '2026-08-31T23:00:00Z', { city: 'Ashburn' });
    await db.query("insert into public.error_events (session_id, message, path, seen_count, occurred_at) values ('dc-early','Bot error','/app',9,'2026-09-01T09:00:00Z')");

    const d = await summary();
    expect(d.problems.errors).toEqual([expect.objectContaining({ message: 'Map failed to load', people: 1 })]);
    expect(d.problems.failed_searches.map((f) => f.query)).toEqual(['late night search']);
    expect(d.totals).toMatchObject({ people: 0, bots: 0 });
  });

  it('refuses non-admins and is never granted to anon', async () => {
    await db.exec("set test.admin = 'no'");
    await expect(summary()).rejects.toThrow(/forbidden/);
    const ok = (await db.query("select has_function_privilege('anon', 'public.admin_get_summary(timestamptz, timestamptz, text)', 'EXECUTE') as ok")).rows[0].ok;
    expect(ok).toBe(false);
  });
});
