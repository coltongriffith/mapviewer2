-- Company uses the existing Pro share allowance (200 per rolling hour).
-- Free/missing/unknown plans stay at 30; anonymous creator keys stay at 10.
-- API allowance and authoritative insertion limits must agree. No plan rows,
-- account assignments, tables or claim-monitoring limits are changed.
-- Prerequisites: shared_maps bounds/ownership from 20260728000004 and the
-- existing account plan limits from 20261001180000. Apply this correction
-- atomically with its capability RPC below. Older databases keep the API's
-- conservative 30-preview/90-search Company allowance until this is applied.
-- Source-only preparation: production application requires separate approval.
-- Rollback IN ONE TRANSACTION: revoke authenticated execution on
-- get_company_connector_allowance(), then restore create_shared_map from
-- 20261001180000_account_share_limits_by_plan.sql. Never restore only the quota
-- function while leaving a positive capability accessible. API checks the
-- marker on every Company request; an already in-flight insert is still bounded
-- by create_shared_map. This file is applied transactionally by apply-migration.
-- CREATE OR REPLACE preserves the function's existing explicit ACL.
create or replace function public.create_shared_map(p_state jsonb, p_creator_key text default null::text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_id text;
  v_recent int;
  v_bytes int;
  v_features int;
  v_limit int;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'SHARE_INVALID: share payload must be an object' using errcode = 'P0001';
  end if;

  v_bytes := pg_column_size(p_state);
  if v_bytes > 2 * 1024 * 1024 then
    raise exception 'SHARE_TOO_LARGE: share payload is % KB, limit is 2048 KB', v_bytes / 1024
      using errcode = 'P0001';
  end if;

  if not (p_state ? 'layers' or p_state ? 'layout') then
    raise exception 'SHARE_INVALID: share payload is not a project' using errcode = 'P0001';
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(l->'geojson'->'features', '[]'::jsonb))), 0)
    into v_features
  from jsonb_array_elements(coalesce(p_state->'layers', '[]'::jsonb)) l
  where jsonb_typeof(coalesce(l->'geojson'->'features', '[]'::jsonb)) = 'array';
  if v_features > 50000 then
    raise exception 'SHARE_TOO_COMPLEX: % features exceeds the 50000 feature share limit', v_features
      using errcode = 'P0001';
  end if;

  if v_user is not null then
    select case when up.plan in ('pro', 'company') then 200 else 30 end into v_limit
      from public.user_plans up where up.user_id = v_user;
    select count(*) into v_recent from public.shared_maps
      where user_id = v_user and created_at > now() - interval '1 hour';
    if v_recent >= coalesce(v_limit, 30) then
      raise exception 'SHARE_RATE_LIMIT: too many shares created recently' using errcode = 'P0001';
    end if;
  else
    if p_creator_key is null or length(p_creator_key) < 8 or length(p_creator_key) > 100 then
      raise exception 'SHARE_INVALID: missing creator key' using errcode = 'P0001';
    end if;
    select count(*) into v_recent from public.shared_maps
      where creator_key = p_creator_key and created_at > now() - interval '1 hour';
    if v_recent >= 10 then
      raise exception 'SHARE_RATE_LIMIT: too many shares created recently' using errcode = 'P0001';
    end if;
  end if;

  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into public.shared_maps (id, state, user_id, creator_key, expires_at)
  values (
    v_id, p_state, v_user,
    case when v_user is null then p_creator_key else null end,
    case when v_user is null then now() + interval '30 days' else null end
  );

  return v_id;
end;
$function$;

-- Read-only deployment capability, not a plan grant. The API separately checks
-- the authenticated account's stored plan; create_shared_map remains authoritative.
-- SECURITY INVOKER needs no table access, exposes no other account's data, and
-- cannot be used without an authenticated subject (even with a misplaced grant).
create or replace function public.get_company_connector_allowance()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select case when auth.uid() is null then null else
    jsonb_build_object('version', 1, 'subject', auth.uid(), 'previews', 200, 'searches', 600)
  end;
$function$;
revoke all on function public.get_company_connector_allowance() from public, anon;
grant execute on function public.get_company_connector_allowance() to authenticated;
