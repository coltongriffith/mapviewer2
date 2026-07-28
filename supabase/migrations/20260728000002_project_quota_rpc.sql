-- ============================================================
-- Server-side, transactional cloud-project creation.
--
-- Replaces the browser's count-then-insert quota check, which could be
-- bypassed with a direct Supabase request and exceeded by two concurrent
-- tabs. This function is the ONLY path that may insert a projects row for a
-- free account: the row-level INSERT grant is revoked below.
--
-- The quota is evaluated inside the same transaction as the insert, and the
-- user's own rows are locked first, so concurrent creates at the limit
-- serialize and exactly one wins.
--
-- Entitlements mirrored from src/utils/entitlements.js:
--   free  → 2 cloud projects
--   pro / grandfathered / admin → unlimited
--
-- Rollback:
--   drop function if exists public.create_cloud_project(text, jsonb);
--   grant insert on public.projects to authenticated;
-- ============================================================

create or replace function public.create_cloud_project(p_name text, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
  v_source text;
  v_limit int;
  v_count int;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_name is null or length(p_name) = 0 or length(p_name) > 200 then
    raise exception 'invalid project name' using errcode = '22023';
  end if;
  -- Bound the payload here as well as in the client; a JSONB row is the most
  -- expensive thing an authenticated user can create.
  if p_payload is null or pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'project payload too large' using errcode = '22023';
  end if;

  select plan, source into v_plan, v_source
  from public.user_plans where user_id = v_user;

  -- Unlimited for pro/grandfathered/admin. An account with no plan row yet
  -- (signup trigger raced) is treated as free — fail CLOSED on quota.
  if coalesce(v_plan, 'free') = 'pro' or coalesce(v_source, '') in ('grandfathered', 'admin') then
    v_limit := null;
  else
    v_limit := 2;
  end if;

  if v_limit is not null then
    -- Lock this user's existing rows so two concurrent creates cannot both
    -- observe count = limit - 1.
    perform 1 from public.projects where user_id = v_user for update;
    select count(*) into v_count from public.projects where user_id = v_user;
    if v_count >= v_limit then
      raise exception 'PROJECT_LIMIT: free plan allows % cloud projects', v_limit
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.projects (user_id, name, payload, updated_at)
  values (v_user, p_name, p_payload, now())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_cloud_project(text, jsonb) from public;
grant execute on function public.create_cloud_project(text, jsonb) to authenticated;

-- Creation must go through the function above. UPDATE/DELETE/SELECT stay on
-- the table (already constrained to the owner by RLS); only INSERT moves.
revoke insert on public.projects from authenticated;

-- Post-migration verification (run manually):
--   -- as an authenticated free user with 2 projects:
--   select public.create_cloud_project('third', '{}'::jsonb);  -- expect PROJECT_LIMIT
--   -- direct insert must now be refused for everyone:
--   insert into public.projects (user_id, name, payload) values (auth.uid(), 'x', '{}');
