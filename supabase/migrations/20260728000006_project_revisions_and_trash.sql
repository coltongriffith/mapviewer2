-- ============================================================
-- Optimistic concurrency + recoverable deletion for cloud projects.
--
-- P1-01  saveCloudProject updated by id + user_id with no revision predicate,
--        so two tabs or two devices silently overwrote each other — the
--        second save won and the first user's work vanished with no signal.
--
-- P1-27  Deletion was immediate and permanent. One mis-click destroyed a
--        customer's project with no trash, history, or restore.
--
-- Saves now go through save_cloud_project(id, name, payload, expected_revision)
-- which compares and swaps inside the transaction. Deletion is a soft delete
-- with a 30-day restore window; trashed projects stop counting against the
-- free plan quota.
--
-- Rollback:
--   drop function if exists public.save_cloud_project(uuid, text, jsonb, integer);
--   drop function if exists public.trash_cloud_project(uuid);
--   drop function if exists public.restore_cloud_project(uuid);
--   alter table public.projects drop column if exists revision, drop column if exists deleted_at;
-- ============================================================

alter table public.projects
  add column if not exists revision integer not null default 1,
  add column if not exists deleted_at timestamptz;

create index if not exists projects_deleted_idx on public.projects (user_id, deleted_at);

-- Compare-and-swap save. Returns the new revision, or raises SAVE_CONFLICT
-- when the row moved on since the client last read it. A null expectation
-- means "overwrite deliberately" (the user chose to after being told).
create or replace function public.save_cloud_project(
  p_id uuid, p_name text, p_payload jsonb, p_expected_revision integer
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_current integer;
  v_new integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'project payload too large' using errcode = '22023';
  end if;

  select revision into v_current from public.projects
   where id = p_id and user_id = v_user and deleted_at is null
   for update;

  if v_current is null then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_current then
    raise exception 'SAVE_CONFLICT: project changed elsewhere (revision % vs %)',
      p_expected_revision, v_current using errcode = 'P0001';
  end if;

  v_new := v_current + 1;
  update public.projects
     set name = p_name, payload = p_payload, revision = v_new, updated_at = now()
   where id = p_id and user_id = v_user;
  return v_new;
end;
$$;

revoke all on function public.save_cloud_project(uuid, text, jsonb, integer) from public;
revoke execute on function public.save_cloud_project(uuid, text, jsonb, integer) from anon;
grant execute on function public.save_cloud_project(uuid, text, jsonb, integer) to authenticated;

-- ── Soft delete + restore (30-day window) ──────────────────────────────────
create or replace function public.trash_cloud_project(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid(); v_rows int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update public.projects set deleted_at = now()
   where id = p_id and user_id = v_user and deleted_at is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.restore_cloud_project(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid(); v_rows int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update public.projects set deleted_at = null
   where id = p_id and user_id = v_user and deleted_at is not null
     and deleted_at > now() - interval '30 days';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.trash_cloud_project(uuid) from public;
revoke all on function public.restore_cloud_project(uuid) from public;
revoke execute on function public.trash_cloud_project(uuid) from anon;
revoke execute on function public.restore_cloud_project(uuid) from anon;
grant execute on function public.trash_cloud_project(uuid) to authenticated;
grant execute on function public.restore_cloud_project(uuid) to authenticated;

-- ── Quota must ignore trashed projects ─────────────────────────────────────
create or replace function public.create_cloud_project(p_name text, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_plan text; v_source text; v_limit int; v_count int; v_id uuid;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_name is null or length(p_name) = 0 or length(p_name) > 200 then
    raise exception 'invalid project name' using errcode = '22023';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'project payload too large' using errcode = '22023';
  end if;

  select plan, source into v_plan, v_source from public.user_plans where user_id = v_user;

  if coalesce(v_plan, 'free') = 'pro' or coalesce(v_source, '') in ('grandfathered', 'admin') then
    v_limit := null;
  else
    v_limit := 2;
  end if;

  if v_limit is not null then
    perform 1 from public.projects where user_id = v_user and deleted_at is null for update;
    select count(*) into v_count from public.projects where user_id = v_user and deleted_at is null;
    if v_count >= v_limit then
      raise exception 'PROJECT_LIMIT: free plan allows % cloud projects', v_limit using errcode = 'P0001';
    end if;
  end if;

  insert into public.projects (user_id, name, payload, updated_at)
  values (v_user, p_name, p_payload, now())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_cloud_project(text, jsonb) from public;
revoke execute on function public.create_cloud_project(text, jsonb) from anon;
grant execute on function public.create_cloud_project(text, jsonb) to authenticated;
