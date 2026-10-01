-- Raise the anonymous share allowance from 3 to 10 per creator key per rolling
-- hour. The MCP connector's free preview limit (api/mcp.js
-- FREE_PREVIEWS_PER_HOUR) reads back this same count, so the two must match;
-- browser shares without an account get the same allowance.
--
-- Rollback: re-run this function with `v_recent >= 3` in the anonymous branch.
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
    select count(*) into v_recent from public.shared_maps
      where user_id = v_user and created_at > now() - interval '1 hour';
    if v_recent >= 10 then
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
