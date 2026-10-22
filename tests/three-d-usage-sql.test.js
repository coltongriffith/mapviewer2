// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// admin_get_three_d_usage (the admin "3D & sharing" tab, src/components/admin/ThreeDTab.jsx) in an isolated
// PostgreSQL engine: admin only, your own and automated tabs left out as on the Overview, the tables counted for
// history before the events, and the 2D and 3D shared maps side by side. Applied twice: the migration is idempotent.
let db;
const start = '2026-10-01T07:00:00Z', end = '2026-10-04T07:00:00Z', tz = 'Etc/GMT+7';
const ADMIN = '00000000-0000-4000-8000-0000000000ad';
const ANA = '00000000-0000-4000-8000-00000000000a';
const BEN = '00000000-0000-4000-8000-00000000000b';
const P1 = '10000000-0000-4000-8000-000000000001', P2 = '10000000-0000-4000-8000-000000000002';
const P3 = '10000000-0000-4000-8000-000000000003', P4 = '10000000-0000-4000-8000-000000000004';
const S1 = 'a'.repeat(32), S2 = 'b'.repeat(32), S3 = 'c'.repeat(32), S4 = 'd'.repeat(32);
const M1 = 'e'.repeat(32), M2 = 'f'.repeat(32), M3 = '1'.repeat(32);

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, created_at timestamptz, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.admin_users (user_id uuid primary key);
    -- The canonical is_admin() (20260710000005_admin_authorization.sql).
    create function public.is_admin() returns boolean language sql security definer set search_path = public, pg_temp stable
      as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;
    create table public.page_views (session_id text, user_id uuid, path text, referrer text, utm_source text, utm_medium text,
      device text, city text, country text, created_at timestamptz);
    create table public.product_events (session_id text, user_id uuid, event text, props jsonb, created_at timestamptz);
    create table public.live_pings (session_id text, created_at timestamptz);
    create table public.landing_clicks (session_id text, element text, created_at timestamptz);
    create table public.search_events (session_id text, user_id uuid, kind text, province text, result_count integer,
      outcome text, query_text text, created_at timestamptz);
    create table public.error_events (session_id text, user_id uuid, message text, path text, fingerprint text, kind text, source text, seen_count integer, occurred_at timestamptz);
    create table public.feedback (id serial, status text, created_at timestamptz);
    create table public.export_events (session_id text);
    create table public.shared_maps (id text primary key, state jsonb, user_id uuid, creator_key text, created_at timestamptz,
      expires_at timestamptz, revoked_at timestamptz, view_count integer default 0, last_viewed_at timestamptz);
    create table public.three_d_projects (id uuid primary key, user_id uuid not null, name text, settings jsonb default '{}',
      created_at timestamptz, updated_at timestamptz, deleted_at timestamptz);
    create table public.three_d_shares (id text primary key, state jsonb, user_id uuid, creator_key text, project_id uuid,
      created_at timestamptz, updated_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
      view_count integer not null default 0, last_viewed_at timestamptz);
    create table public.figure_versions (figure_kind text, figure_id uuid, published_by uuid, created_at timestamptz);
    -- As on Supabase: new functions are executable by the API roles unless a migration revokes it.
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  // Oldest to newest; the last one to define a function is the one in effect.
  for (const file of ['20261019120000_admin_crawler_sessions.sql', '20261030100000_admin_three_d_usage.sql']) {
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
    await db.exec(sql);
    await db.exec(sql);
  }
}, 30000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users, public.admin_users, public.page_views, public.product_events, public.live_pings,
    public.shared_maps, public.three_d_projects, public.three_d_shares, public.figure_versions;`);
  await db.query(`insert into auth.users (id, email) values ($1, 'me@example.com'), ($2, 'ana@example.com'), ($3, 'ben@example.com')`, [ADMIN, ANA, BEN]);
  await db.query('insert into public.admin_users values ($1)', [ADMIN]);
});

async function as(uid, role, q, params) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.exec(`set role ${role}`);
  try { return await db.query(q, params); } finally { await db.exec('reset role'); }
}
const usage = async (uid = ADMIN, role = 'authenticated') =>
  (await as(uid, role, 'select public.admin_get_three_d_usage($1, $2, $3) as d', [start, end, tz])).rows[0].d;
const view = (sid, path, at, extra = {}) => db.query(
  'insert into public.page_views (session_id, path, referrer, city, country, user_id, created_at) values ($1,$2,$3,$4,$5,$6,$7)',
  [sid, path, extra.referrer ?? 'https://www.google.com/', extra.city || 'Vancouver', extra.country || 'CA', extra.user || null, at]);
const event = (sid, ev, at, props = null, user = null) => db.query(
  'insert into public.product_events (session_id, user_id, event, props, created_at) values ($1,$2,$3,$4,$5)', [sid, user, ev, props, at]);
const project = (id, user, created, updated, deleted = null) => db.query(
  'insert into public.three_d_projects (id, user_id, name, created_at, updated_at, deleted_at) values ($1,$2,$3,$4,$5,$6)',
  [id, user, `Figure ${id.slice(-1)}`, created, updated, deleted]);
const share3d = (id, user, created, views, extra = {}) => db.query(
  `insert into public.three_d_shares (id, state, user_id, project_id, created_at, view_count, last_viewed_at, revoked_at)
   values ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [id, { v: 1, settings: { title: extra.title || `3D ${id[0]}` }, files: [] }, user, extra.project || null, created, views, extra.lastViewed || null, extra.revoked || null]);
