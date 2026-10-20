// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Exploration Maps for Teams enquiries: /api/track writes with the service
// role, only an admin reads or changes status, and the owner email never
// blocks the insert.
let db;
const sql = readFileSync('supabase/migrations/20261020120000_team_enquiries.sql', 'utf8');

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create function public.is_admin() returns boolean language sql as $$ select current_setting('test.admin', true) = 'yes' $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
    create schema net;
    create table net.calls (url text, body jsonb);
    create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ insert into net.calls values (url, body); select 1::bigint $$;
    create table public.page_views (session_id text, path text, referrer text, created_at timestamptz);
    create table public.search_events (session_id text, kind text, province text, result_count integer, outcome text, created_at timestamptz);
    create table public.export_events (session_id text, format text, project_name text, "noWatermark" boolean, created_at timestamptz);
    create table public.leads (session_id text, email text, captured_at timestamptz);
    create table public.landing_clicks (session_id text, element text, created_at timestamptz);
    create table public.product_events (session_id text, event text, props jsonb, created_at timestamptz);
    create table public.claim_search_requests (session_id text, query_text text, province text, note text, created_at timestamptz);
  `);
  await db.exec(sql);
  await db.exec(sql);
});
afterAll(async () => db?.close());

const asAdmin = (yes) => db.exec(`select set_config('test.admin', '${yes ? 'yes' : 'no'}', false)`);
const call = async (q, params) => (await db.query(q, params)).rows[0];

describe('team_enquiries', () => {
  it('keeps the upload bucket private', async () => {
    const b = await call(`select public, file_size_limit from storage.buckets where id = 'team-enquiries'`);
    expect(b).toEqual({ public: false, file_size_limit: 52428800 });
  });

  it('stores an enquiry without an email key configured', async () => {
    await db.exec(`insert into public.team_enquiries (email, company, projects, materials) values ('a@example.com', 'Star Copper', 'Star', '{claims,sections_3d}')`);
    expect((await call('select count(*)::int as n from net.calls')).n).toBe(0);
  });

  it('emails the owner once a key exists', async () => {
    await db.exec(`insert into vault.decrypted_secrets values ('resend_api_key', 'k'), ('feedback_notification_to', 'owner@example.com')`);
    await db.exec(`insert into public.team_enquiries (email, company, materials, files) values ('b@example.com', 'North Rock', '{investor}', '[{"name":"a.csv"}]')`);
    const c = await call('select body from net.calls');
    expect(c.body.to).toBe('owner@example.com');
    expect(c.body.reply_to).toBe('b@example.com');
    expect(c.body.subject).toBe('[Teams] North Rock');
    expect(c.body.text).toMatch(/Files: 1/);
  });

  it('shows an enquiry in the session timeline', async () => {
    await db.exec(`insert into public.team_enquiries (email, company, materials, session_id) values ('c@example.com', 'Timeline Co', '{claims}', 's9')`);
    await asAdmin(true);
    const rows = (await db.query(`select kind, detail from public.admin_get_session_timeline('s9')`)).rows;
    expect(rows).toEqual([{ kind: 'request', detail: 'Teams enquiry · Timeline Co · claims' }]);
    await db.exec(`delete from public.team_enquiries where session_id = 's9'`);
  });

  it('is admin-only, lists newest first and closes an enquiry', async () => {
    await asAdmin(false);
    await expect(db.query('select public.admin_get_team_enquiries()')).rejects.toThrow(/forbidden/);
    await asAdmin(true);
    const before = (await call('select public.admin_get_team_enquiries() as r')).r;
    expect(before.open_count).toBe(2);
    expect(before.items.map((i) => i.company)).toEqual(['North Rock', 'Star Copper']);
    await call('select public.admin_set_team_enquiry_status($1, $2)', [before.items[0].id, 'closed']);
    const after = (await call('select public.admin_get_team_enquiries() as r')).r;
    expect(after.open_count).toBe(1);
    expect(after.items.map((i) => i.company)).toEqual(['Star Copper']);
    await expect(db.query(`select public.admin_set_team_enquiry_status($1, 'archived')`, [before.items[1].id])).rejects.toThrow(/invalid status/);
  });
});
