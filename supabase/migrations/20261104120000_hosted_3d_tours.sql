-- Optional hosted tour activation. Requires workspaces + three_d_projects.
-- Source only: applying this migration to production needs separate approval.
-- Store JSON, never uploaded executable HTML. Public reads are revalidated by
-- the trusted renderer. No bucket or broad storage policies are required.
create table if not exists public.three_d_tours (
  id text primary key default replace(gen_random_uuid()::text,'-','') check (id ~ '^[0-9a-f]{32}$'),
  project_id uuid not null references public.three_d_projects(id) on delete cascade,
  package jsonb,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((package is null) = (revoked_at is not null)),
  check (package is null or (jsonb_typeof(package)='object' and octet_length(package::text)<=3145728))
);
create unique index if not exists three_d_tours_active_project_idx on public.three_d_tours(project_id) where revoked_at is null;
alter table public.three_d_tours enable row level security;
revoke all on public.three_d_tours from public,anon,authenticated;

create or replace function public.publish_3d_tour(p_project uuid,p_package jsonb,p_expected_revision integer default null)
returns text language plpgsql security definer set search_path='' as $$
declare
  p public.three_d_projects%rowtype;
  t public.three_d_tours%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  -- Serialize publish/revoke with project deletion and ownership changes.
  select * into p from public.three_d_projects where id=p_project and deleted_at is null for update;
  if not found or (p.org_id is null and p.user_id is distinct from auth.uid())
     or (p.org_id is not null and not public.has_org_role(p.org_id,'editor')) then
    raise exception 'TOUR_NOT_FOUND' using errcode='P0002';
  end if;
  if p_package is null or jsonb_typeof(p_package)<>'object' or p_package->'v' is distinct from '1'::jsonb
     or not (p_package ?& array['holes','runs','claims','fpoly','collars','terrain','config','meta']) then
    raise exception 'TOUR_INVALID' using errcode='P0001';
  end if;
  if octet_length(p_package::text)>3145728 then raise exception 'TOUR_TOO_LARGE' using errcode='P0001'; end if;
  select * into t from public.three_d_tours where project_id=p_project and revoked_at is null for update;
  if found then
    if p_expected_revision is distinct from t.revision then raise exception 'TOUR_STALE' using errcode='P0001'; end if;
    if t.updated_at>now()-interval '10 seconds' then raise exception 'TOUR_RATE_LIMIT' using errcode='P0001'; end if;
    update public.three_d_tours set package=p_package,revision=revision+1,updated_at=now() where id=t.id;
    return t.id;
  end if;
  if p_expected_revision is not null then raise exception 'TOUR_STALE' using errcode='P0001'; end if;
  insert into public.three_d_tours(project_id,package) values(p_project,p_package) returning id into t.id;
  return t.id;
end $$;

create or replace function public.get_3d_tour_info(p_project uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',t.id,'revision',t.revision,'updated_at',t.updated_at)
  from public.three_d_tours t join public.three_d_projects p on p.id=t.project_id
  where t.project_id=p_project and t.revoked_at is null and p.deleted_at is null
    and ((p.org_id is null and p.user_id=auth.uid()) or (p.org_id is not null and public.has_org_role(p.org_id,'editor')))
$$;

create or replace function public.get_3d_tour(p_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select t.package from public.three_d_tours t join public.three_d_projects p on p.id=t.project_id
  where t.id=p_id and t.revoked_at is null and p.deleted_at is null
$$;

create or replace function public.revoke_3d_tour(p_project uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare p public.three_d_projects%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select * into p from public.three_d_projects where id=p_project and deleted_at is null for update;
  if not found or (p.org_id is null and p.user_id is distinct from auth.uid())
     or (p.org_id is not null and not public.has_org_role(p.org_id,'editor')) then
    raise exception 'TOUR_NOT_FOUND' using errcode='P0002';
  end if;
  update public.three_d_tours set package=null,revoked_at=now(),updated_at=now() where project_id=p_project and revoked_at is null;
  return found;
end $$;

-- Soft deletion or a move between ownership scopes withdraws public data.
-- Hard deletion cascades. Restoring a figure never revives a revoked link.
create or replace function public.withdraw_changed_3d_tours()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.deleted_at is not null or old.org_id is distinct from new.org_id or old.user_id is distinct from new.user_id then
    update public.three_d_tours set package=null,revoked_at=now(),updated_at=now() where project_id=old.id and revoked_at is null;
  end if;
  return new;
end $$;
drop trigger if exists withdraw_changed_3d_tours on public.three_d_projects;
create trigger withdraw_changed_3d_tours after update of deleted_at,org_id,user_id on public.three_d_projects
  for each row execute function public.withdraw_changed_3d_tours();

revoke all on function public.publish_3d_tour(uuid,jsonb,integer),public.get_3d_tour_info(uuid),public.get_3d_tour(text),public.revoke_3d_tour(uuid),public.withdraw_changed_3d_tours() from public,anon,authenticated;
grant execute on function public.publish_3d_tour(uuid,jsonb,integer),public.get_3d_tour_info(uuid),public.revoke_3d_tour(uuid) to authenticated;
grant execute on function public.get_3d_tour(text) to anon,authenticated;
