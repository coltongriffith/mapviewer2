-- First-party error sink (audit P1-12): the table api/client-error.js writes to
-- and the RPC the Admin → Health tab reads.
--
-- Both exist in production (applied 2026-07-29 as "error_events") but the
-- migration was never committed, so a fresh environment — or the restore drill
-- in docs/monitoring.md — came up with a Health tab that reported
-- "Could not find the function public.admin_get_error_summary" and an ingest
-- endpoint whose inserts failed silently (it answers 204 on every error path by
-- design). tests/admin-rpc-contract.test.js now checks that every RPC the app
-- calls is defined in this directory.
--
-- Everything here is idempotent, so re-applying it to production is safe. The
-- one deliberate change from the deployed definition: the function's
-- search_path was 'public, pg_temp', which lets a caller-writable temp schema
-- shadow names inside a security-definer function. It is now '' with every
-- reference schema-qualified, matching the rest of the admin RPCs.

create table if not exists public.error_events (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  source       text not null check (source in ('client', 'api')),
  release      text,
  kind         text not null,
  message      text not null,
  stack        text,
  path         text,
  user_agent   text,
  user_id      uuid references auth.users (id) on delete set null,
  session_id   text,
  context      jsonb,
  fingerprint  text not null,
  seen_count   integer not null default 1
);

create index if not exists error_events_recent_idx on public.error_events (occurred_at desc);
create index if not exists error_events_fingerprint_idx on public.error_events (fingerprint, occurred_at desc);

-- Service-role writes only. RLS on with no policies means no client role can
-- read or write rows; the explicit revoke also clears the bootstrap default
-- grant (see 20260801000005_tenure_grant_hardening.sql).
alter table public.error_events enable row level security;
revoke all on table public.error_events from public, anon, authenticated;
grant all on table public.error_events to service_role;

-- Errors in the last p_hours grouped by fingerprint. Shape is what
-- src/components/admin/HealthTab.jsx renders: { window_hours, total, groups[] }.
create or replace function public.admin_get_error_summary(p_hours integer default 24)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'window_hours', p_hours,
    'total', (select coalesce(sum(seen_count), 0) from public.error_events
               where occurred_at > now() - make_interval(hours => p_hours)),
    'groups', (
      select coalesce(jsonb_agg(g order by g->>'last_seen' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'fingerprint', fingerprint,
          'message', min(message),
          'kind', min(kind),
          'source', min(source),
          'path', min(path),
          'release', min(release),
          'count', sum(seen_count),
          'users', count(distinct user_id),
          'last_seen', max(occurred_at),
          'sample_stack', (array_agg(stack order by occurred_at desc))[1]
        ) as g
        from public.error_events
        where occurred_at > now() - make_interval(hours => p_hours)
        group by fingerprint
        order by max(occurred_at) desc
        limit 50
      ) s
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_get_error_summary(integer) from public, anon, authenticated;
grant execute on function public.admin_get_error_summary(integer) to authenticated;

-- Rollback:
--   drop function if exists public.admin_get_error_summary(integer);
--   drop table if exists public.error_events;
-- (Dropping the table discards the error history; the Health tab then errors
-- visibly rather than showing an empty list.)
