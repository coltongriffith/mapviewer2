// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Exploration Maps 3D share links: public read-only snapshots behind an
// unguessable id, reachable only through RPCs. Applied twice to prove the
// migration is idempotent.
let db;
const projectsSql = readFileSync('supabase/migrations/20261022100000_three_d_projects.sql', 'utf8');
const sql = readFileSync('supabase/migrations/20261024100000_three_d_shares.sql', 'utf8');
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const KEY = 'browserkey0123456789abcdef';
const KEY2 = 'otherbrowser0123456789abcd';

const fig = (title = 'RAILS ZONE', extra = {}) => ({
  v: 1, app: 'Exploration Maps 3D', settings: { title, company: 'Star Copper', labels: [] }, camera: { azimuth: 200, plunge: 30, zoom: 100 },
  files: [{ name: 'collars.csv', text: 'HoleID,E,N,Z,Depth\nSC-1,1,2,3,400', role: 'collar' }], ...extra,
});

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to authenticated, anon;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  `);
  await db.exec(projectsSql);
  await db.exec(sql);
  await db.exec(sql);
});
afterAll(async () => db?.close());

// Run a statement as a signed-in user (or anon), as PostgREST would.
async function as(uid, q, params) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try { return await db.query(q, params); } finally { await db.exec('reset role'); }
}
const one = async (uid, q, params) => Object.values((await as(uid, q, params)).rows[0])[0];
const create = (uid, state = fig(), key = KEY, project = null, thumb = null) =>
  one(uid, 'select public.create_3d_share($1::jsonb, $2, $3::uuid, $4) as id', [JSON.stringify(state), key, project, thumb]);
const get = (uid, id) => one(uid, 'select public.get_3d_share($1) as s', [id]);
const revoke = (uid, id, key = null) => one(uid, 'select public.revoke_3d_share($1, $2) as ok', [id, key]);
const update = (uid, id, state, key = null, thumb = null) => one(uid, 'select public.update_3d_share($1, $2::jsonb, $3, $4) as ok', [id, JSON.stringify(state), thumb, key]);
const list = async (uid, key = null) => (await as(uid, 'select * from public.list_my_3d_shares($1)', [key])).rows;
const clearShares = () => db.exec('delete from public.three_d_shares');

describe('three_d_shares table', () => {
  it('has the share columns and RLS on', async () => {
    const cols = (await db.query(`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'three_d_shares' order by ordinal_position`)).rows.map((c) => c.column_name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'state', 'thumbnail', 'user_id', 'creator_key', 'project_id', 'created_at', 'expires_at', 'revoked_at', 'view_count']));
    const rls = (await db.query(`select relrowsecurity from pg_class where oid = 'public.three_d_shares'::regclass`)).rows[0];
    expect(rls.relrowsecurity).toBe(true);
  });

  it('gives anon and authenticated no direct access at all', async () => {
    const id = await create(null);
    for (const uid of [null, A]) {
      await expect(as(uid, 'select * from public.three_d_shares')).rejects.toThrow(/permission denied/);
      await expect(as(uid, `insert into public.three_d_shares (id, state) values ('${'f'.repeat(32)}', '{}')`)).rejects.toThrow(/permission denied/);
      await expect(as(uid, `update public.three_d_shares set view_count = 0 where id = $1`, [id])).rejects.toThrow(/permission denied/);
      await expect(as(uid, `delete from public.three_d_shares where id = $1`, [id])).rejects.toThrow(/permission denied/);
      await expect(as(uid, `select public.three_d_share_check('{}'::jsonb, null)`)).rejects.toThrow(/permission denied/);
    }
  });

  it('defines every RPC as SECURITY DEFINER with an empty search_path', async () => {
    const fns = (await db.query(`select proname, prosecdef, proconfig from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('create_3d_share', 'get_3d_share', 'list_my_3d_shares', 'update_3d_share', 'revoke_3d_share')`)).rows;
    expect(fns).toHaveLength(5);
    for (const f of fns) {
      expect(f.prosecdef, f.proname).toBe(true);
      expect(f.proconfig, f.proname).toEqual(['search_path=""']);
    }
  });
});

describe('create and get', () => {
  it('creates an anonymous share with an unguessable id that anyone can read', async () => {
    await clearShares();
    const id = await create(null, fig('ANON FIGURE'), KEY, null, 'data:image/jpeg;base64,/9j/AAAA');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const other = await create(null, fig('ANON FIGURE'), KEY);
    expect(other).not.toBe(id);
    const s = await get(null, id);
    expect(Object.keys(s).sort()).toEqual(['state', 'thumbnail']); // no owner, key or counts
    expect(s.state.settings.title).toBe('ANON FIGURE');
    expect(s.state.files[0].name).toBe('collars.csv');
    expect(s.thumbnail).toBe('data:image/jpeg;base64,/9j/AAAA');
    expect((await get(B, id)).state.settings.title).toBe('ANON FIGURE');
    const row = (await db.query('select user_id, creator_key, expires_at, view_count from public.three_d_shares where id = $1', [id])).rows[0];
    expect(row.user_id).toBeNull();
    expect(row.creator_key).toBe(KEY);
    // Anonymous shares expire after 30 days.
    const days = (new Date(row.expires_at) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9); expect(days).toBeLessThan(30.1);
    expect(row.view_count).toBe(1);
  });

  it('attaches a signed-in share to the account, with no expiry and no browser key', async () => {
    const id = await create(A, fig('OWNED'), KEY);
    const row = (await db.query('select user_id, creator_key, expires_at from public.three_d_shares where id = $1', [id])).rows[0];
    expect(row).toEqual({ user_id: A, creator_key: null, expires_at: null });
  });

  it('counts a view at most once a minute', async () => {
    const id = await create(null);
    await get(null, id); await get(null, id); await get(A, id);
    expect((await db.query('select view_count from public.three_d_shares where id = $1', [id])).rows[0].view_count).toBe(1);
    await db.query(`update public.three_d_shares set last_viewed_at = now() - interval '2 minutes' where id = $1`, [id]);
    await get(null, id);
    expect((await db.query('select view_count from public.three_d_shares where id = $1', [id])).rows[0].view_count).toBe(2);
  });

  it('returns null for unknown, malformed and expired ids', async () => {
    expect(await get(null, 'f'.repeat(32))).toBeNull();
    expect(await get(null, "' or 1=1 --")).toBeNull();
    expect(await get(null, null)).toBeNull();
    const id = await create(null);
    await db.query(`update public.three_d_shares set expires_at = now() - interval '1 second' where id = $1`, [id]);
    expect(await get(null, id)).toBeNull();
  });

  it('checks the shape of the figure', async () => {
    const bad = [{}, { v: 2, settings: {}, files: [] }, { v: 1, settings: [], files: [] }, { v: 1, settings: {}, files: {} },
      { v: 1, settings: {}, files: [{ name: 'a.csv' }] }, { v: 1, settings: {}, files: [{ name: 1, text: 'x' }] },
      { v: 1, settings: {}, files: Array.from({ length: 101 }, (_, i) => ({ name: `${i}.csv`, text: '' })) }];
    for (const s of bad) await expect(create(null, s)).rejects.toThrow(/SHARE_INVALID/);
    await expect(one(null, `select public.create_3d_share('[1]'::jsonb, $1)`, [KEY])).rejects.toThrow(/SHARE_INVALID/);
    await expect(create(null, fig(), KEY, null, 'javascript:alert(1)')).rejects.toThrow(/SHARE_INVALID/);
    await expect(create(null, fig(), KEY, null, 'data:image/svg+xml;base64,PHN2Zz4=')).rejects.toThrow(/SHARE_INVALID/);
  });

  it('caps a figure at 8 MB signed in and 2 MB signed out', async () => {
    await clearShares();
    const big = fig('BIG', { files: [{ name: 'topo.xyz', text: 'x'.repeat(8 * 1024 * 1024 + 10) }] });
    await expect(create(null, big)).rejects.toThrow(/SHARE_TOO_LARGE/);
    await expect(create(A, big)).rejects.toThrow(/SHARE_TOO_LARGE/);
    const mid = fig('MID', { files: [{ name: 'topo.xyz', text: 'x'.repeat(2 * 1024 * 1024 + 10) }] });
    await expect(create(null, mid)).rejects.toThrow(/SHARE_TOO_LARGE: signed out/);
    const anonId = await create(null, fig('SMALL'), KEY);
    await expect(update(null, anonId, mid, KEY)).rejects.toThrow(/SHARE_TOO_LARGE: signed out/);
    expect(await create(A, mid)).toMatch(/^[0-9a-f]{32}$/);
    const ok = fig('NEAR LIMIT', { files: [{ name: 'topo.xyz', text: 'x'.repeat(8 * 1024 * 1024 - 2000) }] });
    expect(await create(A, ok)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('needs a browser key to share signed out', async () => {
    await expect(create(null, fig(), null)).rejects.toThrow(/SHARE_INVALID: missing creator key/);
    await expect(create(null, fig(), 'short')).rejects.toThrow(/SHARE_INVALID: missing creator key/);
    await expect(create(null, fig(), 'k'.repeat(101))).rejects.toThrow(/SHARE_INVALID: missing creator key/);
  });
});

describe('rate limits', () => {
  it('allows 10 anonymous shares an hour per browser key', async () => {
    await clearShares();
    for (let i = 0; i < 10; i++) await create(null, fig(`N${i}`), KEY);
    await expect(create(null, fig('ONE TOO MANY'), KEY)).rejects.toThrow(/SHARE_RATE_LIMIT/);
    expect(await create(null, fig('OTHER BROWSER'), KEY2)).toMatch(/^[0-9a-f]{32}$/);
    await db.exec(`update public.three_d_shares set created_at = now() - interval '61 minutes'`);
    expect(await create(null, fig('AN HOUR LATER'), KEY)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('allows 30 shares an hour per account, whatever browser key is sent', async () => {
    await clearShares();
    for (let i = 0; i < 30; i++) await create(A, fig(`A${i}`), `key-${i}-0123456789abcdef`);
    await expect(create(A, fig('ONE TOO MANY'), KEY)).rejects.toThrow(/SHARE_RATE_LIMIT/);
    expect(await create(B, fig('ANOTHER ACCOUNT'))).toMatch(/^[0-9a-f]{32}$/);
  });

  it('caps all anonymous shares per hour and per day, so rotating browser keys does not help', async () => {
    await clearShares();
    await db.exec(`insert into public.three_d_shares (id, state, creator_key)
      select replace(gen_random_uuid()::text, '-', ''), '{}'::jsonb, 'rotated-key-' || lpad(g::text, 8, '0') from generate_series(1, 60) g`);
    await expect(create(null, fig(), 'brand-new-key-0123456789')).rejects.toThrow(/SHARE_RATE_LIMIT/);
    expect(await create(A, fig('SIGNED IN STILL WORKS'))).toMatch(/^[0-9a-f]{32}$/);
    // Spread over the day instead: the daily ceiling still holds.
    await clearShares();
    await db.exec(`insert into public.three_d_shares (id, state, creator_key, created_at)
      select replace(gen_random_uuid()::text, '-', ''), '{}'::jsonb, 'rotated-key-' || lpad(g::text, 8, '0'), now() - interval '2 hours'
      from generate_series(1, 300) g`);
    await expect(create(null, fig(), 'brand-new-key-0123456789')).rejects.toThrow(/SHARE_RATE_LIMIT/);
  });

  it('limits updates to 30 an hour per link', async () => {
    await clearShares();
    const id = await create(A, fig('V0'));
    for (let i = 1; i <= 30; i++) expect(await update(A, id, fig(`V${i}`))).toBe(true);
    await expect(update(A, id, fig('V31'))).rejects.toThrow(/SHARE_RATE_LIMIT/);
    await db.query(`update public.three_d_shares set update_window_start = now() - interval '61 minutes' where id = $1`, [id]);
    expect(await update(A, id, fig('V31'))).toBe(true);
  });
});

describe('ownership: list, update and revoke', () => {
  it('lists only the caller’s own shares, with no anonymous listing', async () => {
    await clearShares();
    const a = await create(A, fig('A FIGURE'));
    const b = await create(B, fig('B FIGURE'));
    const anon = await create(null, fig('ANON FIGURE'), KEY);
    await create(null, fig('OTHER BROWSER'), KEY2);
    expect((await list(A)).map((r) => r.id)).toEqual([a]);
    expect((await list(B)).map((r) => r.id)).toEqual([b]);
    expect((await list(null)).map((r) => r.id)).toEqual([]); // no key: nothing, never everything
    expect((await list(null, '')).map((r) => r.id)).toEqual([]);
    expect((await list(null, 'short')).map((r) => r.id)).toEqual([]);
    const mine = await list(null, KEY);
    expect(mine.map((r) => r.id)).toEqual([anon]);
    expect(mine[0]).toMatchObject({ title: 'ANON FIGURE', anonymous: true, revoked_at: null });
    expect(Object.keys(mine[0])).not.toContain('creator_key');
    // Signed in on the browser that made an anonymous share: both are listed.
    expect((await list(A, KEY)).map((r) => r.id).sort()).toEqual([a, anon].sort());
  });

  it('lets only the owner update a link, and keeps the id', async () => {
    await clearShares();
    const id = await create(A, fig('BEFORE ASSAYS'));
    await expect(update(B, id, fig('HIJACK'))).rejects.toThrow(/SHARE_NOT_FOUND/);
    await expect(update(null, id, fig('HIJACK'), KEY)).rejects.toThrow(/SHARE_NOT_FOUND/);
    await expect(update(null, id, fig('HIJACK'))).rejects.toThrow(/SHARE_NOT_FOUND/);
    expect((await get(null, id)).state.settings.title).toBe('BEFORE ASSAYS');
    expect(await update(A, id, fig('AFTER ASSAYS'), null, 'data:image/png;base64,iVBORw0K')).toBe(true);
    const s = await get(null, id);
    expect(s.state.settings.title).toBe('AFTER ASSAYS');
    expect(s.thumbnail).toBe('data:image/png;base64,iVBORw0K');
    await expect(update(A, id, { v: 1 })).rejects.toThrow(/SHARE_INVALID/);
    await expect(update(A, id, fig('T', { files: [{ name: 'x', text: 'x'.repeat(8 * 1024 * 1024 + 1) }] }))).rejects.toThrow(/SHARE_TOO_LARGE/);
  });

  it('lets the browser that made an anonymous share update it, without extending its expiry', async () => {
    await clearShares();
    const id = await create(null, fig('ANON V1'), KEY);
    const before = (await db.query('select expires_at from public.three_d_shares where id = $1', [id])).rows[0].expires_at;
    await expect(update(null, id, fig('HIJACK'), KEY2)).rejects.toThrow(/SHARE_NOT_FOUND/);
    await expect(update(B, id, fig('HIJACK'))).rejects.toThrow(/SHARE_NOT_FOUND/);
    expect(await update(null, id, fig('ANON V2'), KEY)).toBe(true);
    expect((await get(null, id)).state.settings.title).toBe('ANON V2');
    const after = (await db.query('select expires_at from public.three_d_shares where id = $1', [id])).rows[0].expires_at;
    expect(after).toEqual(before);
  });

  it('lets only the owner revoke, and revoking removes the figure', async () => {
    await clearShares();
    const id = await create(A, fig('SECRET'), null, null, 'data:image/jpeg;base64,/9j/AAAA');
    expect(await revoke(B, id)).toBe(false);
    expect(await revoke(null, id, KEY)).toBe(false);
    expect(await revoke(null, id)).toBe(false);
    expect((await get(null, id)).state.settings.title).toBe('SECRET');
    expect(await revoke(A, id)).toBe(true);
    expect(await get(null, id)).toBeNull();
    expect(await revoke(A, id)).toBe(false); // already revoked
    const row = (await db.query('select state, thumbnail, revoked_at from public.three_d_shares where id = $1', [id])).rows[0];
    expect(row.state).toEqual({});
    expect(row.thumbnail).toBeNull();
    expect(row.revoked_at).not.toBeNull();
    await expect(update(A, id, fig('BACK FROM THE DEAD'))).rejects.toThrow(/SHARE_GONE/);
    expect((await list(A))[0]).toMatchObject({ id, title: null });
  });

  it('anonymous creator-key flow: create, list, update, revoke from the same browser only', async () => {
    await clearShares();
    const id = await create(null, fig('ANON'), KEY);
    expect(await revoke(null, id, KEY2)).toBe(false);
    expect(await revoke(A, id)).toBe(false);
    expect(await revoke(null, id, KEY)).toBe(true);
    expect(await get(null, id)).toBeNull();
    expect((await list(null, KEY))[0]).toMatchObject({ id });
  });

  it('accepts a project id only for a 3D map in the caller’s account', async () => {
    await clearShares();
    const { rows: [{ id: pa }] } = await as(A, `insert into public.three_d_projects (name, settings) values ('Rails', '{}') returning id`);
    const { rows: [{ id: pb }] } = await as(B, `insert into public.three_d_projects (name, settings) values ('Other', '{}') returning id`);
    const id = await create(A, fig('FROM PROJECT'), null, pa);
    expect((await list(A))[0]).toMatchObject({ id, project_id: pa });
    await expect(create(A, fig(), null, pb)).rejects.toThrow(/SHARE_INVALID: that 3D map is not in your account/);
    await expect(create(null, fig(), KEY, pa)).rejects.toThrow(/SHARE_INVALID: that 3D map is not in your account/);
    await expect(create(A, fig(), null, '00000000-0000-4000-8000-000000000999')).rejects.toThrow(/SHARE_INVALID/);
    await as(A, `update public.three_d_projects set deleted_at = now() where id = $1`, [pa]);
    await expect(create(A, fig(), null, pa)).rejects.toThrow(/SHARE_INVALID/);
    // Removing the project row leaves the link working.
    await db.query('delete from public.three_d_projects where id = $1', [pa]);
    expect((await get(null, id)).state.settings.title).toBe('FROM PROJECT');
    expect((await list(A))[0].project_id).toBeNull();
  });
});

describe('grants', () => {
  it('grants EXECUTE only on the RPCs, and not on the helpers', async () => {
    const can = async (role, fn) => (await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).rows[0].ok;
    for (const fn of ['public.create_3d_share(jsonb, text, uuid, text)', 'public.get_3d_share(text)', 'public.list_my_3d_shares(text)',
      'public.update_3d_share(text, jsonb, text, text)', 'public.revoke_3d_share(text, text)']) {
      expect(await can('anon', fn), fn).toBe(true);
      expect(await can('authenticated', fn), fn).toBe(true);
    }
    for (const fn of ['public.three_d_share_check(jsonb, text)', 'public.three_d_share_owned(uuid, text, uuid, text)']) {
      expect(await can('anon', fn), fn).toBe(false);
      expect(await can('authenticated', fn), fn).toBe(false);
    }
    const priv = (await db.query(`select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'three_d_shares' and grantee in ('anon', 'authenticated', 'PUBLIC')`)).rows[0].n;
    expect(priv).toBe(0);
  });
});
