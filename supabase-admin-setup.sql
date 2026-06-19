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
alter table export_events add column if not exists session_id text;
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
alter table leads add column if not exists session_id text;
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
alter table page_views add column if not exists session_id text;
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
alter table landing_clicks add column if not exists session_id text;
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
alter table search_events add column if not exists session_id text;
alter table search_events enable row level security;
do $$ begin
  create policy "anyone insert search event"
    on search_events for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $$;
create index if not exists search_events_created_idx on search_events (created_at);

-- 1f. Live presence heartbeats (one row per active browser tab, refreshed every
-- ~25s while the tab is visible). Drives the "live visitors" world map — a
-- single page_views row per session is too stale to mean "online right now".
create table if not exists live_pings (
  session_id text primary key,
  lat double precision,
  lng double precision,
  city text,
  region text,
  country text,
  created_at timestamptz default now()
);
alter table live_pings add column if not exists created_at timestamptz default now();
alter table live_pings add column if not exists region text;
alter table live_pings enable row level security;
-- RLS policies alone aren't enough — Postgres also requires the table-level
-- privilege grant. live_pings is the first table here that needs UPDATE
-- (everything else is insert-only), so it's not covered by prior grants.
grant select, insert, update on table live_pings to anon, authenticated;
-- Drop + recreate (rather than create-if-not-exists) so a malformed policy
-- left over from an earlier attempt can't silently survive untouched.
drop policy if exists "anyone upsert own ping" on live_pings;
drop policy if exists "anyone update own ping" on live_pings;
drop policy if exists "anyone select live pings" on live_pings;
create policy "anyone upsert own ping"
  on live_pings for insert to anon, authenticated with check (true);
create policy "anyone update own ping"
  on live_pings for update to anon, authenticated using (true) with check (true);
-- The upsert (INSERT ... ON CONFLICT DO UPDATE) needs row visibility to detect
-- the conflicting row, and admin_get_live_visitors/admin_get_live_locations are
-- security definer so they don't need this, but PostgREST's own conflict
-- resolution for upsert does — without it the INSERT side can be rejected.
create policy "anyone select live pings"
  on live_pings for select to anon, authenticated using (true);
create index if not exists live_pings_created_idx on live_pings (created_at);

-- 1f-2. Session-id indexes, used by admin_get_sessions_for_day /
-- admin_get_session_timeline to reconstruct what a single visitor did.
create index if not exists page_views_session_idx on page_views (session_id);
create index if not exists search_events_session_idx on search_events (session_id);
create index if not exists export_events_session_idx on export_events (session_id);
create index if not exists leads_session_idx on leads (session_id);
create index if not exists landing_clicks_session_idx on landing_clicks (session_id);

-- 1g. Add view counter to shared_maps if that table exists
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

-- p_start/p_end let the admin dashboard narrow any breakdown to a single
-- calendar day (or any custom range) instead of the fixed 90-day window;
-- omitting them (or passing null) preserves the original last-90-days behavior.
create or replace function admin_get_referrer_stats(p_start timestamptz default null, p_end timestamptz default null)
returns table (referrer text, sessions bigint)
language sql security definer stable as $$
  select
    coalesce(nullif(pv.referrer, ''), 'Direct / Unknown') as referrer,
    count(*) as sessions
  from public.page_views pv
  where is_admin()
    and pv.created_at > coalesce(p_start, now() - interval '90 days')
    and pv.created_at <= coalesce(p_end, now())
  group by 1 order by 2 desc;
$$;

create or replace function admin_get_device_stats(p_start timestamptz default null, p_end timestamptz default null)
returns table (device text, sessions bigint)
language sql security definer stable as $$
  select
    coalesce(pv.device, 'desktop') as device,
    count(*) as sessions
  from public.page_views pv
  where is_admin()
    and pv.created_at > coalesce(p_start, now() - interval '90 days')
    and pv.created_at <= coalesce(p_end, now())
  group by 1 order by 2 desc;
