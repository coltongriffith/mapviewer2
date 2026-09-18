-- Record WHAT was searched, not just how long it was, and report the terms
-- that found nothing.
--
-- WHY. search_events has always stored query_len and never the term. That is
-- enough to see that a search failed and useless for deciding whether it
-- SHOULD have. The B.C. company searches on 2026-09-17 are the case in point:
-- one visitor arrived from the B.C. claims landing page, ran four company
-- searches (19, 36, 36 and 57 characters), got `outcome = 'empty'` every time,
-- and left for Ontario. Twelve of twenty-five B.C. company searches over the
-- preceding month ended the same way.
--
-- Without the term there is no way to tell the two explanations apart:
--   * the matcher is wrong    — the company holds B.C. claims and we missed it
--   * the registry is right   — the company genuinely holds nothing in B.C.
-- The first is a bug to fix; the second is the product working. They are
-- indistinguishable in the data we keep today, so nobody can act on the rate.
--
-- WHAT IS STORED. The search term as typed, truncated and scrubbed of anything
-- that looks like a credential or an email address by api/track.js (the same
-- redact() the error sink and the feedback endpoint use). These are company
-- names and claim numbers — the lookup itself, not who made it. The column is
-- readable only through the admin-gated report below; search_events is closed
-- to clients by 20260710000004_analytics_ingest_lockdown.
--
-- No CHECK on length. api/track.js truncates before inserting, and a CHECK
-- that rejected an over-long term would drop the whole analytics row rather
-- than the surplus characters — losing the event we added this column to see.
--
-- Rollback: drop the function, then `alter table public.search_events drop
-- column query_text`. The dropoff report and every existing column are
-- untouched by this migration.

alter table public.search_events
  add column if not exists query_text text;

comment on column public.search_events.query_text is
  'Search term as typed (truncated + redacted by api/track.js). Null for rows predating 2026-09-18 and for modes with no term, e.g. radius.';

drop function if exists public.admin_get_failed_searches(timestamptz, timestamptz, integer);

create function public.admin_get_failed_searches(
  p_start timestamptz default null,
  p_end   timestamptz default null,
  p_limit integer     default 100
)
returns table (
  province     text,
  mode         text,
  query_text   text,
  chars        integer,
  attempts     bigint,
  sessions     bigint,
  zero_results bigint,
  errors       bigint,
  last_search  timestamptz
)
language sql
stable
security definer
-- search_path deliberately omits pg_temp, for the reason spelled out in
-- 20260813000003: a security-definer function that resolves names through a
-- caller-writable temp schema can be induced to run the caller's objects.
set search_path = public, pg_catalog
as $$
  select
    upper(coalesce(s.province, '?'))              as province,
    coalesce(s.mode, '?')                         as mode,
    s.query_text                                  as query_text,
    -- query_len still answers for rows written before query_text existed, so
    -- an old failure reads as "57 characters, term not recorded" rather than
    -- vanishing from the report.
    max(coalesce(s.query_len, length(s.query_text)))::integer as chars,
    count(*)                                      as attempts,
    count(distinct s.session_id)                  as sessions,
    count(*) filter (where s.outcome = 'empty')   as zero_results,
    count(*) filter (where s.outcome = 'error')   as errors,
    max(s.created_at)                             as last_search
  from public.search_events s
  where is_admin()
    and s.outcome in ('empty', 'error')
    -- Half-open, like every other range RPC (20260813000005). AdminPage sends
    -- start = <day>T00:00Z and end = start + 24h, so an inclusive upper bound
    -- would land a midnight search on two days at once.
    and s.created_at >= coalesce(p_start, now() - interval '90 days')
    and s.created_at <  coalesce(p_end,   now())
  -- Grouped on the term so three tries at one name read as one problem with
  -- three attempts, which is what the 2026-09-17 session actually was.
  --
  -- Rows predating the column have no term to group on, and folding them all
  -- into one "not recorded" row would report six different B.C. searches as a
  -- single 57-character one. Their length is the only thing that distinguishes
  -- them, so it keeps them apart — and it discriminates nothing for rows that
  -- do carry a term, which group by the term itself.
  group by 1, 2, 3, (case when s.query_text is null then s.query_len end)
  order by max(s.created_at) desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function public.admin_get_failed_searches(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.admin_get_failed_searches(timestamptz, timestamptz, integer) to authenticated, service_role;

-- Verification:
--   -- as a non-admin (auth.uid() null → is_admin() false): must be empty
--   set local role authenticated;
--   select count(*) from public.admin_get_failed_searches();  -- expect 0
--   reset role;
--
--   -- argument names the dashboard sends
--   select p.proargnames from pg_proc p where p.proname = 'admin_get_failed_searches';
--   -- expect {p_start,p_end,p_limit}
