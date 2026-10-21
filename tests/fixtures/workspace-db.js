import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// A PGlite database shaped like production for the company-workspace
// migrations: the tables they extend are rebuilt as production has them
// (including the legacy "own projects" / "own orgs" policies that exist only
// in production), the earlier migrations they redefine are applied for real,
// then `migrations` in order (repeat one to check it is idempotent).
export const readMigration = (f) => readFileSync(`supabase/migrations/${f}`, 'utf8');

export async function createWorkspaceDb({ emails, unconfirmed = [], pro = [], migrations = [] }) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  const users = Object.entries(emails).map(([u, e]) => `('${u}', '${e}', ${unconfirmed.includes(u) ? 'null' : 'now()'})`).join(',');
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto schema extensions;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    insert into auth.users values ${users};
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
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
    insert into vault.decrypted_secrets values ('resend_api_key', 'k');
    create schema net;
    create table net.calls (url text, body jsonb);
    create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ insert into net.calls values (url, body); select 1::bigint $$;
    create table public.user_plans (user_id uuid primary key, plan text, source text);
    ${pro.map((u) => `insert into public.user_plans values ('${u}', 'pro', 'stripe');`).join('\n')}

    -- Baseline tables, constraints, policies and grants, as in production.
    create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null,
      owner_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now());
    create table public.organization_members (id uuid primary key default gen_random_uuid(),
      org_id uuid not null references public.organizations(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      role text not null default 'member', joined_at timestamptz default now(),
      constraint organization_members_org_id_user_id_key unique (org_id, user_id),
      constraint organization_members_role_check check (role = any (array['owner'::text, 'admin'::text, 'member'::text])));
    create table public.projects (id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      org_id uuid references public.organizations(id) on delete set null,
      name text not null default 'Untitled map', payload jsonb not null default '{}'::jsonb, template_id uuid,
      created_at timestamptz not null default now(), updated_at timestamptz default now(), thumbnail text);
    alter table public.organizations enable row level security;
    alter table public.organization_members enable row level security;
    alter table public.projects enable row level security;
    create policy "own orgs" on public.organizations for all using (auth.uid() = owner_id);
    create policy "own memberships" on public.organization_members for all using (auth.uid() = user_id);
    create policy "own projects" on public.projects for all using (auth.uid() = user_id);
    create policy "users select own projects" on public.projects for select to authenticated using (auth.uid() = user_id);
    create policy "users insert own projects" on public.projects for insert to authenticated with check (auth.uid() = user_id);
    create policy "users update own projects" on public.projects for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy "users delete own projects" on public.projects for delete to authenticated using (auth.uid() = user_id);
    grant select, update, delete on public.projects to authenticated;
    grant select, insert, update, delete on public.organizations, public.organization_members to authenticated;

    -- Tenure Monitor tables the migration links to (only the columns used).
    create table public.tenures (id uuid primary key default gen_random_uuid(), tenure_number text, tenure_name text,
      status text, good_to_date date, area_hectares numeric);
    create table public.monitored_portfolios (id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade, org_id uuid,
      name text not null default 'My B.C. claims', jurisdiction text not null default 'BC',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.monitored_portfolio_tenures (id uuid primary key default gen_random_uuid(),
      portfolio_id uuid not null references public.monitored_portfolios(id) on delete cascade,
      tenure_id uuid not null references public.tenures(id) on delete cascade,
      maintenance_decision text not null default 'UNDECIDED', added_at timestamptz not null default now(), removed_at timestamptz);
    alter table public.monitored_portfolios enable row level security;
    create policy portfolios_select_own on public.monitored_portfolios for select to authenticated using (user_id = auth.uid());
    create policy portfolios_update_own on public.monitored_portfolios for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
    grant select, update, delete on public.monitored_portfolios to authenticated;
  `);
  await db.exec(readMigration('20260728000006_project_revisions_and_trash.sql'));
  await db.exec(readMigration('20261022100000_three_d_projects.sql'));
  for (const m of migrations) await db.exec(m);

  // Run one statement as a signed-in user (or anon), as PostgREST would.
  async function as(uid, q, params) {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
    try { return await db.query(q, params); } finally { await db.exec('reset role'); }
  }
  const one = async (uid, q, params) => (await as(uid, q, params)).rows[0];
  const val = async (uid, q, params) => Object.values((await as(uid, q, params)).rows[0] || {})[0];
  // As the database owner with no signed-in user (the service role's view).
  const su = async (q, params) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    return (await db.query(q, params)).rows;
  };
  return { db, as, one, val, su };
}
