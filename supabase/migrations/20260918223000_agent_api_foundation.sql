-- ============================================================
-- ExplorationMaps Agent API foundation.
--
-- Adds hashed API credentials, idempotent agent-run logging, and server-only
-- project/share creation RPCs. These objects are intentionally not exposed to
-- anon/authenticated callers: the Vercel Agent API authenticates bearer tokens
-- and invokes the RPCs with the server-side service role.
--
-- Rollback:
--   drop function if exists public.create_agent_share(uuid, jsonb, uuid);
--   drop function if exists public.create_agent_project(uuid, text, jsonb, uuid);
--   drop table if exists public.agent_runs;
--   drop table if exists public.agent_api_keys;
-- ============================================================

create table if not exists public.agent_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  token_prefix text not null check (char_length(token_prefix) between 6 and 32),
  token_hash text not null unique check (char_length(token_hash) = 64),
  scopes text[] not null default array['maps:create','maps:read','claims:search']::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists agent_api_keys_user_idx
  on public.agent_api_keys (user_id, created_at desc);
create index if not exists agent_api_keys_active_hash_idx
  on public.agent_api_keys (token_hash)
  where revoked_at is null;

alter table public.agent_api_keys enable row level security;
revoke all on table public.agent_api_keys from anon, authenticated;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  api_key_id uuid not null references public.agent_api_keys(id) on delete cascade,
  platform text not null default 'unknown'
    check (char_length(platform) between 1 and 40),
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 160),
  action text not null check (char_length(action) between 1 and 80),
  status text not null default 'started'
    check (status in ('started','ready','failed')),
  project_id uuid references public.projects(id) on delete set null,
  share_id text references public.shared_maps(id) on delete set null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_code text,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (api_key_id, idempotency_key)
);

create index if not exists agent_runs_user_created_idx
  on public.agent_runs (user_id, created_at desc);
create index if not exists agent_runs_project_idx
  on public.agent_runs (project_id)
  where project_id is not null;

alter table public.agent_runs enable row level security;
revoke all on table public.agent_runs from anon, authenticated;

create or replace function public.create_agent_project(
  p_user_id uuid,
  p_name text,
  p_payload jsonb,
  p_api_key_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_source text;
  v_limit integer;
  v_count integer;
  v_id uuid;
begin
  if p_user_id is null or p_api_key_id is null then
    raise exception 'AGENT_INVALID_IDENTITY' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.agent_api_keys k
    where k.id = p_api_key_id
      and k.user_id = p_user_id
      and k.revoked_at is null
      and (k.expires_at is null or k.expires_at > now())
  ) then
    raise exception 'AGENT_KEY_INVALID' using errcode = '42501';
  end if;

  if p_name is null or char_length(btrim(p_name)) = 0 or char_length(p_name) > 200 then
    raise exception 'invalid project name' using errcode = '22023';
  end if;

  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ? 'layout')
     or not (p_payload ? 'layers')
     or pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'invalid or oversized project payload' using errcode = '22023';
  end if;

  -- Serialize cloud-project creation for this user, including the zero-project
  -- case where row locks alone cannot protect the quota check.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select plan, source into v_plan, v_source
  from public.user_plans
  where user_id = p_user_id;

  if coalesce(v_plan, 'free') = 'pro'
     or coalesce(v_source, '') in ('grandfathered', 'admin') then
    v_limit := null;
  else
    v_limit := 2;
  end if;

  if v_limit is not null then
    select count(*) into v_count
    from public.projects
    where user_id = p_user_id;

    if v_count >= v_limit then
      raise exception 'PROJECT_LIMIT: free plan allows % cloud projects', v_limit
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.projects (user_id, name, payload, updated_at)
  values (p_user_id, btrim(p_name), p_payload, now())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_agent_project(uuid, text, jsonb, uuid) from public;
revoke execute on function public.create_agent_project(uuid, text, jsonb, uuid) from anon, authenticated;
grant execute on function public.create_agent_project(uuid, text, jsonb, uuid) to service_role;

create or replace function public.create_agent_share(
  p_user_id uuid,
  p_state jsonb,
  p_api_key_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text;
  v_bytes integer;
  v_features integer;
  v_recent integer;
begin
  if not exists (
    select 1 from public.agent_api_keys k
    where k.id = p_api_key_id
      and k.user_id = p_user_id
      and k.revoked_at is null
      and (k.expires_at is null or k.expires_at > now())
  ) then
    raise exception 'AGENT_KEY_INVALID' using errcode = '42501';
  end if;

  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'SHARE_INVALID: share payload must be an object' using errcode = 'P0001';
  end if;

  v_bytes := pg_column_size(p_state);
  if v_bytes > 2 * 1024 * 1024 then
    raise exception 'SHARE_TOO_LARGE: share payload exceeds 2048 KB' using errcode = 'P0001';
  end if;

  if not (p_state ? 'layers' and p_state ? 'layout') then
    raise exception 'SHARE_INVALID: share payload is not a project' using errcode = 'P0001';
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(l->'geojson'->'features', '[]'::jsonb))), 0)
  into v_features
  from jsonb_array_elements(coalesce(p_state->'layers', '[]'::jsonb)) l
  where jsonb_typeof(coalesce(l->'geojson'->'features', '[]'::jsonb)) = 'array';

  if v_features > 50000 then
    raise exception 'SHARE_TOO_COMPLEX: feature limit exceeded' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
  from public.shared_maps
  where user_id = p_user_id
    and created_at > now() - interval '1 hour';

  if v_recent >= 60 then
    raise exception 'SHARE_RATE_LIMIT: too many agent shares created recently' using errcode = 'P0001';
  end if;

  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into public.shared_maps (id, state, user_id, creator_key, expires_at)
  values (v_id, p_state, p_user_id, null, null);

  return v_id;
end;
$$;

revoke all on function public.create_agent_share(uuid, jsonb, uuid) from public;
revoke execute on function public.create_agent_share(uuid, jsonb, uuid) from anon, authenticated;
grant execute on function public.create_agent_share(uuid, jsonb, uuid) to service_role;

-- Verification after applying:
-- 1. anon/authenticated cannot select agent_api_keys or agent_runs.
-- 2. anon/authenticated cannot execute create_agent_project/create_agent_share.
-- 3. service_role can create a project/share only when the supplied key belongs
--    to the supplied user and is active.
