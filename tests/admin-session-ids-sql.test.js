// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// admin_session_ids() is the exclusion list behind every admin report. Run the
// migration in an isolated engine and check what it leaves out — admin
// accounts, tabs marked internal, and crawlers that open a CTA link and do
// nothing else — and that a person who arrived the same way and did anything
// is still counted.
const file = readdirSync('supabase/migrations').find((f) => f.endsWith('_exclude_internal_and_automated_sessions.sql'));
const ADMIN = '00000000-0000-4000-8000-000000000001';
const start = '2026-09-24T00:00:00Z', end = '2026-09-25T00:00:00Z';
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
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
  await db.exec(sql);
  await db.exec(sql); // idempotent
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate public.admin_users, public.product_events, public.page_views, public.landing_clicks, public.live_pings, public.search_events, public.export_events');
});

// One tab that lands on a CTA link, opens the editor and fires its load-time
// events: exactly what the crawlers left behind.
async function visit(sid, { utm = 'blog', referrer = null, pingAfter = 0, pages = 1, events = [['editor_opened'], ['first_map_checklist_shown']], when = t0 } = {}) {
  for (let i = 0; i < pages; i++) {
    await db.query('insert into public.page_views values ($1, null, $2, $3, $4)', [sid, at(i * 5, when), utm, referrer]);
  }
  await db.query('insert into public.live_pings values ($1, $2)', [sid, at(pingAfter, when)]);
  for (const [event, props = null] of events) {
    await db.query('insert into public.product_events values ($1, null, $2, $3, $4)', [sid, event, props && JSON.stringify(props), at(1, when)]);
  }
}
const excluded = async () => (await db.query('select session_id from public.admin_session_ids($1, $2) order by 1', [start, end])).rows.map((r) => r.session_id);

describe('admin_session_ids', () => {
  it('excludes CTA crawlers, including company links that preload claims', async () => {
    await visit('bot-blog');
    await visit('bot-slash', { utm: 'blog/' });
    await visit('bot-company', { utm: 'companies', events: [['editor_opened'], ['layer_added', { source: 'deeplink' }], ['first_layer_added']] });
    expect(await excluded()).toEqual(['bot-blog', 'bot-company', 'bot-slash']);
  });

  it('keeps anyone who arrived on a CTA link and did something', async () => {
    await visit('referred', { referrer: 'www.explorationmaps.com' });
    await visit('stayed', { pingAfter: 30 });
    await visit('two-pages', { pages: 2 });
    await visit('imported', { events: [['editor_opened'], ['registry_claims_imported']] });
    await visit('uploaded', { events: [['editor_opened'], ['layer_added', { source: 'upload' }]] });
    await visit('unknown-layer', { events: [['editor_opened'], ['layer_added', {}]] });
    await visit('clicked'); await db.query("insert into public.landing_clicks values ('clicked')");
    await visit('searched'); await db.query("insert into public.search_events values ('searched')");
    await visit('exported'); await db.query("insert into public.export_events values ('exported')");
    await visit('direct-home', { utm: null });
    expect(await excluded()).toEqual([]);
  });

  it('only classifies tabs that start inside the window', async () => {
    await visit('bot-before', { when: '2026-09-23T10:00:00Z' });
    expect(await excluded()).toEqual([]);
  });

  it('still excludes admin accounts', async () => {
    await db.query('insert into public.admin_users values ($1)', [ADMIN]);
    await db.query("insert into public.page_views values ('admin-tab', $1, $2, null, null)", [ADMIN, t0]);
    expect(await excluded()).toEqual(['admin-tab']);
  });

  it('excludes internal tabs whose marker was sent up to a day before the window', async () => {
    const mark = (sid, ts) => db.query("insert into public.product_events values ($1, null, 'internal_session', null, $2)", [sid, ts]);
    await mark('internal-inside', t0);
    await mark('internal-overnight', '2026-09-23T12:00:00Z');
    await mark('internal-stale', '2026-09-22T12:00:00Z');
    await mark('internal-after', '2026-09-25T01:00:00Z');
    expect(await excluded()).toEqual(['internal-inside', 'internal-overnight']);
  });

  it('stays callable only by the service role', async () => {
    const can = async (role) => (await db.query("select has_function_privilege($1, 'public.admin_session_ids(timestamptz,timestamptz)', 'execute') as ok", [role])).rows[0].ok;
    expect(await can('anon')).toBe(false);
    expect(await can('authenticated')).toBe(false);
    expect(await can('service_role')).toBe(true);
  });
});
