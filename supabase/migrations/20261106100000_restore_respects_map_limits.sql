-- ============================================================
-- Restoring a map from the trash counts against the same limits as creating
-- one (docs/state-machines.md, ED-3).
--
-- Map lifecycle: active (deleted_at null) -> trashed (deleted_at set) ->
-- active again on restore, within 30 days. Creating a map checks the plan's
-- limit; restoring did not. A free user (limit 2) could create 2, trash 2,
-- create 2 more and restore the first 2, ending with 4 active maps, and a
-- company could exceed its workspace map limit the same way.
--
-- The check is a trigger, so it covers every path back to active: the
-- restore_cloud_project RPC, and a plain UPDATE of deleted_at by the owner of
-- a personal map (allowed by the row policy). It locks the same rows (personal)
-- or the same advisory key (company) as the create functions, so a restore
-- and a create cannot both take the last slot.
--
-- Rollback:
--   drop trigger if exists ws_c_restore_quota on public.projects;
--   drop function if exists public.ws_restore_quota();
-- ============================================================

create or replace function public.ws_restore_quota()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_limit int; v_count int;
begin
  if old.deleted_at is null or new.deleted_at is not null then
    return new;
  end if;

  if new.org_id is null then
    v_limit := public.ws_personal_map_limit(new.user_id);
    if v_limit is not null then
      perform 1 from public.projects
        where user_id = new.user_id and org_id is null and deleted_at is null for update;
      select count(*) into v_count from public.projects
        where user_id = new.user_id and org_id is null and deleted_at is null and id <> new.id;
      if v_count >= v_limit then
        raise exception 'PROJECT_LIMIT: free plan allows % cloud projects', v_limit using errcode = 'P0001';
      end if;
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('org-maps:' || new.org_id::text, 0));
    v_limit := public.org_map_limit(new.org_id);
    if v_limit is not null then
      select count(*) into v_count from public.projects
        where org_id = new.org_id and deleted_at is null and id <> new.id;
      if v_count >= v_limit then
        raise exception 'ORG_PROJECT_LIMIT: this workspace plan allows % maps', v_limit using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.ws_restore_quota() from public, anon, authenticated;

drop trigger if exists ws_c_restore_quota on public.projects;
create trigger ws_c_restore_quota
  before update of deleted_at on public.projects
  for each row execute function public.ws_restore_quota();