$$;

create or replace function admin_get_campaign_stats(p_start timestamptz default null, p_end timestamptz default null)
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
    and pv.created_at > coalesce(p_start, now() - interval '90 days')
    and pv.created_at <= coalesce(p_end, now())
    and (pv.utm_source is not null or pv.utm_campaign is not null)
  group by 1, 2, 3
  order by 4 desc
  limit 50;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. PRODUCT USAGE
-- ────────────────────────────────────────────────────────────
create or replace function admin_get_search_stats(p_start timestamptz default null, p_end timestamptz default null)
returns table (province text, kind text, searches bigint, avg_results numeric, last_search timestamptz)
language sql security definer stable as $$
  select
    upper(coalesce(s.province, '?')) as province,
    coalesce(s.kind, 'registry') as kind,
    count(*) as searches,
    round(avg(s.result_count)) as avg_results,
    max(s.created_at) as last_search
  from public.search_events s
  where is_admin()
    and s.created_at > coalesce(p_start, now() - interval '90 days')
    and s.created_at <= coalesce(p_end, now())
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

create or replace function admin_get_recent_exports(p_start timestamptz default null, p_end timestamptz default null)
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
    and e.created_at > coalesce(p_start, '-infinity'::timestamptz)
    and e.created_at <= coalesce(p_end, now())
  order by e.created_at desc
  limit 50;
$$;

create or replace function admin_get_landing_clicks(p_start timestamptz default null, p_end timestamptz default null)
returns table (element text, count bigint)
language sql security definer stable as $$
  select
    coalesce(lc.element, '(no label)') as element,
    count(*) as count
  from public.landing_clicks lc
  where is_admin()
    and lc.created_at > coalesce(p_start, now() - interval '90 days')
    and lc.created_at <= coalesce(p_end, now())
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

create or replace function admin_get_leads(p_start timestamptz default null, p_end timestamptz default null)
returns table (email text, project_title text, captured_at timestamptz)
language sql security definer stable as $$
  select l.email, l.project_title, l.captured_at
  from public.leads l
  where is_admin()
    and l.captured_at > coalesce(p_start, '-infinity'::timestamptz)
    and l.captured_at <= coalesce(p_end, now())
  order by l.captured_at desc
  limit 200;
$$;

-- ────────────────────────────────────────────────────────────
-- 8b. PER-DAY DRILL-DOWN: headline numbers for one calendar day, the list of
-- sessions active that day, and the full event timeline for one session.
-- Lets an admin look at "10 visitors today" and see whether each one was a
-- real person and what they actually did on the site.
-- ────────────────────────────────────────────────────────────
create or replace function admin_get_day_summary(p_day date)
returns table (
  page_views bigint, sessions bigint, signups bigint,
  searches bigint, exports bigint, premium_exports bigint, leads bigint
)
language sql security definer stable as $$
  select
    (select count(*) from public.page_views
      where created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz),
    (select count(distinct session_id) from public.page_views
      where session_id is not null and created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz),
    (select count(*) from auth.users
      where created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz),
    (select count(*) from public.search_events
      where created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz),
    (select count(*) from public.export_events
      where created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz),
    (select count(*) from public.export_events
      where "noWatermark" and created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz),
    (select count(*) from public.leads
      where captured_at >= p_day::timestamptz and captured_at < (p_day + 1)::timestamptz)
  where is_admin();
$$;