const share2d = (id, user, created, views, extra = {}) => db.query(
  `insert into public.shared_maps (id, state, user_id, creator_key, created_at, view_count, last_viewed_at)
   values ($1, $2, $3, $4, $5, $6, $7)`,
  [id, { layout: { title: extra.title || `Map ${id[0]}` }, layers: [] }, user, extra.key || null, created, views, extra.lastViewed || null]);

describe('admin_get_three_d_usage access', () => {
  it('answers an admin and refuses everyone else', async () => {
    const d = await usage();
    expect(d.totals).toMatchObject({ opens: 0, active_users: 0, exports: 0, shares_created: 0 });
    expect(d.daily.map((r) => String(r.d).slice(0, 10))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(d.shared_maps.daily).toHaveLength(3);
    expect(d.top_projects).toEqual([]);
    expect(d.shared_maps.top).toEqual([]);
    expect(d.tracking_since).toBeNull();
    await expect(usage(ANA)).rejects.toThrow(/forbidden/);
    await expect(usage(null, 'anon')).rejects.toThrow(/permission denied/);
  });

  it('is security definer with a pinned search path and no execute for public or anon', async () => {
    const { rows } = await db.query(`select p.prosecdef, p.proconfig,
        has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p where p.proname = 'admin_get_three_d_usage'`);
    expect(rows).toEqual([{ prosecdef: true, proconfig: ['search_path=""'], anon: false, auth: true }]);
  });
});

describe('admin_get_three_d_usage report', () => {
  beforeEach(async () => {
    // A real visitor, signed in: opened /3d, added collars and terrain, exported, saved and shared.
    await view('r1', '/3d', '2026-10-02T15:00:00Z', { user: ANA });
    await event('r1', 'three_d_opened', '2026-10-02T15:00:02Z', { entry: 'new' }, ANA);
    await event('r1', 'three_d_data_added', '2026-10-02T15:01:00Z', { kind: 'collar', source: 'file' }, ANA);
    await event('r1', 'three_d_data_added', '2026-10-02T15:02:00Z', { kind: 'terrain' }, ANA);
    await event('r1', 'three_d_export_completed', '2026-10-02T15:03:00Z', { kind: 'png' }, ANA);
    await event('r1', 'three_d_export_completed', '2026-10-02T15:04:00Z', { kind: 'png' }, ANA);
    await event('r1', 'three_d_export_completed', '2026-10-02T15:05:00Z', { kind: 'layers' }, ANA);
    await event('r1', 'three_d_project_saved', '2026-10-02T15:06:00Z', { project: P1, created: true }, ANA);
    await event('r1', 'three_d_share_created', '2026-10-02T15:07:00Z', { signed_in: true }, ANA);
    // Signed out: the page view alone (a blocked event) still counts as an open; a section export.
    await view('r2', '/3d/', '2026-10-03T16:00:00Z');
    await event('r2', 'three_d_export_completed', '2026-10-03T16:05:00Z', { kind: 'section' });
    // Two people viewed a shared 3D figure; one saved a copy. One viewed a 2D shared map.
    await view('v1', `/3d/share/${S1}`, '2026-10-02T17:00:00Z', { referrer: 'https://www.linkedin.com/' });
    await event('v1', 'three_d_share_viewed', '2026-10-02T17:00:03Z', { embed: false });
    await event('v2', 'three_d_share_viewed', '2026-10-03T17:00:03Z', { embed: true });
    await event('v2', 'three_d_share_forked', '2026-10-03T17:02:00Z', null, BEN);
    await view('m1', `/map/${M1}`, '2026-10-02T18:00:00Z');
    await event('m1', 'share_viewed', '2026-10-02T18:00:02Z', { mapId: M1 });
    // Left out: you (admin account, marked tab), a data-centre town, a tab from the hosting dashboard, outside the window.
    await event('me', 'three_d_opened', '2026-10-02T19:00:00Z', null, ADMIN);
    await event('me', 'three_d_export_completed', '2026-10-02T19:01:00Z', { kind: 'png' }, ADMIN);
    await event('int', 'internal_session', '2026-10-02T19:10:00Z');
    await event('int', 'three_d_opened', '2026-10-02T19:10:01Z');
    await view('dc', '/3d', '2026-10-02T20:00:00Z', { city: 'Ashburn' });
    await event('dc', 'three_d_opened', '2026-10-02T20:00:02Z');
    await view('dev', '/3d', '2026-10-02T21:00:00Z', { referrer: 'vercel.com' });
    await event('dev', 'three_d_opened', '2026-10-02T21:00:02Z');
    await event('old', 'three_d_opened', '2026-09-25T15:00:00Z');
    await event('old', 'three_d_export_completed', '2026-09-25T15:01:00Z', { kind: 'png' });

    // Tables: history before the events, and the counts the events cannot give.
    await project(P1, ANA, '2026-10-02T15:06:00Z', '2026-10-02T16:00:00Z');
    await project(P2, BEN, '2026-09-01T15:00:00Z', '2026-10-03T15:00:00Z');
    await project(P3, ADMIN, '2026-10-02T15:00:00Z', '2026-10-02T15:30:00Z');
    await project(P4, BEN, '2026-10-01T15:00:00Z', '2026-10-03T14:00:00Z', '2026-10-03T14:00:00Z'); // deleted
    await share3d(S1, ANA, '2026-10-02T15:07:00Z', 5, { project: P1, lastViewed: '2026-10-03T17:00:00Z', title: 'RAILS ZONE' });
    await share3d(S2, null, '2026-10-03T12:00:00Z', 1, { lastViewed: '2026-10-03T13:00:00Z' });
    await share3d(S3, ADMIN, '2026-10-02T12:00:00Z', 100, { lastViewed: '2026-10-02T13:00:00Z' });
    await share3d(S4, BEN, '2026-09-01T12:00:00Z', 50, { lastViewed: '2026-10-02T13:00:00Z', revoked: '2026-10-02T14:00:00Z' });
    await share2d(M1, BEN, '2026-10-01T12:00:00Z', 7, { lastViewed: '2026-10-02T18:00:00Z', title: 'Copper claims' });
    await share2d(M2, null, '2026-10-02T12:00:00Z', 0, { key: 'ab'.repeat(24) });
    await share2d(M3, ADMIN, '2026-10-02T12:00:00Z', 40);
    await db.query(`insert into public.figure_versions values ('figure', $1, $2, '2026-10-02T16:30:00Z'), ('figure', $3, $4, '2026-10-02T16:30:00Z'),
      ('map', $1, $2, '2026-10-02T16:30:00Z')`, [P1, ANA, P3, ADMIN]);
  });

  it('counts real 3D use and leaves out you, bots and the dashboards', async () => {
    const d = await usage();
    expect(d.totals).toEqual({
      opens: 2, active_users: 2, data_sessions: 1, exports: 4, export_sessions: 2,
      projects_created: 2, projects_updated: 2, projects_deleted: 1, saves: 1, versions: 1,
      shares_created: 2, share_views: 2, share_forks: 1,
    });
    expect(d.tracking_since).toBeTruthy();
    expect(d.daily.map((r) => [r.opens, r.active_users, r.exports, r.projects_created, r.projects_updated]))
      .toEqual([[0, 1, 0, 1, 0], [1, 1, 3, 1, 1], [1, 1, 1, 0, 1]]);
    expect(d.exports_by_kind).toEqual([
      { kind: 'png', n: 2, sessions: 1 }, { kind: 'layers', n: 1, sessions: 1 }, { kind: 'section', n: 1, sessions: 1 },
    ]);
    expect(d.data_by_kind).toEqual([{ kind: 'collar', sessions: 1 }, { kind: 'terrain', sessions: 1 }]);
  });

  it('ranks projects by activity and names their owners', async () => {
    const d = await usage();
    expect(d.top_projects.map((p) => p.id)).toEqual([P1, P2, P4]);
    expect(d.top_projects[0]).toMatchObject({ owner_email: 'ana@example.com', saves: 1, shares: 1, versions: 1, share_views: 5, activity: 3, deleted: false });
    expect(d.top_projects[2]).toMatchObject({ owner_email: 'ben@example.com', deleted: true });
  });

  it('gives one account\'s 3D use to the Users tab, and only to an admin', async () => {
    const one = async (uid) => (await as(uid, 'authenticated', 'select public.admin_get_user_three_d($1) as d', [BEN])).rows[0].d;
    const d = await one(ADMIN);
    expect(d).toMatchObject({ project_count: 1, shares: 0, share_views: 50, versions: 0, exports: 0 });
    expect(d.projects.map((p) => [p.id, p.deleted])).toEqual([[P2, false], [P4, true]]);
    expect(d.last_active).toBeTruthy(); // the fork event
    await expect(one(ANA)).rejects.toThrow(/forbidden/);
    await expect(as(null, 'anon', 'select public.admin_get_user_three_d($1)', [BEN])).rejects.toThrow(/permission denied/);
  });

  it('puts 2D and 3D shared maps side by side', async () => {
    const d = await usage();
    expect(d.shared_maps.totals).toEqual({
      created_2d: 2, created_2d_agent: 1, created_3d: 2, viewed_2d: 1, viewed_3d: 2,
      live_2d: 2, live_3d: 2, lifetime_views_2d: 7, lifetime_views_3d: 56,
    });
    expect(d.shared_maps.daily.map((r) => [r.created_2d, r.created_3d, r.viewed_2d, r.viewed_3d]))
      .toEqual([[1, 0, 0, 0], [1, 1, 1, 1], [0, 1, 0, 1]]);
    expect(d.shared_maps.top.map((s) => [s.kind, s.path, s.views])).toEqual([
      ['map', `/map/${M1}`, 7], ['figure', `/3d/share/${S1}`, 5], ['figure', `/3d/share/${S2}`, 1], ['map', `/map/${M2}`, 0],
    ]);
    expect(d.shared_maps.top[0]).toMatchObject({ title: 'Copper claims', owner_email: 'ben@example.com' });
    expect(d.shared_maps.top[1]).toMatchObject({ title: 'RAILS ZONE', owner_email: 'ana@example.com' });
    expect(d.shared_maps.top[3]).toMatchObject({ owner_email: null, agent: true });
  });
});
