-- The shared, cross-instance rate limiter that api/_lib/guard.js has been
-- calling since audit P1-10 — and that never existed.
--
-- rateLimitedShared() calls rpc('check_rate_limit', {p_bucket, p_subject,
-- p_max, p_window_seconds}) and, by design, FAILS OPEN when the call errors:
-- an unreachable limiter must not take the product down. No migration ever
-- created the function or the table it describes (public.rate_limits), so
-- every call has returned "function not found" and been treated as "under
-- the limit". The Stripe checkout/portal endpoints and the tenure search have
-- therefore only ever had the per-instance in-memory limiter, which does not
-- hold across serverless instances. This migration makes the shared limiter
-- real.
--
-- Semantics match the in-memory limiter: fixed windows of p_window_seconds,
-- a counter per (bucket, subject, window). Returns TRUE when the caller is
-- OVER the limit.
--
-- Who may call it: anon, authenticated and service_role. api/tenure-search.js
-- deliberately holds only the anon key (so a bug there cannot reach private
-- data), so the function has to be callable with it. The cost of that is
-- bounded: the worst an anon caller can do is spend a bucket for a subject
-- they name (a nuisance 429 on public search for one minute), never read or
-- change anything else — the table itself grants nothing to clients.
--
-- Rollback:
--   drop function if exists public.check_rate_limit(text, text, integer, integer);
--   drop table if exists public.rate_limits;
--   (guard.js keeps failing open, exactly as before this migration.)

create table if not exists public.rate_limits (
  bucket        text        not null,
  subject       text        not null,
  window_start  timestamptz not null,
  count         integer     not null default 0,
  primary key (bucket, subject, window_start)
);

alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;

create or replace function public.check_rate_limit(
  p_bucket text,
  p_subject text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window   integer := greatest(coalesce(p_window_seconds, 60), 1);
  v_start    timestamptz;
  v_count    integer;
begin
  -- Malformed input is not a reason to block a real request (fail open, like
  -- the caller), but it is also not a reason to write an unbounded key.
  if p_bucket is null or p_subject is null
     or length(p_bucket) = 0 or length(p_bucket) > 64
     or length(p_subject) = 0 or length(p_subject) > 128 then
    return false;
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);

  insert into public.rate_limits as r (bucket, subject, window_start, count)
  values (p_bucket, p_subject, v_start, 1)
  on conflict (bucket, subject, window_start)
    do update set count = r.count + 1
  returning r.count into v_count;

  -- Opportunistic cleanup so the table does not grow forever. Roughly one call
  -- in a hundred sweeps windows older than a day; every window this function
  -- can still consult is far younger than that.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count > coalesce(p_max, 30);
end;
$$;

revoke all on function public.check_rate_limit(text, text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, text, integer, integer)
  to anon, authenticated, service_role;

-- The legacy view counter is SECURITY DEFINER, callable by anon, checks
-- nothing, and has had no caller since get_shared_map() started counting views
-- itself (20260728000004). An anonymous write path into shared_maps with no
-- caller is only downside.
drop function if exists public.increment_shared_map_view(text);

-- Verification:
--   select public.check_rate_limit('test', 'me', 2, 60);  -- false
--   select public.check_rate_limit('test', 'me', 2, 60);  -- false
--   select public.check_rate_limit('test', 'me', 2, 60);  -- true (3 > 2)