create or replace function admin_get_sessions_for_day(p_day date)
returns table (
  session_id text,
  first_seen timestamptz,
  last_seen timestamptz,
  page_view_count bigint,
  paths text[],
  search_count bigint,
  export_count bigint,
  lead_email text,
  device text,
  referrer text,
  city text,
  country text,
  utm_source text,
  user_email text
)
language sql security definer stable as $$
  with day_views as (
    select * from public.page_views
    where session_id is not null
      and created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz
  ),
  day_sessions as (
    select distinct session_id from day_views
    union
    select distinct session_id from public.search_events
      where session_id is not null and created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz
    union
    select distinct session_id from public.export_events
      where session_id is not null and created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz
    union
    select distinct session_id from public.leads
      where session_id is not null and captured_at >= p_day::timestamptz and captured_at < (p_day + 1)::timestamptz
  )
  select
    ds.session_id,
    min(pv.created_at) as first_seen,
    max(pv.created_at) as last_seen,
    count(pv.id) as page_view_count,
    array_agg(distinct pv.path) filter (where pv.path is not null) as paths,
    (select count(*) from public.search_events se where se.session_id = ds.session_id
       and se.created_at >= p_day::timestamptz and se.created_at < (p_day + 1)::timestamptz) as search_count,
    (select count(*) from public.export_events ee where ee.session_id = ds.session_id
       and ee.created_at >= p_day::timestamptz and ee.created_at < (p_day + 1)::timestamptz) as export_count,
    (select l.email from public.leads l where l.session_id = ds.session_id
       and l.captured_at >= p_day::timestamptz and l.captured_at < (p_day + 1)::timestamptz limit 1) as lead_email,
    max(pv.device) as device,
    max(pv.referrer) as referrer,
    max(pv.city) as city,
    max(pv.country) as country,
    max(pv.utm_source) as utm_source,
    max(u.email) as user_email
  from day_sessions ds
  left join day_views pv on pv.session_id = ds.session_id
  left join auth.users u on u.id = pv.user_id
  where is_admin()
  group by ds.session_id
  order by first_seen desc nulls last;
$$;

create or replace function admin_get_session_timeline(p_session_id text)
returns table (event_time timestamptz, kind text, detail text)
language sql security definer stable as $$
  select pv.created_at, 'page_view'::text,
    coalesce(pv.path, '/') || coalesce(' via ' || nullif(pv.referrer, ''), '')
  from public.page_views pv where pv.session_id = p_session_id and is_admin()
  union all
  select se.created_at, 'search'::text,
    coalesce(se.kind, 'registry') || ' search · ' || coalesce(upper(se.province), '?')
      || ' · ' || coalesce(se.result_count::text, '0') || ' results'
  from public.search_events se where se.session_id = p_session_id and is_admin()
  union all
  select ee.created_at, 'export'::text,
    upper(ee.format) || ' export · ' || coalesce(ee.project_name, 'Untitled')
      || case when ee."noWatermark" then ' (no watermark)' else '' end
  from public.export_events ee where ee.session_id = p_session_id and is_admin()
  union all
  select l.captured_at, 'lead'::text, 'Email captured: ' || l.email
  from public.leads l where l.session_id = p_session_id and is_admin()
  union all
  select lc.created_at, 'click'::text, 'Clicked ' || coalesce(lc.element, '(unlabeled)')
  from public.landing_clicks lc where lc.session_id = p_session_id and is_admin()
  order by 1 asc;
$$;

create or replace function admin_get_live_visitors()
returns table (count bigint)
language sql security definer stable as $$
  select count(*)
  from public.live_pings lp
  where is_admin() and lp.created_at > now() - interval '90 seconds';
$$;

-- Active visitor locations for the live world map. Each row is a heartbeat
-- from a tab that pinged within the last 90 seconds (sent every ~25s while
-- the tab is visible), so this reflects who's on the site right now.
create or replace function admin_get_live_locations()
returns table (lat double precision, lng double precision, city text, region text, country text, created_at timestamptz)
language sql security definer stable as $$
  select lp.lat, lp.lng, lp.city, lp.region, lp.country, lp.created_at
  from public.live_pings lp
  where is_admin()
    and lp.created_at > now() - interval '90 seconds'
    and lp.lat is not null and lp.lng is not null
  order by lp.created_at desc
  limit 200;
$$;
