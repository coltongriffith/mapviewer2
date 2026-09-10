-- Daily activity series for the admin landing tab (Growth).
--
-- The growth redesign (20260905053221) replaced the Overview tab as the
-- landing view but admin_get_growth carries no per-day series, so the first
-- thing an admin sees has no chart. The only daily chart left, on Activity,
-- plots signed-in active users with admins excluded — which on a product with
-- a handful of accounts is zero on almost every day and reads as "no data",
-- even while page_views records dozens of visitor tabs a day.
--
-- This is the daily block from admin_get_overview lifted into its own cheap
-- RPC (three indexed range scans, no KPI work) with one addition: 'sessions'
-- here is DISTINCT visitor tabs, and page views are reported separately. In
-- admin_get_overview the key named 'sessions' is a page-view count, which
-- src/components/admin/primitives.jsx labels correctly but the key does not.
--
-- Shape, one row per Pacific calendar day in [p_start, p_end), zero-filled:
--   [{ d, sessions, page_views, active_users, signups }]
--
-- Admin sessions and admin accounts are excluded the same way as every other
-- dashboard report (admin_users + admin_session_ids).

create or replace function public.admin_get_daily_activity(
  p_start timestamptz,
  p_end timestamptz,
  p_tz text default 'America/Vancouver'
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with admins as (select user_id from public.admin_users),
  adm_sess as (select session_id from public.admin_session_ids(p_start, p_end)),
  pv as (
    select v.session_id, v.created_at
    from public.page_views v
    where v.created_at >= p_start and v.created_at < p_end
      and v.session_id not in (select session_id from adm_sess where session_id is not null)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'd', gd,
    'sessions', coalesce(s.tabs, 0),
    'page_views', coalesce(s.views, 0),
    'active_users', coalesce(au.c, 0),
    'signups', coalesce(su.c, 0)
  ) order by gd), '[]'::jsonb)
  into result
  from generate_series((p_start at time zone p_tz)::date, (p_end at time zone p_tz)::date - 1, interval '1 day') g(gd)
  left join (
    select (created_at at time zone p_tz)::date d, count(distinct session_id) tabs, count(*) views
    from pv group by 1
  ) s on s.d = gd
  left join (
    select (pe.created_at at time zone p_tz)::date d, count(distinct pe.user_id) c
    from public.product_events pe
    where pe.created_at >= p_start and pe.created_at < p_end
      and pe.user_id is not null
      and pe.user_id not in (select user_id from admins)
      and public.em_is_active_event(pe.event)
    group by 1
  ) au on au.d = gd
  left join (
    select (u.created_at at time zone p_tz)::date d, count(*) c
    from auth.users u
    where u.created_at >= p_start and u.created_at < p_end
      and u.id not in (select user_id from admins)
    group by 1
  ) su on su.d = gd;

  return result;
end;
$$;

revoke all on function public.admin_get_daily_activity(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_get_daily_activity(timestamptz, timestamptz, text) to authenticated;

-- Rollback:
--   drop function if exists public.admin_get_daily_activity(timestamptz, timestamptz, text);
