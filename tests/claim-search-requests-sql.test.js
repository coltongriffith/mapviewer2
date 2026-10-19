// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// The "tell us the project" inbox: /api/track writes with the service role,
// only an admin reads or answers, and a repeat ask is one row.
let db;
const sql = readFileSync('supabase/migrations/20261019140000_claim_search_requests.sql', 'utf8');

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create function public.is_admin() returns boolean language sql as $$ select current_setting('test.admin', true) = 'yes' $$;
    create table public.page_views (session_id text, path text, referrer text, created_at timestamptz);
    create table public.search_events (session_id text, kind text, province text, result_count integer, outcome text, created_at timestamptz);
    create table public.export_events (session_id text, format text, project_name text, "noWatermark" boolean, created_at timestamptz);
    create table public.leads (session_id text, email text, captured_at timestamptz);
    create table public.landing_clicks (session_id text, element text, created_at timestamptz);
    create table public.product_events (session_id text, event text, props jsonb, created_at timestamptz);
  `);
  // Recorded from production, so it must apply over itself.
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(`
    insert into public.search_events (session_id, kind, province, result_count, outcome, created_at)
    values ('s1', 'registry', 'on', 0, 'empty', '2026-10-16T18:41:20Z');
    insert into public.claim_search_requests (email, query_text, province, mode, note, session_id, created_at)
    values ('a@example.com', 'Torrance', 'on', 'company', 'Neotech Metals', 's1', '2026-10-16T18:45:00Z'),
           ('b@example.com', 'Hook Lake', 'sk', 'company', null, null, '2026-10-17T10:00:00Z');
  `);
});
afterAll(async () => db?.close());

const asAdmin = (yes) => db.exec(`select set_config('test.admin', '${yes ? 'yes' : 'no'}', false)`);
const call = async (q, params) => (await db.query(q, params)).rows[0];

describe('claim_search_requests', () => {
  it('counts one request when the same person asks twice', async () => {
    await expect(db.exec(`insert into public.claim_search_requests (email, query_text, province) values ('A@Example.com', 'torrance', 'on')`))
      .rejects.toThrow(/unique/);
  });

  it('lists open requests oldest first and marks one answered', async () => {
    await asAdmin(true);
    const before = (await call('select public.admin_get_claim_search_requests() as r')).r;
    expect(before.open_count).toBe(2);
    expect(before.items.map((i) => i.query_text)).toEqual(['Torrance', 'Hook Lake']);

    const answered = (await call('select public.admin_set_claim_request_answered($1) as r', [before.items[0].id])).r;
    expect(answered.answered_at).toBeTruthy();
    const after = (await call('select public.admin_get_claim_search_requests() as r')).r;
    expect(after.open_count).toBe(1);
    expect(after.items.map((i) => i.query_text)).toEqual(['Hook Lake']);
    expect((await call('select public.admin_get_claim_search_requests(false) as r')).r.items).toHaveLength(2);
  });

  it('shows the request in the session timeline after the search that missed', async () => {
    await asAdmin(true);
    const rows = (await db.query(`select kind, detail from public.admin_get_session_timeline('s1')`)).rows;
    expect(rows).toEqual([
      { kind: 'search', detail: 'registry search · ON · 0 results (empty)' },
      { kind: 'request', detail: 'Asked us to find "Torrance" · ON · Neotech Metals' },
    ]);
  });

  it('keeps the inbox to admins and the table to the service role', async () => {
    await asAdmin(false);
    await expect(db.query('select public.admin_get_claim_search_requests()')).rejects.toThrow(/forbidden/);
    const grants = await db.query(`select has_table_privilege('anon', 'public.claim_search_requests', 'insert') as anon_insert,
      has_table_privilege('authenticated', 'public.claim_search_requests', 'select') as auth_select,
      has_function_privilege('anon', 'public.admin_get_claim_search_requests(boolean, integer)', 'execute') as anon_rpc`);
    expect(grants.rows[0]).toEqual({ anon_insert: false, auth_select: false, anon_rpc: false });
  });
});
