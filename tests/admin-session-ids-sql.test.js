// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const start = '2026-09-24T00:00:00Z';
const end = '2026-09-25T00:00:00Z';
const t0 = '2026-09-24T10:00:00Z';
const at = (seconds, base = t0) => new Date(Date.parse(base) + seconds * 1000).toISOString();
let db;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.admin_users (user_id uuid);
    create table public.product_events (session_id text, user_id uuid, event text, props jsonb, created_at timestamptz);
    create table public.page_views (session_id text, user_id uuid, created_at timestamptz, utm_source text, referrer text);
    create table public.landing_clicks (session_id text);
    create table public.live_pings (session_id text primary key, created_at timestamptz);
    create table public.search_events (session_id text);
    create table public.export_events (session_id text);
  `);
  const sql = readFileSync('supabase/migrations/20260928181314_exclude_internal_and_automated_sessions.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate public.admin_users, public.product_events, public.page_views, public.landing_clicks, public.live_pings, public.search_events, public.export_events');
});

async function visit(sid, { utm = 'blog', referrer = null, pingAfter = 0, pages = 1,
  events = [['editor_opened'], ['first_map_checklist_shown']], when = t0 } = {}) {
  for (let i = 0; i < pages; i += 1) {
    await db.query('insert into public.page_views values ($1, null, $2, $3, $4)', [sid, at(i * 5, when), utm, referrer]);
  }
  await db.query('insert into public.live_pings values ($1, $2)', [sid, at(pingAfter, when)]);
  for (const [event, props = null] of events) {
    await db.query('insert into public.product_events values ($1, null, $2, $3, $4)', [sid, event, props && JSON.stringify(props), at(1, when)]);
  }
}
const excluded = async () => (await db.query(
  'select session_id from public.admin_session_ids($1, $2) order by 1', [start, end],
)).rows.map((row) => row.session_id);

describe('admin_session_ids', () => {
  it('excludes marked owner tabs and narrow passive CTA automation', async () => {
    await visit('passive-blog');
    await visit('passive-company', { utm: 'companies', events: [['editor_opened'], ['layer_added', { source: 'deeplink' }]] });
    await db.query("insert into public.product_events values ('internal', null, 'internal_session', null, $1)", [t0]);
    expect(await excluded()).toEqual(['internal', 'passive-blog', 'passive-company']);
  });

  it('keeps a CTA visitor who stays or takes an action', async () => {
    await visit('stayed', { pingAfter: 30 });
    await visit('uploaded', { events: [['editor_opened'], ['layer_added', { source: 'upload' }]] });
    await visit('referred', { referrer: 'www.explorationmaps.com' });
    expect(await excluded()).toEqual([]);
  });

  it('still excludes authenticated admins and keeps the helper private', async () => {
    await db.query('insert into public.admin_users values ($1)', [ADMIN]);
    await db.query("insert into public.page_views values ('admin-tab', $1, $2, null, null)", [ADMIN, t0]);
    expect(await excluded()).toEqual(['admin-tab']);
    const anon = (await db.query("select has_function_privilege('anon', 'public.admin_session_ids(timestamptz,timestamptz)', 'execute') ok")).rows[0].ok;
    const service = (await db.query("select has_function_privilege('service_role', 'public.admin_session_ids(timestamptz,timestamptz)', 'execute') ok")).rows[0].ok;
    expect(anon).toBe(false);
    expect(service).toBe(true);
  });
});
