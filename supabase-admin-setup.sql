-- ============================================================
-- Exploration Maps -- Analytics & Admin Dashboard Setup
-- Run this in Supabase Dashboard -> SQL Editor -> Run.
-- Safe to re-run: tables use IF NOT EXISTS, policies use
-- exception guards, functions are dropped then recreated.
-- Running it again will NOT drop data.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. EVENT TABLES
-- ────────────────────────────────────────────────────────────

-- 1a. Exports (one row per PNG/SVG/PDF export)
create table if not exists export_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  format text not null,
  project_name text,
  "noWatermark" boolean default false,
  created_at timestamptz default now()
);
alter table export_events add column if not exists created_at timestamptz default now();
alter table export_events enable row level security;
do $$ begin
  create policy "users insert own export events"
    on export_events for insert to authenticated with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon insert export events"
    on export_events for insert to anon with check (user_id is null);
exception when duplicate_object then null; end $$;

-- 1b. Email leads
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  project_title text,
  captured_at timestamptz default now()
);
alter table leads add column if not exists captured_at timestamptz default now();
alter table leads enable row level security;
do $$ begin
  create policy "anyone insert lead"
    on leads for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $$;

-- 1c. Page views (one row per session, with UTM attribution)
create table if not exists page_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  path text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device text,
  created_at timestamptz default now()
);
-- Ensure required columns exist even if page_views predates this schema
alter table page_views add column if not exists created_at timestamptz default now();
alter table page_views add column if not exists referrer text;
alter table page_views add column if not exists utm_source text;
alter table page_views add column if not exists utm_medium text;
alter table page_views add column if not exists utm_campaign text;
alter table page_views add column if not exists device text;
alter table page_views add column if not exists user_id uuid;
-- Add geolocation columns for the live-visitor world map (safe if already present)
alter table page_views add column if not exists lat double precision;
alter table page_views add column if not exists lng double precision;
alter table page_views add column if not exists city text;
alter table page_views add column if not exists country text;
alter table page_views enable row level security;
do $$ begin
  create policy "anyone insert page view"
    on page_views for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $$;
create index if not exists page_views_created_idx on page_views (created_at);

-- 1d. Landing-page clicks (engagement heatmap)
create table if not exists landing_clicks (
  id uuid primary key default gen_random_uuid(),
  element text,
  x_pct integer,
  y_pct integer,
  viewport_w integer,
  page_h integer,
  created_at timestamptz default now()
);
alter table landing_clicks add column if not exists created_at timestamptz default now();
alter table landing_clicks enable row level security;
do $$ begin
  create policy "anyone insert landing click"
    on landing_clicks for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $$;

-- 1e. Claims searches (registry & nearby lookups)
create table if not exists search_events (
  id uuid primary key default gen_random_uuid(),
  kind text default 'registry',
  province text,
  mode text,
  query_len integer,
  result_count integer,
  created_at timestamptz default now()
);
alter table search_events add column if not exists created_at timestamptz default now();
alter table search_events enable row level security;
do $$ begin
  create policy "anyone insert search event"
    on search_events for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $$;
create index if not exists search_events_created_idx on search_events (created_at);

-- 1f. Add view counter to shared_maps if that table exists
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'shared_maps'
  ) then
    alter table shared_maps add column if not exists view_count integer default 0;
    alter table shared_maps add column if not exists created_at timestamptz default now();
  end if;
end $$;

drop function if exists increment_shared_map_view(uuid);
create or replace function increment_shared_map_view(map_id text)
returns void language sql security definer as $$
  update public.shared_maps
  set view_count = coalesce(view_count, 0) + 1
  where id::text = map_id;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. ADMIN GATE
-- ────────────────────────────────────────────────────────────
create or replace function is_admin()
returns boolean language sql security invoker stable as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email = 'coltongriffith@live.ca'
  );
$$;

-- Drop reporting functions before recreating so return-type changes apply cleanly.
drop function if exists admin_get_kpi_trends();
drop function if exists admin_get_funnel();
drop function if exists admin_get_daily_visitors();
drop function if exists admin_get_referrer_stats();
drop function if exists admin_get_device_stats();
drop function if exists admin_get_campaign_stats();
drop function if exists admin_get_search_stats();
drop function if exists admin_get_export_stats();
drop function if exists admin_get_recent_exports();
drop function if exists admin_get_landing_clicks();
drop function if exists admin_get_exports_by_user();
drop function if exists admin_get_top_shared_maps();
drop function if exists admin_get_users();
drop function if exists admin_get_leads();
drop function if exists admin_get_live_visitors();
drop function if exists admin_get_live_locations();

