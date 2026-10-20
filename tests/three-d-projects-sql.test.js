// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Exploration Maps 3D saved figures: a row per figure and its data files in
// the private 'three-d-files' bucket, both owner-only. Applied twice to prove
// the migration is idempotent.
let db;
const sql = readFileSync('supabase/migrations/20261022100000_three_d_projects.sql', 'utf8');
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    grant usage on schema storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
  `);
  await db.exec(sql);
  await db.exec(sql);
});
afterAll(async () => db?.close());

// Run statements as a signed-in user (or anon), as PostgREST would.
async function as(uid, q, params) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try { return await db.query(q, params); } finally { await db.exec('reset role'); }
}

describe('three_d_projects', () => {
  it('has the owner, settings and file columns, and the list index', async () => {
    const cols = (await db.query(`select column_name, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'three_d_projects' order by ordinal_position`)).rows;
    expect(cols.map((c) => c.column_name)).toEqual(['id', 'user_id', 'name', 'settings', 'file_paths', 'thumbnail', 'created_at', 'updated_at', 'deleted_at']);
    expect(Object.fromEntries(cols.map((c) => [c.column_name, c.is_nullable]))).toMatchObject({ user_id: 'NO', name: 'NO', settings: 'NO', file_paths: 'NO', thumbnail: 'YES', deleted_at: 'YES' });
    const idx = (await db.query(`select indexdef from pg_indexes where indexname = 'three_d_projects_user_updated_idx'`)).rows[0];
    expect(idx.indexdef).toMatch(/\(user_id, updated_at DESC\)/);
    const rls = (await db.query(`select relrowsecurity from pg_class where oid = 'public.three_d_projects'::regclass`)).rows[0];
    expect(rls.relrowsecurity).toBe(true);
  });

  it('defaults the owner to the signed-in user and lets only them see it', async () => {
    const { rows: [row] } = await as(A, `insert into public.three_d_projects (name, settings, file_paths)
      values ('Rails zone', '{"v":1,"settings":{"title":"RAILS"}}', '[{"name":"collars.csv"}]') returning id, user_id`);
    expect(row.user_id).toBe(A);
    expect((await as(A, 'select name from public.three_d_projects')).rows).toEqual([{ name: 'Rails zone' }]);
    expect((await as(B, 'select name from public.three_d_projects')).rows).toEqual([]);
    await expect(as(null, 'select name from public.three_d_projects')).rejects.toThrow(/permission denied/);
  });

  it('stops another user writing, changing, deleting or taking over a row', async () => {
    const { rows: [{ id }] } = await as(A, `select id from public.three_d_projects limit 1`);
    await expect(as(B, `insert into public.three_d_projects (user_id, name, settings) values ($1, 'x', '{}')`, [A])).rejects.toThrow(/row-level security/);
    expect((await as(B, `update public.three_d_projects set name = 'hijack' where id = $1`, [id])).affectedRows).toBe(0);
    expect((await as(B, `delete from public.three_d_projects where id = $1`, [id])).affectedRows).toBe(0);
    await expect(as(A, `update public.three_d_projects set user_id = $2 where id = $1`, [id, B])).rejects.toThrow(/row-level security/);
    expect((await as(A, 'select name from public.three_d_projects')).rows).toEqual([{ name: 'Rails zone' }]);
  });

  it('soft-deletes and touches updated_at on change', async () => {
    const { rows: [{ id, updated_at: before }] } = await as(A, `select id, updated_at from public.three_d_projects limit 1`);
    await db.exec(`select pg_sleep(0.01)`);
    const { rows: [after] } = await as(A, `update public.three_d_projects set deleted_at = now(), updated_at = '2000-01-01' where id = $1 returning updated_at, deleted_at`, [id]);
    expect(after.deleted_at).not.toBeNull();
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('rejects an empty name and non-object settings', async () => {
    await expect(as(A, `insert into public.three_d_projects (name, settings) values ('', '{}')`)).rejects.toThrow(/check constraint/);
    await expect(as(A, `insert into public.three_d_projects (name, settings) values ('x', '[]')`)).rejects.toThrow(/check constraint/);
  });
});

describe('three-d-files bucket', () => {
  it('is private with a 50 MB object limit', async () => {
    const b = (await db.query(`select public, file_size_limit from storage.buckets where id = 'three-d-files'`)).rows[0];
    expect(b).toEqual({ public: false, file_size_limit: 52428800 });
  });

  it('keeps each user inside their own folder', async () => {
    await as(A, `insert into storage.objects (bucket_id, name) values ('three-d-files', $1)`, [`${A}/p1/collars.csv`]);
    await expect(as(A, `insert into storage.objects (bucket_id, name) values ('three-d-files', $1)`, [`${B}/p1/collars.csv`])).rejects.toThrow(/row-level security/);
    await expect(as(A, `insert into storage.objects (bucket_id, name) values ('other-bucket', $1)`, [`${A}/p1/x.csv`])).rejects.toThrow(/row-level security/);
    expect((await as(A, `select name from storage.objects where bucket_id = 'three-d-files'`)).rows).toEqual([{ name: `${A}/p1/collars.csv` }]);
    expect((await as(B, `select name from storage.objects where bucket_id = 'three-d-files'`)).rows).toEqual([]);
    expect((await as(B, `update storage.objects set name = name where bucket_id = 'three-d-files'`)).affectedRows).toBe(0);
    expect((await as(B, `delete from storage.objects where bucket_id = 'three-d-files'`)).affectedRows).toBe(0);
    expect((await as(A, `delete from storage.objects where bucket_id = 'three-d-files'`)).affectedRows).toBe(1);
  });

  it('creates each policy once', async () => {
    const n = (await db.query(`select count(*)::int as n from pg_policies where policyname like '%3D%'`)).rows[0].n;
    expect(n).toBe(8);
  });
});
