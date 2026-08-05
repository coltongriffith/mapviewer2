-- ============================================================
-- Tell a failed search apart from an empty one.
--
-- WHY
--   RegistrySearch records the outcome of every search with
--   `resultCount: results?.features?.length ?? 0`, and it fires on
--   `results || error`. So a 400, a 502, a WAF block, a timeout and a genuine
--   "nobody staked that claim" all land in search_events as result_count = 0,
--   indistinguishable from each other.
--
--   That is not a reporting nicety. Investigating why Manitoba searches were
--   returning nothing, the data could say only "16 searches, 16 zeros" — it
--   could not say whether the province's server was answering. The actual
--   cause (a claim-number search that could only ever reach the numeric
--   identifier column, so a staking tag hit a hard 400) had to be found by
--   reading the code, because the telemetry recorded the symptom identically
--   to a normal miss.
--
--   It also means a fix cannot be verified: a repaired search that legitimately
--   matches nothing looks exactly like the bug it replaced.
--
-- `outcome` is deliberately coarse — three values, no message, no query text.
-- Enough to answer "is this province broken, or is nobody's claim there", and
-- nothing that turns an analytics table into a log of what people searched for.
--
-- Rollback:
--   alter table public.search_events drop column if exists outcome;
-- ============================================================

alter table public.search_events
  add column if not exists outcome text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'search_events_outcome_check') then
    alter table public.search_events
      add constraint search_events_outcome_check
      check (outcome is null or outcome in ('ok', 'empty', 'error'));
  end if;
end
$$;

comment on column public.search_events.outcome is
  'ok = the registry answered with at least one claim; empty = it answered '
  'with none; error = the request failed (upstream down, blocked, rejected, '
  'timed out). NULL for rows written before 2026-08-05, which cannot be '
  'distinguished retrospectively.';

-- Reading pattern is "zero-result rate by province lately", so index the two
-- columns that filter it.
create index if not exists search_events_outcome_idx
  on public.search_events (province, outcome, created_at desc);

-- ── Post-migration verification (run manually) ─────────────────────────────
--   select province, mode,
--          count(*) filter (where outcome = 'ok')    as ok,
--          count(*) filter (where outcome = 'empty') as empty,
--          count(*) filter (where outcome = 'error') as error,
--          count(*) filter (where outcome is null)   as legacy
--   from public.search_events group by province, mode order by error desc;
--   -- A province with errors is broken. A province with only 'empty' is being
--   -- asked for claims that are not there. Those needed to be different rows.
