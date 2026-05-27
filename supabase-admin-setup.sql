-- ============================================================
-- Admin Dashboard — Supabase SQL Setup
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. export_events table
-- Tracks every map export (PNG/SVG/PDF) with user + format info
create table if not exists export_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  format text not null,              -- 'png' | 'svg' | 'pdf'
  project_name text,
  no_watermark boolean default false,
  created_at timestamptz default now()
);
alter table export_events enable row level security;

-- Authenticated users can log their own exports
create policy "users insert own export events"
  on export_events for insert to authenticated
  with check (auth.uid() = user_id);

-- Anonymous users (no account) can also log exports
create policy "anon insert export events"
  on export_events for insert to anon
  with check (user_id is null);


-- 2. leads table
-- Mirrors export modal email captures for admin visibility
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  project_title text,
  captured_at timestamptz default now()
);
alter table leads enable row level security;

-- Anyone (logged in or not) can submit a lead
create policy "anyone insert lead"
  on leads for insert to anon, authenticated
  with check (true);


-- 3. Set the admin email config
-- Replace with your actual admin email address
alter database postgres set app.admin_email = 'colton.griffith1616@gmail.com';

-- Reload config so the setting takes effect in this session
select set_config('app.admin_email', 'colton.griffith1616@gmail.com', false);


-- 4. Admin check function
-- Returns true if the currently authenticated user is the admin
create or replace function is_admin()
returns boolean
language sql security invoker stable
set search_path = public
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
    and email = current_setting('app.admin_email', true)
  );
$$;


-- 5. Admin data functions (SECURITY DEFINER = run as function owner, bypassing RLS)
-- These are safe because they check is_admin() internally

create or replace function admin_get_users()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  project_count bigint
)
language sql security definer stable
set search_path = public
as $$
  select
    u.id,
    u.email,
    u.created_at,
    u.last_sign_in_at,
    count(p.id) as project_count
  from auth.users u
  left join public.projects p on p.user_id = u.id
  where is_admin()
  group by u.id, u.email, u.created_at, u.last_sign_in_at
  order by u.created_at desc;
$$;

create or replace function admin_get_export_stats()
returns table (format text, total bigint, last_30_days bigint)
language sql security definer stable
set search_path = public
as $$
  select
    format,
    count(*) as total,
    count(*) filter (where created_at > now() - interval '30 days') as last_30_days
  from public.export_events
  where is_admin()
  group by format
  order by total desc;
$$;

create or replace function admin_get_recent_exports()
returns table (
  format text,
  project_name text,
  user_email text,
  no_watermark boolean,
  created_at timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select
    e.format,
    e.project_name,
    u.email as user_email,
    e.no_watermark,
    e.created_at
  from public.export_events e
  left join auth.users u on u.id = e.user_id
  where is_admin()
  order by e.created_at desc
  limit 50;
$$;

create or replace function admin_get_leads()
returns table (email text, project_title text, captured_at timestamptz)
language sql security definer stable
set search_path = public
as $$
  select email, project_title, captured_at
  from public.leads
  where is_admin()
  order by captured_at desc
  limit 200;
$$;