-- ────────────────────────────────────────────────────────────
-- 3. KPI TRENDS (current 30d vs prior 30d for delta chips)
-- ────────────────────────────────────────────────────────────
create or replace function admin_get_kpi_trends()
returns table (metric text, current_30d bigint, prior_30d bigint)
language sql security definer stable as $$
  select
    'visitors'::text,
    count(*) filter (where pv.created_at > now() - interval '30 days'),
    count(*) filter (where pv.created_at <= now() - interval '30 days'
                      and pv.created_at > now() - interval '60 days')
  from public.page_views pv
  where is_admin()

  union all

  select
    'signups'::text,
    count(*) filter (where u.created_at > now() - interval '30 days'),
    count(*) filter (where u.created_at <= now() - interval '30 days'
                      and u.created_at > now() - interval '60 days')
  from auth.users u
  where is_admin()

  union all

  select
    'exports'::text,
    count(*) filter (where e.created_at > now() - interval '30 days'),
    count(*) filter (where e.created_at <= now() - interval '30 days'
                      and e.created_at > now() - interval '60 days')
  from public.export_events e
  where is_admin()

  union all

  select
    'premium_exports'::text,
    count(*) filter (where e.created_at > now() - interval '30 days'
                      and e."noWatermark"),
    count(*) filter (where e.created_at <= now() - interval '30 days'
                      and e.created_at > now() - interval '60 days'
                      and e."noWatermark")
  from public.export_events e
  where is_admin()

  union all

  select
    'searches'::text,
    count(*) filter (where s.created_at > now() - interval '30 days'),
    count(*) filter (where s.created_at <= now() - interval '30 days'
                      and s.created_at > now() - interval '60 days')
  from public.search_events s
  where is_admin()

  union all

  select
    'leads'::text,
    count(*) filter (where l.captured_at > now() - interval '30 days'),
    count(*) filter (where l.captured_at <= now() - interval '30 days'
                      and l.captured_at > now() - interval '60 days')
  from public.leads l
  where is_admin();
$$;

-- ────────────────────────────────────────────────────────────
-- 4. CONVERSION FUNNEL (last 30 days)
-- ────────────────────────────────────────────────────────────
create or replace function admin_get_funnel()
returns table (visitors bigint, signups bigint, exporters bigint, premium_exporters bigint)
language sql security definer stable as $$
  select
    (select count(*) from public.page_views
      where created_at > now() - interval '30 days'),
    (select count(*) from auth.users
      where created_at > now() - interval '30 days'),
    (select count(distinct coalesce(e.user_id::text, e.project_name))
      from public.export_events e
      where e.created_at > now() - interval '30 days'),
    (select count(distinct coalesce(e.user_id::text, e.project_name))
      from public.export_events e
      where e."noWatermark" and e.created_at > now() - interval '30 days')
  where is_admin();
$$;

-- ────────────────────────────────────────────────────────────
-- 5. ACQUISITION
-- ────────────────────────────────────────────────────────────
create or replace function admin_get_daily_visitors()
returns table (visit_date date, sessions bigint, logged_in_sessions bigint)
language sql security definer stable as $$
  select
    pv.created_at::date as visit_date,
    count(*) as sessions,
    count(*) filter (where pv.user_id is not null) as logged_in_sessions
  from public.page_views pv
  where is_admin() and pv.created_at > now() - interval '90 days'
  group by 1 order by 1;
$$;

create or replace function admin_get_referrer_stats()
returns table (referrer text, sessions bigint)
language sql security definer stable as $$
  select
    coalesce(nullif(pv.referrer, ''), 'Direct / Unknown') as referrer,
    count(*) as sessions
  from public.page_views pv
  where is_admin() and pv.created_at > now() - interval '90 days'
  group by 1 order by 2 desc;
$$;

create or replace function admin_get_device_stats()
returns table (device text, sessions bigint)
language sql security definer stable as $$
  select
    coalesce(pv.device, 'desktop') as device,
    count(*) as sessions
  from public.page_views pv
  where is_admin() and pv.created_at > now() - interval '90 days'
  group by 1 order by 2 desc;
$$;

