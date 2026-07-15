-- ============================================================
-- Admin Analytics Dashboard v2 — product-analytics aggregation.
-- Additive & idempotent. Apply after 20260710000005 (canonical
-- is_admin() + admin_users) is in place.
--
-- Adds: projects.created_at (backfilled), search_events.user_id,
-- range indexes, a shared admin-session-exclusion helper, three
-- immutable event-taxonomy predicates (single source of truth,
-- mirrored in src/components/admin/metrics.js), and four jsonb
-- reporting RPCs (overview / engagement / users / user-detail).
--
-- Timezone: all bucketing is America/Vancouver via
--   (created_at AT TIME ZONE p_tz)::date
-- p_tz is a parameter (default 'America/Vancouver') so a future
-- change is one line; the client never passes it.
--
-- Rollback:
--   drop function if exists public.admin_get_overview(timestamptz,timestamptz,text);
--   drop function if exists public.admin_get_engagement(timestamptz,timestamptz,text);
--   drop function if exists public.admin_get_users_overview(text);
--   drop function if exists public.admin_get_user_detail(uuid);
--   drop function if exists public.admin_session_ids(timestamptz,timestamptz);
--   drop function if exists public.em_is_active_event(text);
--   drop function if exists public.em_is_value_event(text);
--   drop function if exists public.em_is_activation_event(text,jsonb);
--   -- (leave projects.created_at / search_events.user_id / indexes; harmless)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. COLUMNS
-- ────────────────────────────────────────────────────────────
alter table public.projects add column if not exists created_at timestamptz;
-- Backfill: for existing rows we only have updated_at. This is an UPPER BOUND
-- on the true creation time (exact for never-re-saved projects). Charts draw
-- backfill-derived segments dashed; documented in the dashboard's limits note.
update public.projects set created_at = updated_at where created_at is null;
alter table public.projects alter column created_at set default now();
-- Only enforce NOT NULL if the backfill left nothing null (defensive).
do $$ begin
  if not exists (select 1 from public.projects where created_at is null) then
    alter table public.projects alter column created_at set not null;
  end if;
end $$;

