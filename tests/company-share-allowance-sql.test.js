// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
let db, originalAcl, nextUser = 0;
const state = JSON.stringify({ layout: { title: 'Test map' }, layers: [] });
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create table public.user_plans (user_id uuid primary key, plan text);
    create table public.shared_maps (id text primary key, state jsonb not null,
      created_at timestamptz default now(), user_id uuid, view_count int default 0);
    alter table public.shared_maps enable row level security;
    revoke all on public.shared_maps from anon, authenticated;
  `);
  await db.exec(read('20260728000004_shared_maps_bounds.sql'));
  await db.exec(read('20261001180000_account_share_limits_by_plan.sql'));
  originalAcl = (await db.query("select proacl::text as acl from pg_proc where oid = 'public.create_shared_map(jsonb,text)'::regprocedure")).rows[0].acl;
  const correction = read('20261027174653_company_share_allowance.sql');
  await db.exec(correction); await db.exec(correction);
}, 60_000);
afterAll(async () => db?.close());

async function as(userId, sql, args = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || '']);
  await db.exec(`set role ${userId ? 'authenticated' : 'anon'}`);
  try { return (await db.query(sql, args)).rows; } finally { await db.exec('reset role'); }
}
async function account(plan, count) {
  const userId = `00000000-0000-4000-8000-${String(++nextUser).padStart(12, '0')}`;
  if (plan !== null) await db.query('insert into public.user_plans values ($1, $2)', [userId, plan]);
  await db.query(`insert into public.shared_maps (id, state, user_id)
    select $1 || '-' || n, $2::jsonb, $1::uuid from generate_series(1, $3::int) n`, [userId, state, count]);
  return userId;
}
const create = (userId, creatorKey = null, payload = state) => as(userId, 'select public.create_shared_map($1::jsonb, $2)', [payload, creatorKey]);

describe('authoritative Company share allowance', () => {
  it('exposes an authenticated, subject-bound read-only capability without table privileges', async () => {
    const company = await account('company', 0), other = await account('free', 0);
    for (const userId of [company, other]) {
      const rows = await as(userId, 'select public.get_company_connector_allowance() as capability');
      expect(rows[0].capability).toEqual({ version: 1, subject: userId, previews: 200, searches: 600 });
    }
    await expect(as(company, 'select * from public.user_plans')).rejects.toThrow(/permission denied/);
    const meta = (await db.query("select prosecdef, provolatile, proconfig from pg_proc where oid = 'public.get_company_connector_allowance()'::regprocedure")).rows[0];
    expect(meta.prosecdef).toBe(false);
    expect(meta.provolatile).toBe('s');
    expect(meta.proconfig).toEqual(['search_path=""']);
  });

  it('denies anonymous/PUBLIC callers and returns no marker without an authenticated subject', async () => {
    await expect(as(null, 'select public.get_company_connector_allowance()')).rejects.toThrow(/permission denied/);
    const acl = (await db.query("select proacl::text as acl from pg_proc where oid = 'public.get_company_connector_allowance()'::regprocedure")).rows[0].acl;
    expect(acl).toContain('authenticated=X/');
    expect(acl).not.toMatch(/(?:\{|,)=X\/|anon=X\//);
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec('set role authenticated');
    try {
      expect((await db.query('select public.get_company_connector_allowance() as capability')).rows[0].capability).toBeNull();
    } finally { await db.exec('reset role'); }
  });

  it('rolls back capability and Company quota together, then safely reapplies both', async () => {
    const company = await account('company', 30);
    await db.exec('begin');
    try {
      await db.exec('revoke execute on function public.get_company_connector_allowance() from authenticated');
      await db.exec(read('20261001180000_account_share_limits_by_plan.sql'));
      await db.exec('commit');
    } catch (error) { await db.exec('rollback'); throw error; }
    try {
      await expect(as(company, 'select public.get_company_connector_allowance()')).rejects.toThrow(/permission denied/);
      await expect(create(company)).rejects.toThrow(/SHARE_RATE_LIMIT/);
    } finally { await db.exec(read('20261027174653_company_share_allowance.sql')); }
    expect((await as(company, 'select public.get_company_connector_allowance() as capability'))[0].capability.subject).toBe(company);
    expect((await create(company))[0].create_shared_map).toMatch(/^[0-9a-f]{32}$/);
  });

  it('retains the original function grants when applied repeatedly', async () => {
    const current = (await db.query("select proacl::text as acl from pg_proc where oid = 'public.create_shared_map(jsonb,text)'::regprocedure")).rows[0].acl;
    expect(current).toBe(originalAcl);
  });
  it.each([['free', 30], ['pro', 200], ['company', 200], [null, 30], ['unknown', 30]])('enforces the rolling-hour boundary for stored plan %s', async (plan, limit) => {
    const userId = await account(plan, limit - 1);
    const result = await create(userId);
    expect(result[0].create_shared_map).toMatch(/^[0-9a-f]{32}$/);
    const saved = (await db.query('select user_id, expires_at from public.shared_maps where id = $1', [result[0].create_shared_map])).rows[0];
    expect(saved.user_id).toBe(userId);
    expect(saved.expires_at).toBeNull();
    await expect(create(userId)).rejects.toThrow(/SHARE_RATE_LIMIT/);
  });

  it('allows Company preview 31 rather than stopping it at the Free boundary', async () => {
    const company = await account('company', 30);
    expect((await create(company))[0].create_shared_map).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not borrow another account’s Company allowance from payload or creator key', async () => {
    const company = await account('company', 199);
    const free = await account('free', 30);
    await expect(create(free, company, JSON.stringify({ layout: {}, layers: [], user_id: company, plan: 'company' }))).rejects.toThrow(/SHARE_RATE_LIMIT/);
    expect((await create(company))[0].create_shared_map).toMatch(/^[0-9a-f]{32}$/);
  });

  it('retains the anonymous 10-preview limit and expiry despite a Company-looking payload', async () => {
    const key = 'anonymous-company-test';
    await db.query(`insert into public.shared_maps (id, state, creator_key)
      select 'anonymous-' || n, $1::jsonb, $2 from generate_series(1, 9) n`, [state, key]);
    const payload = JSON.stringify({ layout: {}, layers: [], plan: 'company' });
    const shareId = (await create(null, key, payload))[0].create_shared_map;
    const saved = (await db.query('select user_id, expires_at from public.shared_maps where id = $1', [shareId])).rows[0];
    expect(saved.user_id).toBeNull(); expect(saved.expires_at).not.toBeNull();
    await expect(create(null, key, payload)).rejects.toThrow(/SHARE_RATE_LIMIT/);
  });

  it('retains shape validation, creator-key validation and denied direct client writes', async () => {
    const company = await account('company', 0);
    await expect(create(company, null, JSON.stringify({ no_project: true }))).rejects.toThrow(/SHARE_INVALID/);
    await expect(create(null, null)).rejects.toThrow(/SHARE_INVALID/);
    await expect(as(company, "insert into public.shared_maps (id, state, user_id) values ('bypass', $1::jsonb, $2)", [state, company])).rejects.toThrow(/permission denied/);
  });
});
