-- ============================================================
-- Surface a search that finds nothing and ends the visit.
--
-- WHY THIS EXISTS
--   On 2026-08-07 an anonymous visitor arrived from a paid "Mineral Claims BC"
--   click, ran three B.C. claim-number searches in 85 seconds, got zero
--   results on all three, and left. The cause was ours: the B.C. number filter
--   matched TAG_NUMBER only, which is NULL on 36,925 of 42,332 titles, while
--   the UI placeholder told the user to type a TENURE number.
--
--   Nothing reported it. admin_get_search_stats averages result_count per
--   province, so 63 successful company searches drowned 3 zero-result number
--   searches — the average stayed healthy while the feature was broken for
--   87% of the province. It was found by reading one session by hand.
--
--   Averages hide this by construction. A rate does not.
--
-- WHAT IT ANSWERS
--   For each (province, mode): how often does a search return nothing, how
--   often does it error, and how often is a zero-result search the LAST thing
--   a session ever did. That last column is the one worth watching — it is the
--   difference between "nobody has staked that ground" and "we lost someone".
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   No query text. search_events stores query_len and never the term itself
--   (see 20260805000001), and this does not change that. Knowing that B.C.
--   number searches fail is enough to act; knowing what people typed would
--   turn an analytics table into a log of who is researching which ground.
--
-- Rollback:
--   drop function if exists public.admin_get_search_dropoff(timestamptz, timestamptz);
-- ============================================================

create or replace function public.admin_get_search_dropoff(
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
  sessions          bigint,
  abandoned         bigint,
  last_search       timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with scoped as (
    select s.*
    from public.search_events s
    where is_admin()
      and s.created_at >  coalesce(p_start, now() - interval '90 days')
      and s.created_at <= coalesce(p_end,   now())
  ),
  -- The last tracked action of each session, across BOTH tables. A session
  -- that searched and then imported claims is a success; one whose final
  -- recorded act was an empty search is the pattern we are hunting.
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
    count(*) filter (where sc.result_count = 0)            as zero_results,
    round(100.0 * count(*) filter (where sc.result_count = 0)
          / nullif(count(*), 0), 1)                        as zero_rate,
    count(*) filter (where sc.outcome = 'error')           as errors,
    count(distinct sc.session_id)                          as sessions,
    -- Abandoned: a zero-result search that was the session's final action.
    -- Counted over sessions, not searches, so three empty tries by one person
    -- is one lost visit rather than three.
    count(distinct sc.session_id) filter (
      where sc.result_count = 0 and sc.created_at >= la.last_at
    )                                                      as abandoned,
    max(sc.created_at)                                     as last_search
  from scoped sc
  left join last_action la on la.session_id = sc.session_id
  group by 1, 2
  -- Worst first: the rows that cost money are high-volume and high-zero, and
  -- an operator should not have to sort to find them.
  order by count(*) filter (where sc.result_count = 0) desc, count(*) desc;
$$;

revoke all on function public.admin_get_search_dropoff(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_get_search_dropoff(timestamptz, timestamptz) to authenticated, service_role;

-- ── Verification ───────────────────────────────────────────────────────────
--   -- The row that should have raised the alarm (BC / number, 100% zero):
--   select * from public.admin_get_search_dropoff();
--
--   -- is_admin() gates it, so a non-admin caller gets an empty set rather
--   -- than an error — matching every other admin_get_* function here.