-- search_events gained no user_id historically; add it (no FK, matching
-- product_events' nullable user_id). /api/track fills it going forward.
alter table public.search_events add column if not exists user_id uuid;

-- ────────────────────────────────────────────────────────────
-- 2. INDEXES (range scans for every RPC; tz bucketing is post-scan)
-- ────────────────────────────────────────────────────────────
create index if not exists idx_product_events_event_created on public.product_events (event, created_at);
create index if not exists idx_product_events_user_created  on public.product_events (user_id, created_at) where user_id is not null;
create index if not exists idx_export_events_created        on public.export_events (created_at);
create index if not exists idx_search_events_user_created   on public.search_events (user_id, created_at) where user_id is not null;
create index if not exists idx_page_views_created           on public.page_views (created_at);
create index if not exists idx_projects_created             on public.projects (created_at);

-- ────────────────────────────────────────────────────────────
-- 3. EVENT TAXONOMY — three immutable predicates.
-- SINGLE SOURCE OF TRUTH server-side; mirrored (with a cross-reference
-- comment) in src/components/admin/metrics.js. Pure, non-privileged.
-- ────────────────────────────────────────────────────────────
create or replace function public.em_is_active_event(p_event text)
returns boolean language sql immutable as $$
  select p_event = any (array[
    'editor_opened','first_layer_added','export_completed','share_created',
    'share_forked','signup_completed','onboarding_step','project_created',
    'project_saved','project_opened','registry_claims_imported','layer_added',
    'element_added'
  ]);
$$;

create or replace function public.em_is_value_event(p_event text)
returns boolean language sql immutable as $$
  select p_event = any (array[
    'project_created','project_saved','export_completed','share_created',
    'registry_claims_imported'
  ]);
$$;

-- Activation deliberately excludes anything demo data or autosave can fire:
-- demo loads emit first_layer_added + (via autosave) project_created/saved.
-- Real value requires exporting, sharing, importing live claims, uploading
-- your own data, or placing annotations.
create or replace function public.em_is_activation_event(p_event text, p_props jsonb)
returns boolean language sql immutable as $$
  select p_event = any (array['export_completed','share_created','registry_claims_imported','element_added'])
      or (p_event = 'layer_added' and coalesce(p_props->>'source','') = any (array['upload','csv']));
$$;

revoke all on function public.em_is_active_event(text) from public;
revoke all on function public.em_is_value_event(text) from public;
revoke all on function public.em_is_activation_event(text,jsonb) from public;
grant execute on function public.em_is_active_event(text) to authenticated, service_role;
grant execute on function public.em_is_value_event(text) to authenticated, service_role;
grant execute on function public.em_is_activation_event(text,jsonb) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 4. HELPER: sessions that carried an admin user_id (to scrub even the
-- pre-login portion of an admin's tab). Definer; called only inside RPCs.
-- ────────────────────────────────────────────────────────────
create or replace function public.admin_session_ids(p_start timestamptz, p_end timestamptz)
returns table (session_id text)
language sql security definer stable set search_path = public, pg_temp as $$
  select distinct pe.session_id
    from public.product_events pe
    join public.admin_users a on a.user_id = pe.user_id
    where pe.created_at >= p_start and pe.created_at < p_end
  union
  select distinct pv.session_id
    from public.page_views pv
    join public.admin_users a on a.user_id = pv.user_id
    where pv.created_at >= p_start and pv.created_at < p_end;
$$;
revoke all on function public.admin_session_ids(timestamptz,timestamptz) from public;
grant execute on function public.admin_session_ids(timestamptz,timestamptz) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 5. RPCs. INSTRUMENTATION_DATE ('2026-07-13') is the deploy date used by the
-- pre-instrumentation activation bridge. Every RPC: is_admin() gate → 42501.
-- ────────────────────────────────────────────────────────────

drop function if exists public.admin_get_overview(timestamptz,timestamptz,text);
create function public.admin_get_overview(p_start timestamptz, p_end timestamptz, p_tz text default 'America/Vancouver')
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  result jsonb;
  win interval := p_end - p_start;
  prev_start timestamptz := p_start - (p_end - p_start);
  today_d date := (now() at time zone p_tz)::date;
  yest_d date := (now() at time zone p_tz)::date - 1;
  instr date := date '2026-07-13';
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  with
  admins as (select user_id from public.admin_users),
  -- Non-admin accounts and whether each activated within 7d of signup.
  users_base as (
    select u.id, u.email, u.created_at
    from auth.users u
    where u.id not in (select user_id from admins)
  ),
  activation as (
    select ub.id, ub.email, ub.created_at,
      (
        exists (
          select 1 from public.product_events pe
          where pe.user_id = ub.id
            and public.em_is_activation_event(pe.event, pe.props)
            and pe.created_at >= ub.created_at
            and pe.created_at < ub.created_at + interval '7 days'
        )
        or exists (
          select 1 from public.export_events ee
          where ee.user_id = ub.id
            and ee.created_at >= ub.created_at
            and ee.created_at < ub.created_at + interval '7 days'
        )
        or (ub.created_at < instr::timestamptz and exists (
          select 1 from public.projects p
          where p.user_id = ub.id
            and p.created_at >= ub.created_at
            and p.created_at < ub.created_at + interval '7 days'
        ))
      ) as activated
    from users_base ub
  ),
  -- Product events in the current window, admin-excluded (user + session).
  pe_win as (
    select pe.* from public.product_events pe
    where pe.created_at >= p_start and pe.created_at < p_end
      and (pe.user_id is null or pe.user_id not in (select user_id from admins))
      and pe.session_id not in (select session_id from public.admin_session_ids(p_start, p_end))
  ),
  pe_prev as (
    select pe.* from public.product_events pe
    where pe.created_at >= prev_start and pe.created_at < p_start
      and (pe.user_id is null or pe.user_id not in (select user_id from admins))
      and pe.session_id not in (select session_id from public.admin_session_ids(prev_start, p_start))
  )
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      -- M1 active today (Pacific), yesterday, 7d avg — user-scoped
      'active_today', (
        select count(distinct pe.user_id) from public.product_events pe
        where pe.user_id is not null and pe.user_id not in (select user_id from admins)
          and public.em_is_active_event(pe.event)
          and (pe.created_at at time zone p_tz)::date = today_d
      ),
      'active_yesterday', (
        select count(distinct pe.user_id) from public.product_events pe
        where pe.user_id is not null and pe.user_id not in (select user_id from admins)
          and public.em_is_active_event(pe.event)
          and (pe.created_at at time zone p_tz)::date = yest_d
      ),
      'active_7d_avg', (
        select round(avg(c), 1) from (
          select count(distinct pe.user_id) c
          from public.product_events pe
          where pe.user_id is not null and pe.user_id not in (select user_id from admins)
            and public.em_is_active_event(pe.event)
            and (pe.created_at at time zone p_tz)::date between today_d - 7 and yest_d
          group by (pe.created_at at time zone p_tz)::date
        ) d
      ),
      -- M2 new signups (window vs prior), from auth.users
      'signups', jsonb_build_object(
        'cur', (select count(*) from users_base where created_at >= p_start and created_at < p_end),
        'prev', (select count(*) from users_base where created_at >= prev_start and created_at < p_start)
      ),
      -- M3 activated: matured cohort (signed up 7–35 days ago)
      'activated', (
        select jsonb_build_object(
          'done', count(*) filter (where activated),
          'of', count(*),
          'pending', (select count(*) from activation
                      where created_at >= (now() - interval '7 days'))
        )
        from activation
        where created_at < now() - interval '7 days'
          and created_at >= now() - interval '35 days'
      ),
      -- M4 meaningful actions (value events) + distinct users + kind breakdown
      'actions', jsonb_build_object(
        'cur', (select count(*) from pe_win where public.em_is_value_event(event)),
        'prev', (select count(*) from pe_prev where public.em_is_value_event(event)),
        'users', (select count(distinct user_id) from pe_win where public.em_is_value_event(event) and user_id is not null),
        'kinds', (select coalesce(jsonb_agg(jsonb_build_object('kind', event, 'n', n) order by n desc), '[]'::jsonb)
                  from (select event, count(*) n from pe_win where public.em_is_value_event(event) group by event) k)
      ),
      -- M5 maps & exports
      'maps', jsonb_build_object(
        'created', (select count(*) from pe_win where event = 'project_created'),
        'worked_on', (select count(distinct (props->>'project_id')) from pe_win where event = 'project_saved'),
        'exports', (select count(*) from public.export_events ee
                    where ee.created_at >= p_start and ee.created_at < p_end
                      and (ee.user_id is null or ee.user_id not in (select user_id from admins))),
        'failures', (select count(*) from pe_win where event = 'export_failed'),
        'prev_exports', (select count(*) from public.export_events ee
                    where ee.created_at >= prev_start and ee.created_at < p_start
                      and (ee.user_id is null or ee.user_id not in (select user_id from admins)))
      ),
      -- M6 returning users: active in window AND active on a Pacific day before window start AND account predates window
      'returning', jsonb_build_object(
        'cur', (
          select count(distinct pe.user_id) from public.product_events pe
          where pe.created_at >= p_start and pe.created_at < p_end
            and pe.user_id is not null and pe.user_id not in (select user_id from admins)
            and public.em_is_active_event(pe.event)
            and exists (
              select 1 from public.product_events p2
              where p2.user_id = pe.user_id and public.em_is_active_event(p2.event)
                and (p2.created_at at time zone p_tz)::date < (p_start at time zone p_tz)::date
            )
        ),
        'of_active', (select count(distinct user_id) from pe_win where user_id is not null and public.em_is_active_event(event))
      )
    ),
    -- Daily series over the selected window, zero-filled in Pacific tz
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'd', gd, 'active_users', coalesce(au.c, 0), 'sessions', coalesce(sv.c, 0), 'signups', coalesce(su.c, 0)
      ) order by gd), '[]'::jsonb)
      from generate_series((p_start at time zone p_tz)::date, (p_end at time zone p_tz)::date - 1, interval '1 day') g(gd)
      left join (
        select (pe.created_at at time zone p_tz)::date d, count(distinct pe.user_id) c
        from pe_win pe where pe.user_id is not null and public.em_is_active_event(pe.event)
        group by 1
      ) au on au.d = gd
      left join (
        select (pv.created_at at time zone p_tz)::date d, count(*) c
        from public.page_views pv
        where pv.created_at >= p_start and pv.created_at < p_end
          and pv.session_id not in (select session_id from public.admin_session_ids(p_start, p_end))
        group by 1
      ) sv on sv.d = gd
      left join (
        select (created_at at time zone p_tz)::date d, count(*) c from users_base
        where created_at >= p_start and created_at < p_end group by 1
      ) su on su.d = gd
    ),
    -- 14 complete-day sparklines (ending yesterday), independent of the window
    'spark', (
      select jsonb_build_object(
        'active', jsonb_agg(coalesce(av, 0) order by gd),
        'signups', jsonb_agg(coalesce(sg, 0) order by gd),
        'actions', jsonb_agg(coalesce(ac, 0) order by gd),
        'exports', jsonb_agg(coalesce(ex, 0) order by gd)
      )
      from generate_series(today_d - 14, yest_d, interval '1 day') g(gd)
      left join (
        select (pe.created_at at time zone p_tz)::date d, count(distinct pe.user_id) av
        from public.product_events pe
        where pe.user_id is not null and pe.user_id not in (select user_id from admins)
          and public.em_is_active_event(pe.event)
        group by 1
      ) a on a.d = gd
      left join (
        select (created_at at time zone p_tz)::date d, count(*) sg from users_base group by 1
      ) s on s.d = gd
      left join (
        select (pe.created_at at time zone p_tz)::date d, count(*) ac
        from public.product_events pe
        where pe.user_id is not null and pe.user_id not in (select user_id from admins)
          and public.em_is_value_event(pe.event)
        group by 1
      ) ka on ka.d = gd
      left join (
        select (ee.created_at at time zone p_tz)::date d, count(*) ex
        from public.export_events ee
        where (ee.user_id is null or ee.user_id not in (select user_id from admins))
        group by 1
      ) e on e.d = gd
    ),
    -- Signup activation checklist: signups in last 14 days × 5 funnel stages (within 7d of signup)
    'checklist', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', id, 'email', email, 'signed_up_at', created_at,
        'days_ago', floor(extract(epoch from (now() - created_at)) / 86400),
        'opened', opened, 'added_data', added_data, 'map_work', map_work, 'artifact', artifact,
        'activated', (map_work or artifact)
      ) order by created_at desc), '[]'::jsonb)
      from (
        select ub.id, ub.email, ub.created_at,
          exists (select 1 from public.product_events pe where pe.user_id = ub.id and pe.event = 'editor_opened'
                  and pe.created_at < ub.created_at + interval '7 days') as opened,
          exists (select 1 from public.product_events pe where pe.user_id = ub.id and pe.event = 'first_layer_added'
                  and pe.created_at < ub.created_at + interval '7 days') as added_data,
          exists (select 1 from public.product_events pe where pe.user_id = ub.id
                  and (pe.event in ('element_added','registry_claims_imported')
                       or (pe.event = 'layer_added' and coalesce(pe.props->>'source','') in ('upload','csv')))
                  and pe.created_at < ub.created_at + interval '7 days') as map_work,
          exists (select 1 from public.product_events pe where pe.user_id = ub.id and pe.event in ('export_completed','share_created')
                  and pe.created_at < ub.created_at + interval '7 days') as artifact
        from users_base ub
        where ub.created_at >= now() - interval '14 days'
        order by ub.created_at desc
        limit 50
      ) c
    ),
    -- Needs attention
    'needs_attention', jsonb_build_object(
      'never_activated', (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', id, 'email', email, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
        from (
          select id, email, created_at from activation
          where not activated and created_at < now() - interval '7 days'
          order by created_at desc limit 5
        ) n
      ),
      'went_quiet', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', a.id, 'email', a.email, 'last_active', la.last_active, 'value_count', coalesce(vc.n, 0)) order by vc.n desc nulls last), '[]'::jsonb)
        from activation a
        join lateral (
          select max(pe.created_at) last_active from public.product_events pe
          where pe.user_id = a.id and public.em_is_active_event(pe.event)
        ) la on true
        left join lateral (
          select count(*) n from public.product_events pe
          where pe.user_id = a.id and public.em_is_value_event(pe.event)
        ) vc on true
        where a.activated
          and (la.last_active is null or la.last_active < now() - interval '14 days')
        limit 5
      )
    ),
    -- Most active users in window: distinct active Pacific days, then value count
    'most_active', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'email', email, 'active_days', active_days, 'value_actions', value_actions,
        'dots', dots) order by active_days desc, value_actions desc), '[]'::jsonb)
      from (
        select pe.user_id,
          (select email from users_base where id = pe.user_id) email,
          count(distinct (pe.created_at at time zone p_tz)::date) filter (where public.em_is_active_event(pe.event)) active_days,
          count(*) filter (where public.em_is_value_event(pe.event)) value_actions,
          (
            select jsonb_agg(coalesce(dd.lvl, 0) order by gd)
            from generate_series(today_d - 13, today_d, interval '1 day') g2(gd)
            left join (
              select (p2.created_at at time zone p_tz)::date d,
                max(case when public.em_is_value_event(p2.event) then 2 when public.em_is_active_event(p2.event) then 1 else 0 end) lvl
              from public.product_events p2 where p2.user_id = pe.user_id group by 1
            ) dd on dd.d = gd
          ) dots
        from pe_win pe
        where pe.user_id is not null
        group by pe.user_id
        order by active_days desc, value_actions desc
        limit 8
      ) m
    ),
    -- Activity feed: meaningful events only, admin-excluded, LIMIT 50
    'feed', (
      select coalesce(jsonb_agg(row_to_json(f)::jsonb order by (f.event_time) desc), '[]'::jsonb)
      from (
        (select ub.created_at event_time, 'signup' kind, ub.email actor, null::text session_id,
                jsonb_build_object() meta
         from users_base ub where ub.created_at >= p_start and ub.created_at < p_end)
        union all
        (select pe.created_at, pe.event, (select email from users_base where id = pe.user_id), pe.session_id,
                jsonb_build_object('name', pe.props->>'name', 'format', pe.props->>'format',
                                   'province', pe.props->>'province', 'features', pe.props->>'features',
                                   'message', pe.props->>'message')
         from pe_win pe
         where pe.event in ('project_created','project_saved','export_completed','export_failed',
                            'share_created','share_forked','registry_claims_imported'))
        union all
        (select ee.created_at, 'export_completed', (select email from users_base where id = ee.user_id), ee.session_id,
                jsonb_build_object('name', ee.project_name, 'format', ee.format, 'clean', ee."noWatermark")
         from public.export_events ee
         where ee.created_at >= p_start and ee.created_at < p_end
           and (ee.user_id is null or ee.user_id not in (select user_id from admins))
           and ee.session_id not in (select session_id from public.admin_session_ids(p_start, p_end))
           and not exists (select 1 from pe_win pe where pe.event = 'export_completed' and pe.session_id = ee.session_id
                           and abs(extract(epoch from (pe.created_at - ee.created_at))) < 5))
        union all
        (select l.captured_at, 'lead', l.email, l.session_id, jsonb_build_object('title', l.project_title)
         from public.leads l where l.captured_at >= p_start and l.captured_at < p_end)
        union all
        (select max(pe.created_at), 'share_viewed', null, pe.props->>'mapId',
                jsonb_build_object('mapId', pe.props->>'mapId', 'n', count(*))
         from pe_win pe where pe.event = 'share_viewed'
         group by pe.props->>'mapId', (pe.created_at at time zone p_tz)::date)
      ) f
      order by f.event_time desc
      limit 50
    ),
    -- Tracking-began dates per new event (so pre-instrumentation zeros read as "not tracked yet")
    'since', (
      select coalesce(jsonb_object_agg(event, first_seen), '{}'::jsonb)
      from (select event, min(created_at) first_seen from public.product_events
            where event in ('project_created','project_saved','project_opened','layer_added',
                            'element_added','registry_claims_imported','export_failed')
            group by event) s
    ),
    'meta', jsonb_build_object('tz', p_tz, 'start', p_start, 'end', p_end,
                              'today', today_d, 'instrumentation_date', instr)
  ) into result;

  return result;
