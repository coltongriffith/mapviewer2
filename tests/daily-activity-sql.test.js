// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Run the daily-activity migration in an isolated PostgreSQL engine and check
// the series the Growth landing tab charts (src/components/admin/GrowthTab.jsx):
// one zero-filled row per Pacific day, distinct visitor tabs, signed-in users,
// signups, with admin activity excluded.
let db;
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const start = '2026-09-01T07:00:00Z', end = '2026-09-04T07:00:00Z', tz = 'Etc/GMT+7';

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, created_at timestamptz);
    create table public.admin_users (user_id uuid);
    create table public.product_events (session_id text, user_id uuid, event text, props jsonb, created_at timestamptz);
    create table public.page_views (session_id text, user_id uuid, created_at timestamptz);
    create function public.is_admin() returns boolean language sql as $$ select current_setting('test.admin', true) = 'yes' $$;
    create function public.em_is_active_event(e text) returns boolean language sql immutable as $$ select e in ('editor_opened','project_saved','export_completed') $$;
    create function public.admin_session_ids(p_start timestamptz, p_end timestamptz) returns table(session_id text) language sql as $$
      select e.session_id from public.product_events e join public.admin_users a on a.user_id = e.user_id where e.created_at >= p_start and e.created_at < p_end
      union select e.session_id from public.page_views e join public.admin_users a on a.user_id = e.user_id where e.created_at >= p_start and e.created_at < p_end
    $$;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  const sql = readFileSync('supabase/migrations/20260910000002_admin_daily_activity.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql); // idempotent
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("reset role; set test.admin = 'yes'; truncate auth.users, public.admin_users, public.product_events, public.page_views;");
});

const series = async () => (await db.query('select public.admin_get_daily_activity($1, $2, $3) as d', [start, end, tz])).rows[0].d;
const view = (sid, at, n = null) => db.query('insert into public.page_views values ($1,$2,$3)', [sid, n == null ? null : uid(n), at]);
const event = (sid, ev, at, n = null) => db.query('insert into public.product_events (session_id,user_id,event,created_at) values ($1,$2,$3,$4)', [sid, n == null ? null : uid(n), ev, at]);

describe('daily activity SQL', () => {
  it('zero-fills every Pacific day in the half-open window', async () => {
    const d = await series();
    expect(d.map(r => String(r.d).slice(0, 10))).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(d.every(r => r.sessions === 0 && r.page_views === 0 && r.active_users === 0 && r.signups === 0)).toBe(true);
  });

  it('counts distinct visitor tabs separately from page views, and excludes admins', async () => {
    await db.query('insert into auth.users values ($1,$2,$3)', [uid(99), 'admin@example.test', '2026-08-01T00:00Z']);
    await db.query('insert into public.admin_users values ($1)', [uid(99)]);
    // Sept 2 Pacific: tab A views three pages, tab B one page, admin tab C two.
    await view('A', '2026-09-02T15:00:00Z');
    await view('A', '2026-09-02T15:01:00Z');
    await view('A', '2026-09-02T15:02:00Z');
    await view('B', '2026-09-02T20:00:00Z');
    await view('C', '2026-09-02T16:00:00Z', 99);
    await view('C', '2026-09-02T16:01:00Z');
    // A view at 06:59Z on Sept 3 is still Sept 2 in UTC-7.
    await view('D', '2026-09-03T06:59:00Z');
    const d = await series();
    expect(d[1]).toMatchObject({ sessions: 3, page_views: 5, active_users: 0, signups: 0 });
    expect(d[2]).toMatchObject({ sessions: 0, page_views: 0 });
  });

  it('counts signed-in users only on active events, once per day, admins excluded', async () => {
    await db.query('insert into auth.users values ($1,$2,$3),($4,$5,$6)', [uid(1), 'a@example.test', '2026-08-01T00:00Z', uid(99), 'admin@example.test', '2026-08-01T00:00Z']);
    await db.query('insert into public.admin_users values ($1)', [uid(99)]);
    await event('s1', 'editor_opened', '2026-09-01T15:00:00Z', 1);
    await event('s1', 'project_saved', '2026-09-01T15:30:00Z', 1);
    await event('s1', 'pro_gate_shown', '2026-09-03T15:00:00Z', 1); // not an active event
    await event('s9', 'editor_opened', '2026-09-01T15:00:00Z', 99);
    const d = await series();
    expect(d.map(r => r.active_users)).toEqual([1, 0, 0]);
  });

  it('counts non-admin signups by Pacific day', async () => {
    await db.query('insert into auth.users values ($1,$2,$3),($4,$5,$6),($7,$8,$9)', [
      uid(1), 'a@example.test', '2026-09-03T06:30:00Z', // Sept 2 Pacific
      uid(2), 'b@example.test', '2026-09-03T12:00:00Z',
      uid(99), 'admin@example.test', '2026-09-03T12:00:00Z',
    ]);
    await db.query('insert into public.admin_users values ($1)', [uid(99)]);
    const d = await series();
    expect(d.map(r => r.signups)).toEqual([0, 1, 1]);
  });

  it('refuses non-admins and is never granted to anon', async () => {
    await db.exec("set test.admin = 'no'");
    await expect(series()).rejects.toThrow(/forbidden/);
    const ok = (await db.query("select has_function_privilege('anon', 'public.admin_get_daily_activity(timestamptz, timestamptz, text)', 'EXECUTE') as ok")).rows[0].ok;
    expect(ok).toBe(false);
  });
});
