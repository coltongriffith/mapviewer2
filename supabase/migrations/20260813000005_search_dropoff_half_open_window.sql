-- Put admin_get_search_dropoff back on a half-open window: [p_start, p_end).
--
-- AdminPage builds a day selection as
--
--   start = <day>T00:00:00.000Z
--   end   = start + 86_400_000        -- the NEXT day's midnight
--
-- so p_end is an exclusive bound by construction. With `> p_start` and
-- `<= p_end` the range is inclusive at the wrong end twice over:
--
--   * a search at exactly the selected day's midnight is EXCLUDED
--   * a search at exactly the following midnight is INCLUDED
--
-- Both events land on the wrong day, and the second is double-counted when the
-- neighbouring day is viewed.
--
-- Every other range-aware RPC in 20260713000001 already uses `>= p_start and
-- < p_end` — 16 predicates, no exceptions. This one was the outlier.
--
-- How it got that way is worth recording, because the mistake was mine and it
-- was made while fixing something else: 20260813000002 had the half-open form
-- correct, and 20260813000003 "restored" the older comparison operators along
-- with the admin gate, in the name of faithfully reverting my own unreviewed
-- changes. Reverting to the previous definition is not the same as reverting to
-- a correct one, and I did not check which this was.
--
-- Rollback: swap the two comparisons back to `>` and `<=` (reintroduces the
-- off-by-one described above).

drop function if exists public.admin_get_search_dropoff(timestamptz, timestamptz);

create function public.admin_get_search_dropoff(
  p_start timestamptz default null,
  p_end   timestamptz default null
)
returns table (
  province          text,
  mode              text,
  searches          bigint,
  zero_results      bigint,
  zero_rate         numeric,
  errors            bigint,
  unclassified      bigint,
  sessions          bigint,
  abandoned         bigint,
  last_search       timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with scoped as (
    select s.*
    from public.search_events s
    where is_admin()
      and s.created_at >= coalesce(p_start, now() - interval '90 days')
      and s.created_at <  coalesce(p_end,   now())
  ),
  last_action as (
    select session_id, max(at) as last_at from (
      select session_id, created_at as at from public.search_events
      union all
      select session_id, created_at from public.product_events
      union all
      select session_id, created_at from public.page_views
    ) a
    where session_id is not null
    group by session_id
  )
  select
    upper(coalesce(sc.province, '?'))                      as province,
    coalesce(sc.mode, '?')                                 as mode,
    count(*)                                               as searches,
    count(*) filter (where sc.outcome = 'empty')           as zero_results,
    round(100.0 * count(*) filter (where sc.outcome = 'empty')
          / nullif(count(*) filter (where sc.outcome is not null), 0), 1) as zero_rate,
    count(*) filter (where sc.outcome = 'error')           as errors,
    count(*) filter (where sc.outcome is null)             as unclassified,
    count(distinct sc.session_id)                          as sessions,
    count(distinct sc.session_id) filter (
      where sc.outcome = 'empty' and sc.created_at >= la.last_at
    )                                                      as abandoned,
    max(sc.created_at)                                     as last_search
  from scoped sc
  left join last_action la on la.session_id = sc.session_id
  group by 1, 2
  order by count(*) filter (where sc.outcome = 'empty') desc,
           count(*) filter (where sc.outcome = 'error') desc,
           count(*) desc;
$$;

revoke all on function public.admin_get_search_dropoff(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_get_search_dropoff(timestamptz, timestamptz) to authenticated, service_role;

-- Verification: a search at exactly midnight belongs to the day that starts
-- there, and never to the day before.
--   with d as (select date_trunc('day', now()) as m)
--   select
--     (select count(*) from public.admin_get_search_dropoff(
--        (select m from d), (select m + interval '1 day' from d))) as day_of,
--     (select count(*) from public.admin_get_search_dropoff(
--        (select m - interval '1 day' from d), (select m from d))) as day_before;
