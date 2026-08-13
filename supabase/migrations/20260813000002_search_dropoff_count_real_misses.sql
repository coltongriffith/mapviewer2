-- Stop counting refusals and errors as failed searches.
--
-- admin_get_search_dropoff ranked jurisdictions by `result_count = 0`, which
-- conflates three different things:
--
--   1. a real miss      — the registry was searched and had nothing
--   2. a refusal        — the mode is not supported there and the API said so
--   3. an upstream error — the registry did not answer
--
-- Only (1) is a product failure. (2) is the system working, and (3) is an
-- outage that belongs in its own column.
--
-- This is not hypothetical. Manitoba read as a 100% failure across 16 searches
-- and looked like the worst jurisdiction in the product. It was not: Manitoba's
-- iMaQs claim layer publishes no holder field, so 13 of those 16 were
-- company-mode searches that the API correctly refused with a 400, and 15 of
-- the 16 came from one afternoon of testing across four sessions. Ranking by
-- result_count made a correct refusal indistinguishable from a broken registry
-- and sent an investigation to the wrong province.
--
-- search_events.outcome (added 20260805000001) already records this properly:
-- 'ok' | 'empty' | 'error'. The report simply was not using it.
--
-- Rows written before 20260805000001 have outcome = null and cannot be
-- classified. They are reported separately as `unclassified` rather than
-- silently folded into either bucket — pooling the two eras is exactly the
-- mistake this migration exists to prevent.
--
-- Rollback: re-apply 20260807000001_search_dropoff_report.sql.

-- Dropped, not replaced: this adds an `unclassified` output column, and
-- Postgres refuses to change an existing function's return type in place.
drop function if exists public.admin_get_search_dropoff(timestamptz, timestamptz);

create function public.admin_get_search_dropoff(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  province text,
  mode text,
  searches bigint,
  zero_results bigint,
  zero_rate numeric,
  errors bigint,
  unclassified bigint,
  sessions bigint,
  abandoned bigint,
  last_search timestamptz
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  with scoped as (
    select * from public.search_events
    where (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to)
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
    -- A real miss: the search ran and found nothing.
    count(*) filter (where sc.outcome = 'empty')           as zero_results,
    -- Rate over CLASSIFIABLE searches only. Including unclassified rows in the
    -- denominator would quietly deflate every rate that spans 2026-08-05.
    round(100.0 * count(*) filter (where sc.outcome = 'empty')
          / nullif(count(*) filter (where sc.outcome is not null), 0), 1) as zero_rate,
    count(*) filter (where sc.outcome = 'error')           as errors,
    count(*) filter (where sc.outcome is null)             as unclassified,
    count(distinct sc.session_id)                          as sessions,
    -- Abandoned: an empty search that was the session's final action. Counted
    -- over sessions, so three empty tries by one person is one lost visit.
    -- A refused or errored search is not abandonment by the user.
    count(distinct sc.session_id) filter (
      where sc.outcome = 'empty' and sc.created_at >= la.last_at
    )                                                      as abandoned,
    max(sc.created_at)                                     as last_search
  from scoped sc
  left join last_action la on la.session_id = sc.session_id
  group by 1, 2
  -- Worst first by real misses. Errors sort second: an outage matters, but it
  -- is a different job from a registry that answers and has nothing.
  order by count(*) filter (where sc.outcome = 'empty') desc,
           count(*) filter (where sc.outcome = 'error') desc,
           count(*) desc;
$$;

revoke all on function public.admin_get_search_dropoff(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_get_search_dropoff(timestamptz, timestamptz) to authenticated, service_role;

-- Verification:
--   select province, mode, searches, zero_results, errors, unclassified
--   from public.admin_get_search_dropoff();
--   -- MB should now show its searches as `unclassified` (pre-2026-08-05),
--   -- not as zero_results, and should no longer sort to the top.