create or replace function admin_get_campaign_stats()
returns table (source text, medium text, campaign text, sessions bigint, signups bigint)
language sql security definer stable as $$
  select
    coalesce(nullif(pv.utm_source, ''), '(none)') as source,
    coalesce(nullif(pv.utm_medium, ''), '(none)') as medium,
    coalesce(nullif(pv.utm_campaign, ''), '(none)') as campaign,
    count(*) as sessions,
    count(*) filter (where pv.user_id is not null) as signups
  from public.page_views pv
  where is_admin()
    and pv.created_at > now() - interval '90 days'
    and (pv.utm_source is not null or pv.utm_campaign is not null)
  group by 1, 2, 3
  order by 4 desc
  limit 50;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. PRODUCT USAGE
-- ────────────────────────────────────────────────────────────
create or replace function admin_get_search_stats()
returns table (province text, kind text, searches bigint, avg_results numeric, last_search timestamptz)
language sql security definer stable as $$
  select
    upper(coalesce(s.province, '?')) as province,
    coalesce(s.kind, 'registry') as kind,
    count(*) as searches,
    round(avg(s.result_count)) as avg_results,
    max(s.created_at) as last_search
  from public.search_events s
  where is_admin() and s.created_at > now() - interval '90 days'
  group by 1, 2
  order by 3 desc;
$$;

create or replace function admin_get_export_stats()
returns table (format text, total bigint, last_30_days bigint)
language sql security definer stable as $$
  select
    e.format,
    count(*) as total,
    count(*) filter (where e.created_at > now() - interval '30 days') as last_30_days
  from public.export_events e
  where is_admin()
  group by e.format
  order by total desc;
$$;

create or replace function admin_get_recent_exports()
returns table (format text, project_name text, user_email text, no_watermark boolean, created_at timestamptz)
language sql security definer stable as $$
  select
    e.format,
    e.project_name,
    u.email as user_email,
    e."noWatermark" as no_watermark,
    e.created_at
  from public.export_events e
  left join auth.users u on u.id = e.user_id
  where is_admin()
  order by e.created_at desc
  limit 50;
$$;

create or replace function admin_get_landing_clicks()
returns table (element text, count bigint)
language sql security definer stable as $$
  select
    coalesce(lc.element, '(no label)') as element,
    count(*) as count
  from public.landing_clicks lc
  where is_admin() and lc.created_at > now() - interval '90 days'
  group by 1
  order by 2 desc
  limit 30;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. MONETIZATION
-- ────────────────────────────────────────────────────────────
create or replace function admin_get_exports_by_user()
returns table (
  user_email text,
  png_count bigint,
  svg_count bigint,
  pdf_count bigint,
  premium_count bigint,
  total_exports bigint,
  last_export timestamptz
)
language sql security definer stable as $$
  select
    u.email as user_email,
    count(*) filter (where lower(e.format) = 'png') as png_count,
    count(*) filter (where lower(e.format) = 'svg') as svg_count,
    count(*) filter (where lower(e.format) = 'pdf') as pdf_count,
    count(*) filter (where e."noWatermark") as premium_count,
    count(*) as total_exports,
    max(e.created_at) as last_export
  from public.export_events e
  left join auth.users u on u.id = e.user_id
  where is_admin()
  group by u.email
  order by total_exports desc;
$$;

create or replace function admin_get_top_shared_maps()
returns table (id text, view_count integer)
language sql security definer stable as $$
  select
    sm.id::text,
    coalesce(sm.view_count, 0) as view_count
  from public.shared_maps sm
  where is_admin()
  order by coalesce(sm.view_count, 0) desc
  limit 20;
$$;

-- ────────────────────────────────────────────────────────────
-- 8. USERS & LIVE
-- ────────────────────────────────────────────────────────────
create or replace function admin_get_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, project_count bigint)
language sql security definer stable as $$
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

create or replace function admin_get_leads()
returns table (email text, project_title text, captured_at timestamptz)
language sql security definer stable as $$
  select l.email, l.project_title, l.captured_at
  from public.leads l
  where is_admin()
  order by l.captured_at desc
  limit 200;
$$;

create or replace function admin_get_live_visitors()
returns table (count bigint)
language sql security definer stable as $$
  select count(*)
  from public.page_views pv
  where is_admin() and pv.created_at > now() - interval '5 minutes';
$$;

-- Recent visitor locations for the live world map (last 30 minutes, geo-located)
create or replace function admin_get_live_locations()
returns table (lat double precision, lng double precision, city text, country text, created_at timestamptz)
language sql security definer stable as $$
  select pv.lat, pv.lng, pv.city, pv.country, pv.created_at
  from public.page_views pv
  where is_admin()
    and pv.created_at > now() - interval '30 minutes'
    and pv.lat is not null and pv.lng is not null
  order by pv.created_at desc
  limit 200;
$$;
