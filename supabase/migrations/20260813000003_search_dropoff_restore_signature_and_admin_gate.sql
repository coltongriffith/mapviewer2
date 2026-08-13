-- Restore the admin gate and the original argument names on
-- admin_get_search_dropoff. Both were lost in 20260813000002.
--
-- 1. SECURITY. The previous revision dropped `where is_admin()` while keeping
--    `security definer` and `grant execute ... to authenticated`. That is the
--    combination that turns an admin report into a public one: the function
--    runs as its owner, and every signed-in user could call the RPC directly
--    and read aggregate search activity, session counts, abandonment and
--    timestamps for the whole product. The admin page's own checks do not
--    protect an RPC — anyone with a session can call PostgREST themselves.
--
-- 2. CALLER CONTRACT. It also renamed p_start/p_end to p_from/p_to. PostgREST
--    binds RPC arguments BY NAME, and AdminPage calls this with
--    { p_start, p_end }. The call would have failed as function-not-found, and
--    the dashboard's batch loader substitutes an empty array on error — so the
--    report would have silently vanished rather than erroring visibly. A
--    rename is not a safe edit when the caller is in another repository layer.
--
-- 3. Two smaller regressions from the same edit, restored here: the function
--    was `stable`, and an omitted range defaulted to the last 90 days rather
--    than to all of history.
--
-- The actual improvement from 20260813000002 is kept: counting by `outcome`
-- rather than `result_count = 0`, so a refused mode or an upstream error is no
-- longer indistinguishable from a registry that answered and had nothing.
--
-- search_path deliberately omits pg_temp. A security-definer function that
-- resolves names through a caller-writable temp schema can be induced to run
-- the caller's objects; pg_catalog is what it actually needs.
--
-- Rollback: re-apply 20260807000001_search_dropoff_report.sql (loses the
-- outcome-based counting but is otherwise equivalent).

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
      and s.created_at >  coalesce(p_start, now() - interval '90 days')
      and s.created_at <= coalesce(p_end,   now())
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
    -- A real miss: the search ran and the registry had nothing.
    count(*) filter (where sc.outcome = 'empty')           as zero_results,
    -- Rate over CLASSIFIABLE searches only. Including rows that predate the
    -- outcome column would quietly deflate every rate spanning 2026-08-05.
    round(100.0 * count(*) filter (where sc.outcome = 'empty')
          / nullif(count(*) filter (where sc.outcome is not null), 0), 1) as zero_rate,
    count(*) filter (where sc.outcome = 'error')           as errors,
    count(*) filter (where sc.outcome is null)             as unclassified,
    count(distinct sc.session_id)                          as sessions,
    -- Abandoned: an empty search that was the session's final action. Counted
    -- over sessions, so three empty tries by one person is one lost visit.
    -- A refusal or an error is not the user giving up.
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

-- Verification:
--   -- as a non-admin (auth.uid() null → is_admin() false): must be empty
--   set local role authenticated;
--   select count(*) from public.admin_get_search_dropoff();  -- expect 0
--   reset role;
--
--   -- argument names the dashboard actually sends
--   select p.proargnames from pg_proc p where p.proname = 'admin_get_search_dropoff';
--   -- expect {p_start,p_end}