end;
$$;
revoke all on function public.admin_get_overview(timestamptz,timestamptz,text) from public;
grant execute on function public.admin_get_overview(timestamptz,timestamptz,text) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- admin_get_engagement — funnels, feature usage, export health, searches
-- ────────────────────────────────────────────────────────────
drop function if exists public.admin_get_engagement(timestamptz,timestamptz,text);
create function public.admin_get_engagement(p_start timestamptz, p_end timestamptz, p_tz text default 'America/Vancouver')
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  result jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  with
  admins as (select user_id from public.admin_users),
  adm_sess as (select session_id from public.admin_session_ids(p_start, p_end)),
  pe_win as (
    select pe.* from public.product_events pe
    where pe.created_at >= p_start and pe.created_at < p_end
      and (pe.user_id is null or pe.user_id not in (select user_id from admins))
      and pe.session_id not in (select session_id from adm_sess)
  ),
  -- Sessions that reached each stage (session value funnel F-A)
  sess_pageview as (
    select distinct pv.session_id from public.page_views pv
    where pv.created_at >= p_start and pv.created_at < p_end
      and pv.session_id not in (select session_id from adm_sess)
  ),
  sess_editor as (select distinct session_id from pe_win where event = 'editor_opened'),
  sess_layer as (select distinct session_id from pe_win where event = 'first_layer_added'),
  sess_value as (select distinct session_id from pe_win where public.em_is_value_event(event)),
  -- New-user activation funnel (F-C): signups in last 28 complete days, stages within 7d
  nu as (
    select u.id, u.email, u.created_at,
      exists (select 1 from public.product_events pe where pe.user_id = u.id and pe.event = 'editor_opened' and pe.created_at < u.created_at + interval '7 days') s_open,
      exists (select 1 from public.product_events pe where pe.user_id = u.id and pe.event = 'first_layer_added' and pe.created_at < u.created_at + interval '7 days') s_data,
      exists (select 1 from public.product_events pe where pe.user_id = u.id and (pe.event in ('element_added','registry_claims_imported') or (pe.event='layer_added' and coalesce(pe.props->>'source','') in ('upload','csv'))) and pe.created_at < u.created_at + interval '7 days') s_work,
      exists (select 1 from public.product_events pe where pe.user_id = u.id and pe.event in ('export_completed','share_created') and pe.created_at < u.created_at + interval '7 days') s_art
    from auth.users u
    where u.id not in (select user_id from admins)
      and u.created_at >= (now() at time zone p_tz)::date - 28
  )
  select jsonb_build_object(
    'funnels', jsonb_build_object(
      'session_value', jsonb_build_array(
        jsonb_build_object('stage','Visited', 'sessions', (select count(*) from sess_pageview)),
        jsonb_build_object('stage','Opened editor', 'sessions', (select count(*) from sess_editor)),
        jsonb_build_object('stage','Added data', 'sessions', (select count(*) from sess_layer)),
        jsonb_build_object('stage','Value action', 'sessions', (select count(*) from sess_value))
      ),
      'gate', jsonb_build_array(
        jsonb_build_object('stage','Gate shown', 'sessions', (select count(distinct session_id) from pe_win where event='export_gate_shown')),
        jsonb_build_object('stage','Signup started', 'sessions', (select count(distinct session_id) from pe_win where event='export_gate_signup_started')),
        jsonb_build_object('stage','Signed up', 'sessions', (select count(distinct session_id) from pe_win where event='signup_completed'))
      ),
      'new_user', jsonb_build_array(
        jsonb_build_object('stage','Signed up','users',(select count(*) from nu),'stuck','[]'::jsonb),
        jsonb_build_object('stage','Opened editor','users',(select count(*) from nu where s_open),
          'stuck',(select coalesce(jsonb_agg(email),'[]'::jsonb) from (select email from nu where not s_open limit 20) x)),
        jsonb_build_object('stage','Added data','users',(select count(*) from nu where s_data),
          'stuck',(select coalesce(jsonb_agg(email),'[]'::jsonb) from (select email from nu where s_open and not s_data limit 20) x)),
        jsonb_build_object('stage','Real map work','users',(select count(*) from nu where s_work),
          'stuck',(select coalesce(jsonb_agg(email),'[]'::jsonb) from (select email from nu where s_data and not s_work and not s_art limit 20) x)),
        jsonb_build_object('stage','Exported / shared','users',(select count(*) from nu where s_art),'stuck','[]'::jsonb)
      )
    ),
    -- Feature usage: events + distinct users + distinct sessions per feature
    'features', (
      select coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'events', events, 'users', users, 'sessions', sessions) order by users desc, events desc), '[]'::jsonb)
      from (
        select feat.feature,
          count(*) events,
          count(distinct pe.user_id) filter (where pe.user_id is not null) users,
          count(distinct pe.session_id) sessions
        from pe_win pe
        join lateral (select case
          when pe.event = 'project_saved' then 'Projects worked on'
          when pe.event = 'project_created' then 'Projects created'
          when pe.event = 'export_completed' then 'Exports'
          when pe.event = 'share_created' then 'Shares created'
          when pe.event = 'registry_claims_imported' then 'Claim imports'
          when pe.event = 'layer_added' and coalesce(pe.props->>'source','') in ('upload','csv') then 'Own-data uploads'
          when pe.event = 'element_added' then 'Annotations'
          else null end feature) feat on feat.feature is not null
        group by feat.feature
      ) g
    ),
    'elements', (
      select coalesce(jsonb_agg(jsonb_build_object('type', t, 'sessions', s) order by s desc), '[]'::jsonb)
      from (select props->>'type' t, count(distinct session_id) s from pe_win where event='element_added' group by 1) e
    ),
    'layer_sources', (
      select coalesce(jsonb_agg(jsonb_build_object('source', src, 'count', c) order by c desc), '[]'::jsonb)
      from (select coalesce(props->>'source','unknown') src, count(*) c from pe_win where event='layer_added' group by 1) l
    ),
    'registry_imports', (
      select coalesce(jsonb_agg(jsonb_build_object('province', prov, 'imports', c, 'features', f) order by c desc), '[]'::jsonb)
      from (select upper(coalesce(props->>'province','?')) prov, count(*) c, sum((props->>'features')::int) f
            from pe_win where event='registry_claims_imported' group by 1) r
    ),
    'project_lifecycle', jsonb_build_object(
      'created', (select count(*) from pe_win where event='project_created'),
      'worked_on', (select count(distinct props->>'project_id') from pe_win where event='project_saved'),
      'opened', (select count(*) from pe_win where event='project_opened')
    ),
    'export_health', jsonb_build_object(
      'completed', (select count(*) from public.export_events ee where ee.created_at >= p_start and ee.created_at < p_end
                    and (ee.user_id is null or ee.user_id not in (select user_id from admins))),
      'failed', (select count(*) from pe_win where event='export_failed'),
      'by_format', (select coalesce(jsonb_agg(jsonb_build_object('format', format, 'n', c) order by c desc), '[]'::jsonb)
                    from (select format, count(*) c from public.export_events ee where ee.created_at >= p_start and ee.created_at < p_end
                          and (ee.user_id is null or ee.user_id not in (select user_id from admins)) group by format) bf),
      'recent_failures', (select coalesce(jsonb_agg(jsonb_build_object('t', created_at, 'format', props->>'format', 'message', props->>'message') order by created_at desc), '[]'::jsonb)
                          from (select created_at, props from pe_win where event='export_failed' order by created_at desc limit 10) rf),
      'ever_failed', (select exists (select 1 from public.product_events where event='export_failed'))
    ),
    'search_users', jsonb_build_object(
      'since', (select min(created_at) from public.search_events where user_id is not null),
      'attributed', (select count(*) from public.search_events where created_at >= p_start and created_at < p_end and user_id is not null),
      'total', (select count(*) from public.search_events where created_at >= p_start and created_at < p_end)
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_engagement(timestamptz,timestamptz,text) from public;
grant execute on function public.admin_get_engagement(timestamptz,timestamptz,text) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- admin_get_users_overview — retention ladder, cohorts, user table
-- ────────────────────────────────────────────────────────────
drop function if exists public.admin_get_users_overview(text);
create function public.admin_get_users_overview(p_tz text default 'America/Vancouver')
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  result jsonb;
  today_d date := (now() at time zone p_tz)::date;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  with
  admins as (select user_id from public.admin_users),
  ub as (select u.id, u.email, u.created_at, u.last_sign_in_at from auth.users u where u.id not in (select user_id from admins)),
  enriched as (
    select ub.*,
      (select max(pe.created_at) from public.product_events pe where pe.user_id = ub.id and public.em_is_active_event(pe.event)) last_event,
      (select count(distinct (pe.created_at at time zone p_tz)::date) from public.product_events pe
        where pe.user_id = ub.id and public.em_is_value_event(pe.event) and pe.created_at >= now() - interval '30 days') value_days_30,
      (select count(*) from public.product_events pe where pe.user_id = ub.id and public.em_is_value_event(pe.event) and pe.created_at >= now() - interval '14 days') value_14,
      (
        exists (select 1 from public.product_events pe where pe.user_id = ub.id and public.em_is_activation_event(pe.event, pe.props)
                and pe.created_at < ub.created_at + interval '7 days')
        or exists (select 1 from public.export_events ee where ee.user_id = ub.id and ee.created_at < ub.created_at + interval '7 days')
        or (ub.created_at < date '2026-07-13' and exists (select 1 from public.projects p where p.user_id = ub.id and p.created_at < ub.created_at + interval '7 days'))
      ) activated
    from ub
  ),
  classified as (
    select e.*,
      case
        when not activated and e.created_at >= now() - interval '7 days' then 'new'
        when not activated then 'never_activated'
        when value_days_30 >= 3 then 'power'
        when value_14 >= 1 then 'active'
        when last_event is null or last_event < now() - interval '14 days' then 'dormant'
        else 'active'
      end status
    from enriched e
  )
  select jsonb_build_object(
    'ladder', (
      select jsonb_build_array(
        jsonb_build_object('bucket','Active this week', 'count', count(*) filter (where last_event >= now() - interval '7 days')),
        jsonb_build_object('bucket','Active this month', 'count', count(*) filter (where last_event >= now() - interval '30 days' and last_event < now() - interval '7 days')),
        jsonb_build_object('bucket','Dormant 30–90d', 'count', count(*) filter (where last_event >= now() - interval '90 days' and last_event < now() - interval '30 days')),
        jsonb_build_object('bucket','Gone 90d+', 'count', count(*) filter (where activated and (last_event is null or last_event < now() - interval '90 days'))),
        jsonb_build_object('bucket','Never activated', 'count', count(*) filter (where not activated))
      ) from classified
    ),
    'returning_week', jsonb_build_object(
      'n', (select count(*) from classified where last_event >= now() - interval '7 days'
            and exists (select 1 from public.product_events pe where pe.user_id = classified.id and public.em_is_active_event(pe.event)
                        and (pe.created_at at time zone p_tz)::date < today_d - 7)),
      'of', (select count(*) from classified where last_event >= now() - interval '7 days')
    ),
    'median_days_to_value', (
      select round(percentile_cont(0.5) within group (order by dtv)::numeric, 1)
      from (
        select extract(epoch from (
          (select min(pe.created_at) from public.product_events pe where pe.user_id = e.id and public.em_is_value_event(pe.event)) - e.created_at
        )) / 86400 dtv
        from enriched e where activated
      ) d where dtv is not null
    ),
    'activated_count', (select count(*) from classified where activated),
    'cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week', wk, 'signups', signups, 'activated', activated_n,
        'd7', jsonb_build_object('n', d7_n, 'matured', d7_mat),
        'd30', jsonb_build_object('n', d30_n, 'matured', d30_mat)
      ) order by wk desc), '[]'::jsonb)
      from (
        select date_trunc('week', (c.created_at at time zone p_tz))::date wk,
          count(*) signups,
          count(*) filter (where activated) activated_n,
          count(*) filter (where activated and now() - c.created_at >= interval '7 days'
            and exists (select 1 from public.product_events pe where pe.user_id = c.id and public.em_is_active_event(pe.event)
                        and (pe.created_at at time zone p_tz)::date > (c.created_at at time zone p_tz)::date
                        and pe.created_at < c.created_at + interval '7 days')) d7_n,
          count(*) filter (where now() - c.created_at >= interval '7 days') d7_mat,
          count(*) filter (where activated and now() - c.created_at >= interval '30 days'
            and exists (select 1 from public.product_events pe where pe.user_id = c.id and public.em_is_active_event(pe.event)
                        and (pe.created_at at time zone p_tz)::date > (c.created_at at time zone p_tz)::date
                        and pe.created_at < c.created_at + interval '30 days')) d30_n,
          count(*) filter (where now() - c.created_at >= interval '30 days') d30_mat
        from classified c
        where c.created_at >= (now() at time zone p_tz)::date - 56
        group by 1
      ) co
    ),
    'users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', id, 'email', email,
        'company', (select settings->>'companyName' from public.account_settings where user_id = classified.id),
        'created_at', created_at, 'last_sign_in_at', last_sign_in_at, 'last_event_at', last_event,
        'status', status, 'activated', activated,
        'active_days_30', value_days_30,
        'projects', (select count(*) from public.projects p where p.user_id = classified.id),
        'exports_total', (select count(*) from public.export_events ee where ee.user_id = classified.id),
        'premium_exports', (select count(*) from public.export_events ee where ee.user_id = classified.id and ee."noWatermark"),
        'dots', (
          select jsonb_agg(coalesce(lvl, 0) order by gd)
          from generate_series(today_d - 13, today_d, interval '1 day') g(gd)
          left join (
            select (pe.created_at at time zone p_tz)::date d,
              max(case when public.em_is_value_event(pe.event) then 2 when public.em_is_active_event(pe.event) then 1 else 0 end) lvl
            from public.product_events pe where pe.user_id = classified.id group by 1
          ) dd on dd.d = gd
        )
      ) order by created_at desc), '[]'::jsonb)
      from (select * from classified order by created_at desc limit 500) classified
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_users_overview(text) from public;
grant execute on function public.admin_get_users_overview(text) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- admin_get_user_detail — single-user drawer
-- ────────────────────────────────────────────────────────────
drop function if exists public.admin_get_user_detail(uuid);
create function public.admin_get_user_detail(p_user_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  result jsonb;
  u_created timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select created_at into u_created from auth.users where id = p_user_id;

  select jsonb_build_object(
    'identity', (
      select jsonb_build_object(
        'user_id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
        'company', s.settings->>'companyName', 'qp_name', s.settings->>'qpName',
        'qp_credentials', s.settings->>'qpCredentials', 'projection', s.settings->>'projectionName'
      )
      from auth.users u left join public.account_settings s on s.user_id = u.id
      where u.id = p_user_id
    ),
    'checklist', jsonb_build_object(
      'opened', exists (select 1 from public.product_events pe where pe.user_id = p_user_id and pe.event='editor_opened' and pe.created_at < u_created + interval '7 days'),
      'added_data', exists (select 1 from public.product_events pe where pe.user_id = p_user_id and pe.event='first_layer_added' and pe.created_at < u_created + interval '7 days'),
      'map_work', exists (select 1 from public.product_events pe where pe.user_id = p_user_id and (pe.event in ('element_added','registry_claims_imported') or (pe.event='layer_added' and coalesce(pe.props->>'source','') in ('upload','csv'))) and pe.created_at < u_created + interval '7 days'),
      'artifact', exists (select 1 from public.product_events pe where pe.user_id = p_user_id and pe.event in ('export_completed','share_created') and pe.created_at < u_created + interval '7 days')
    ),
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'created_at', created_at, 'updated_at', updated_at, 'has_thumb', thumbnail is not null) order by updated_at desc), '[]'::jsonb)
      from (select id, name, created_at, updated_at, thumbnail from public.projects where user_id = p_user_id order by updated_at desc limit 20) p
    ),
    'recent_events', (
      select coalesce(jsonb_agg(jsonb_build_object('t', created_at, 'event', event, 'session_id', session_id, 'props', props) order by created_at desc), '[]'::jsonb)
      from (select created_at, event, session_id, props from public.product_events where user_id = p_user_id order by created_at desc limit 20) e
    ),
    'exports_by_format', (
      select coalesce(jsonb_agg(jsonb_build_object('format', format, 'n', c, 'clean', clean) order by c desc), '[]'::jsonb)
      from (select format, count(*) c, count(*) filter (where "noWatermark") clean from public.export_events where user_id = p_user_id group by format) x
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_user_detail(uuid) from public;
grant execute on function public.admin_get_user_detail(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 6. VERIFICATION (run manually in the SQL editor)
--   -- as anon / normal authenticated user:
--   select admin_get_overview(now()-interval '7 days', now());  -- ERROR 42501
--   -- as admin:
--   select admin_get_overview(now()-interval '7 days', now()) -> 'kpis';  -- jsonb with keys
--   -- admin-event exclusion: seed a product_event with your admin user_id,
--   -- confirm it is absent from kpis.active_today and feed.
--   -- demo-user-not-activated: a user whose only events are first_layer_added
--   -- (source demo) + project_created/saved is NOT counted activated.
--   -- Pacific bucketing: an event at 2026-07-08 23:30 America/Vancouver
--   -- (=2026-07-09 06:30 UTC) buckets to 2026-07-08 in daily[].
--   -- idempotent: re-running this whole file succeeds unchanged.
-- ============================================================
