-- ============================================================
-- Company workspaces, Phase 1A: organizations with roles, invites, an
-- activity log, and Properties (exploration projects) that own maps, 3D
-- figures and claim portfolios.
--
-- ROLES  viewer < editor < admin < owner
--   viewer  read everything in the workspace (investors, JV partners, auditors)
--   editor  create and change properties, maps, figures (geologists, consultants)
--   admin   + invite, change roles (not owners'), delete (soft) properties,
--             maps and 3D figures, move items back to a personal account
--   owner   + everything about owners. An organization always keeps one.
--
-- OWNERSHIP OF A ROW
--   Personal rows (org_id is null) behave exactly as before: owner-only by
--   user_id, and the free-plan map quota counts only them.
--   Org rows (org_id set) are governed by the caller's role in that org;
--   user_id stays as "created by" and grants nothing on its own, so somebody
--   removed from a company loses access to the company's maps.
--   Ownership columns (user_id, org_id, property_id) never change through a
--   plain UPDATE from the browser: only move_to_property / move_to_personal
--   move a row, so every move is authorized and logged.
--
-- 3D FIGURE FILES
--   Org figures keep their files in three-d-files under org/<org>/<id>/...,
--   readable by members and writable by editors; personal figures stay under
--   <uid>/<id>/... The browser copies a figure's files to the destination
--   folder first (it can read the source and write the target), then calls
--   move_to_*; the RPC checks every file exists at the new path before it
--   switches the row, so a figure never points at files its new readers
--   cannot open. Old copies are removed best-effort by the browser.
--
-- CLAIM PORTFOLIOS
--   Portfolios stay owned by their user (plan quota, alert policy and the
--   nightly alert job are untouched). Linking one to a property only sets
--   org_id/property_id; members read it through get_property_claims(), which
--   leaves every tenure-monitor policy and RPC exactly as it was.
--
-- Idempotent: guarded blocks; no statement starts with DROP/TRUNCATE/DELETE.
-- Depends on: baseline, 20260728000006 (project revisions), 20260801000002
-- (portfolios), 20261022100000 (three_d_projects), vault + pg_net + pgcrypto
-- (extensions schema) as used by 20261020120000.
-- ============================================================

-- ── 1. Organizations ─────────────────────────────────────────────────────
-- Pricing hooks only: per-company billing comes later. plan drives the
-- placeholder org quota below.
alter table public.organizations
  add column if not exists slug text,
  add column if not exists plan text not null default 'free',
  add column if not exists billing_customer_id text,
  add column if not exists seats_included integer,
  add column if not exists updated_at timestamptz not null default now();

update public.organizations set created_at = now() where created_at is null;
alter table public.organizations alter column created_at set default now();
alter table public.organizations alter column created_at set not null;
-- owner_id is now "created by". Roles live in organization_members; deleting
-- the creator's account must not delete the company with it.
alter table public.organizations alter column owner_id drop not null;
alter table public.organizations alter column owner_id set default auth.uid();

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'organizations_owner_id_fkey'
             and conrelid = 'public.organizations'::regclass and confdeltype <> 'n') then
    alter table public.organizations drop constraint organizations_owner_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_owner_id_fkey'
                 and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_owner_id_fkey
      foreign key (owner_id) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_name_check'
                 and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_name_check
      check (char_length(btrim(name)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_slug_check'
                 and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_slug_check
      check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_plan_check'
                 and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_plan_check
      check (plan ~ '^[a-z_]{1,40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_seats_check'
                 and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_seats_check
      check (seats_included is null or seats_included >= 0);
  end if;
end $$;

create unique index if not exists organizations_slug_key on public.organizations (slug);

-- ── 2. Memberships and roles ─────────────────────────────────────────────
update public.organization_members set role = 'editor' where role = 'member';
alter table public.organization_members alter column role set default 'viewer';
alter table public.organization_members alter column joined_at set default now();

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'organization_members_role_check'
             and conrelid = 'public.organization_members'::regclass
             and pg_get_constraintdef(oid) not like '%viewer%') then
    alter table public.organization_members drop constraint organization_members_role_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organization_members_role_check'
                 and conrelid = 'public.organization_members'::regclass) then
    alter table public.organization_members add constraint organization_members_role_check
      check (role in ('owner', 'admin', 'editor', 'viewer'));
  end if;
end $$;

create index if not exists organization_members_user_idx on public.organization_members (user_id);

-- ── 3. Helpers ───────────────────────────────────────────────────────────
-- SECURITY DEFINER so RLS policies can ask "what is my role here?" without
-- re-entering organization_members' own policies (no recursion).
create or replace function public.ws_role_rank(p_role text)
returns integer language sql immutable set search_path = '' as $$
  select case p_role when 'viewer' then 1 when 'editor' then 2 when 'admin' then 3 when 'owner' then 4 else 0 end
$$;

create or replace function public.org_role(p_org uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m
  where m.org_id = p_org and m.user_id = auth.uid()
$$;

create or replace function public.has_org_role(p_org uuid, p_min_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.ws_role_rank(p_min_role) > 0
    and public.ws_role_rank(public.org_role(p_org)) >= public.ws_role_rank(p_min_role),
    false)
$$;

-- Text to uuid without throwing (storage paths are user input).
create or replace function public.ws_uuid(p text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

create or replace function public.ws_slugify(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), '-'), 60), '')
$$;

create or replace function public.ws_user_email(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select u.email::text from auth.users u where u.id = p_user
$$;



-- ── 4. Properties ────────────────────────────────────────────────────────
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  -- Codes from src/utils/jurisdictions.js (PROPERTY_JURISDICTIONS): 'bc',
  -- 'on', 'us-nv', ... or 'other'.
  jurisdiction text check (jurisdiction is null or jurisdiction ~ '^[a-z]{2}(-[a-z]{2})?$' or jurisdiction = 'other'),
  commodities text[] not null default '{}' check (cardinality(commodities) <= 20),
  status text not null default 'active' check (status in ('active', 'option', 'sold', 'dormant')),
  description text check (description is null or char_length(description) <= 5000),
  centroid_lon double precision check (centroid_lon is null or centroid_lon between -180 and 180),
  centroid_lat double precision check (centroid_lat is null or centroid_lat between -90 and 90),
  crs text check (crs is null or crs ~ '^EPSG:[0-9]{4,6}$'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists properties_org_slug_live
  on public.properties (org_id, slug) where deleted_at is null;
create index if not exists properties_org_idx on public.properties (org_id, name);

-- Org of a live property the caller belongs to (null when missing,
-- soft-deleted or not theirs, so it reveals nothing about other companies).
-- With no signed-in user (service role, maintenance) it is not gated; anon
-- cannot execute it.
create or replace function public.ws_property_org(p_property uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.org_id from public.properties p
  where p.id = p_property and p.deleted_at is null
    and (auth.uid() is null or public.has_org_role(p.org_id, 'viewer'))
$$;



create or replace function public.properties_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_base text;
  v_slug text;
  i integer := 1;
begin
  if tg_op = 'INSERT' then
    v_base := coalesce(public.ws_slugify(new.slug), public.ws_slugify(new.name), 'property');
    v_slug := v_base;
    while exists (select 1 from public.properties p where p.org_id = new.org_id and p.slug = v_slug and p.deleted_at is null) loop
      i := i + 1;
      v_slug := left(v_base, 70) || '-' || i;
    end loop;
    new.slug := v_slug;
    new.name := btrim(new.name);
    new.created_at := now();
    new.updated_at := now();
    if current_user in ('authenticated', 'anon') then
      new.created_by := auth.uid();
      new.deleted_at := null;
    end if;
    return new;
  end if;
  -- UPDATE
  if current_user in ('authenticated', 'anon') then
    if new.id <> old.id or new.org_id <> old.org_id or new.slug <> old.slug
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'PROPERTY_IMMUTABLE: id, workspace, slug and creator cannot change' using errcode = '42501';
    end if;
    if new.deleted_at is distinct from old.deleted_at then
      if not public.has_org_role(old.org_id, 'admin') then
        raise exception 'forbidden: only an admin can delete a property' using errcode = '42501';
      end if;
      if new.deleted_at is not null and public.ws_property_has_content(old.id) then
        raise exception 'PROPERTY_NOT_EMPTY: move its maps, 3D figures and claim portfolios out first' using errcode = 'P0001';
      end if;
    end if;
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'properties_guard' and tgrelid = 'public.properties'::regclass) then
    create trigger properties_guard before insert or update on public.properties
      for each row execute function public.properties_guard();
  end if;
end $$;

alter table public.properties enable row level security;
revoke all on table public.properties from anon, authenticated;
grant select, insert, update on table public.properties to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'properties'
                 and policyname = 'Members read properties') then
    create policy "Members read properties" on public.properties for select to authenticated
      using (public.has_org_role(org_id, 'viewer') and (deleted_at is null or public.has_org_role(org_id, 'admin')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'properties'
                 and policyname = 'Editors create properties') then
    create policy "Editors create properties" on public.properties for insert to authenticated
      with check (public.has_org_role(org_id, 'editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'properties'
                 and policyname = 'Editors update properties') then
    create policy "Editors update properties" on public.properties for update to authenticated
      using (deleted_at is null and public.has_org_role(org_id, 'editor'))
      with check (public.has_org_role(org_id, 'editor'));
  end if;
end $$;

-- ── 5. Organization and membership policies ──────────────────────────────
-- The baseline's "own orgs" / "own memberships" were FOR ALL on the row's own
-- user id: anyone could have inserted themselves into any organization as
-- owner. Memberships now change only through the RPCs below.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organizations' and policyname = 'own orgs') then
    drop policy "own orgs" on public.organizations;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_members' and policyname = 'own memberships') then
    drop policy "own memberships" on public.organization_members;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organizations'
                 and policyname = 'Members read their organizations') then
    create policy "Members read their organizations" on public.organizations for select to authenticated
      using (public.has_org_role(id, 'viewer'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_members'
                 and policyname = 'Members read memberships') then
    create policy "Members read memberships" on public.organization_members for select to authenticated
      using (public.has_org_role(org_id, 'viewer'));
  end if;
end $$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
revoke all on table public.organizations, public.organization_members from anon, authenticated;
-- billing_customer_id stays server-side.
grant select (id, name, slug, plan, seats_included, owner_id, created_at, updated_at)
  on table public.organizations to authenticated;
grant select on table public.organization_members to authenticated;

-- ── 6. Activity log ──────────────────────────────────────────────────────
create table if not exists public.org_activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  actor uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created', 'updated', 'deleted', 'moved', 'role_changed', 'invited', 'joined', 'removed')),
  entity_type text not null check (entity_type in ('organization', 'property', 'map', 'figure', 'portfolio', 'member', 'invite')),
  entity_id uuid,
  summary text not null check (char_length(summary) <= 500),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists org_activity_org_idx on public.org_activity (org_id, created_at desc);
create index if not exists org_activity_property_idx on public.org_activity (property_id, created_at desc) where property_id is not null;
create index if not exists org_activity_entity_idx on public.org_activity (entity_id, created_at desc);

alter table public.org_activity enable row level security;
revoke all on table public.org_activity from anon, authenticated;
grant select on table public.org_activity to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'org_activity'
                 and policyname = 'Members read activity') then
    create policy "Members read activity" on public.org_activity for select to authenticated
      using (public.has_org_role(org_id, 'viewer'));
  end if;
end $$;

-- Append-only for everyone. The only changes allowed are the foreign keys'
-- own "set null" (a deleted account or property) and the cascade when the
-- organization itself is gone.
create or replace function public.org_activity_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.organizations o where o.id = old.org_id) then
      raise exception 'org_activity is append-only' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.id = old.id and new.org_id = old.org_id and new.action = old.action
     and new.entity_type = old.entity_type and new.entity_id is not distinct from old.entity_id
     and new.summary = old.summary and new.detail = old.detail and new.created_at = old.created_at
     and (new.actor is not distinct from old.actor or new.actor is null)
     and (new.property_id is not distinct from old.property_id or new.property_id is null) then
    return new;
  end if;
  raise exception 'org_activity is append-only' using errcode = '42501';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'org_activity_immutable' and tgrelid = 'public.org_activity'::regclass) then
    create trigger org_activity_immutable before update or delete on public.org_activity
      for each row execute function public.org_activity_immutable();
  end if;
end $$;

create or replace function public.log_org_activity(
  p_org uuid, p_property uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_summary text, p_detail jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if p_org is null or not exists (select 1 from public.organizations o where o.id = p_org) then
    return; -- the organization is being deleted; nothing to log against
  end if;
  -- Autosave writes every few seconds: one "updated" per actor and entity
  -- per ten minutes is the record people want.
  if p_action = 'updated' and exists (
    select 1 from public.org_activity a
    where a.entity_id = p_entity_id and a.org_id = p_org and a.entity_type = p_entity_type
      and a.actor is not distinct from v_actor and a.action in ('updated', 'created')
      and a.created_at > now() - interval '10 minutes'
  ) then
    return;
  end if;
  if p_property is not null and not exists (select 1 from public.properties p where p.id = p_property) then
    p_property := null;
  end if;
  insert into public.org_activity (org_id, property_id, actor, action, entity_type, entity_id, summary, detail)
  values (p_org, p_property, v_actor, p_action, p_entity_type, p_entity_id,
          left(coalesce(p_summary, p_action), 500), coalesce(p_detail, '{}'::jsonb));
end;
$$;

-- ── 7. Ownership links on maps, figures and portfolios ───────────────────
alter table public.projects add column if not exists property_id uuid;
alter table public.three_d_projects add column if not exists org_id uuid;
alter table public.three_d_projects add column if not exists property_id uuid;
alter table public.monitored_portfolios add column if not exists property_id uuid;

-- Content still attached to a property (blocks a soft delete that would hide it).
create or replace function public.ws_property_has_content(p_property uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_org_role((select p.org_id from public.properties p where p.id = p_property), 'viewer') and (
         exists (select 1 from public.projects where property_id = p_property and deleted_at is null)
      or exists (select 1 from public.three_d_projects where property_id = p_property and deleted_at is null)
      or exists (select 1 from public.monitored_portfolios where property_id = p_property))
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_property_id_fkey' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_property_id_fkey
      foreign key (property_id) references public.properties(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'three_d_projects_org_id_fkey' and conrelid = 'public.three_d_projects'::regclass) then
    alter table public.three_d_projects add constraint three_d_projects_org_id_fkey
      foreign key (org_id) references public.organizations(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'three_d_projects_property_id_fkey' and conrelid = 'public.three_d_projects'::regclass) then
    alter table public.three_d_projects add constraint three_d_projects_property_id_fkey
      foreign key (property_id) references public.properties(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monitored_portfolios_org_id_fkey' and conrelid = 'public.monitored_portfolios'::regclass) then
    alter table public.monitored_portfolios add constraint monitored_portfolios_org_id_fkey
      foreign key (org_id) references public.organizations(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monitored_portfolios_property_id_fkey' and conrelid = 'public.monitored_portfolios'::regclass) then
    alter table public.monitored_portfolios add constraint monitored_portfolios_property_id_fkey
      foreign key (property_id) references public.properties(id) on delete set null;
  end if;
end $$;

create index if not exists projects_org_property_idx
  on public.projects (org_id, property_id, updated_at desc) where org_id is not null;
create index if not exists three_d_projects_org_property_idx
  on public.three_d_projects (org_id, property_id, updated_at desc) where org_id is not null;
create index if not exists monitored_portfolios_property_idx
  on public.monitored_portfolios (property_id) where property_id is not null;

-- Browser UPDATEs never move a row between owners (see header). Runs as the
-- caller (no SECURITY DEFINER) so current_user tells a PostgREST request from
-- one of the move RPCs below or a foreign-key action.
--
-- Deleting (or restoring) a company map or 3D figure is an admin decision,
-- whichever path it takes: a direct UPDATE of deleted_at, a 3D upsert, or
-- trash_cloud_project / restore_cloud_project. Editors can edit company work
-- but not remove it, the same rule as for properties. Applies to every
-- signed-in caller, RPCs included; the service role and foreign-key actions
-- (no auth.uid()) are not affected.
create or replace function public.ws_guard_ownership()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.user_id is distinct from old.user_id or new.org_id is distinct from old.org_id
          or new.property_id is distinct from old.property_id) then
    raise exception 'OWNERSHIP_CHANGE: use move_to_property or move_to_personal' using errcode = '42501';
  end if;
  -- Field access, not to_jsonb(): a map row carries up to 8 MB of payload.
  -- Nested so deleted_at is only read on the tables that have it.
  if tg_table_name in ('projects', 'three_d_projects') and old.org_id is not null and auth.uid() is not null then
    if new.deleted_at is distinct from old.deleted_at and not public.has_org_role(old.org_id, 'admin') then
      raise exception 'forbidden: only an owner or admin can delete or restore company work' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- A property link must point at a live property of the same organization; a
-- row that leaves its organization (org_id null) drops its property too.
create or replace function public.ws_check_property_link()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id is null then
    new.property_id := null;
    return new;
  end if;
  if new.property_id is not null
     and (tg_op = 'INSERT' or new.property_id is distinct from old.property_id or new.org_id is distinct from old.org_id)
     and public.ws_property_org(new.property_id) is distinct from new.org_id then
    raise exception 'PROPERTY_ORG_MISMATCH: that property is not in this workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['projects', 'three_d_projects', 'monitored_portfolios'] loop
    if not exists (select 1 from pg_trigger where tgname = 'ws_a_guard_ownership' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger ws_a_guard_ownership before update on public.%I for each row execute function public.ws_guard_ownership()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'ws_b_property_link' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger ws_b_property_link before insert or update on public.%I for each row execute function public.ws_check_property_link()', t);
    end if;
  end loop;
end $$;

-- ── 8. Maps (projects): personal policies unchanged, org policies added ──
-- Every existing owner policy gains "and org_id is null" (the production
-- database also carries a legacy FOR ALL "own projects" policy and an INSERT
-- policy that the baseline does not; both are covered).
do $$
declare r record;
begin
  for r in select policyname, cmd from pg_policies
           where schemaname = 'public' and tablename = 'projects'
             and policyname in ('users select own projects', 'users update own projects',
                                'users delete own projects', 'own projects', 'users insert own projects') loop
    if r.cmd in ('SELECT', 'DELETE') then
      execute format('alter policy %I on public.projects using (auth.uid() = user_id and org_id is null)', r.policyname);
    elsif r.cmd = 'INSERT' then
      execute format('alter policy %I on public.projects with check (auth.uid() = user_id and org_id is null)', r.policyname);
    else
      execute format('alter policy %I on public.projects using (auth.uid() = user_id and org_id is null) with check (auth.uid() = user_id and org_id is null)', r.policyname);
    end if;
  end loop;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects'
                 and policyname = 'Org members read org maps') then
    create policy "Org members read org maps" on public.projects for select to authenticated
      using (org_id is not null and public.has_org_role(org_id, 'viewer'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects'
                 and policyname = 'Org editors update org maps') then
    create policy "Org editors update org maps" on public.projects for update to authenticated
      using (org_id is not null and public.has_org_role(org_id, 'editor'))
      with check (org_id is not null and public.has_org_role(org_id, 'editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects'
                 and policyname = 'Org admins delete org maps') then
    create policy "Org admins delete org maps" on public.projects for delete to authenticated
      using (org_id is not null and public.has_org_role(org_id, 'admin'));
  end if;
end $$;

-- The free-plan limit for personal maps, unchanged (mirrors
-- src/utils/entitlements.js): free 2, pro / grandfathered / admin unlimited.
create or replace function public.ws_personal_map_limit(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select case when coalesce(max(up.plan), 'free') = 'pro' or coalesce(max(up.source), '') in ('grandfathered', 'admin')
              then null else 2 end
  from public.user_plans up where up.user_id = p_user
$$;

-- Placeholder company quota until per-company billing exists.
create or replace function public.org_map_limit(p_org uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select case coalesce((select o.plan from public.organizations o where o.id = p_org), 'free')
           when 'free' then 25 else null end
$$;

-- Same function, same semantics, except that maps owned by a company no
-- longer count against the person who created them.
create or replace function public.create_cloud_project(p_name text, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limit int; v_count int; v_id uuid;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_name is null or length(p_name) = 0 or length(p_name) > 200 then
    raise exception 'invalid project name' using errcode = '22023';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'project payload too large' using errcode = '22023';
  end if;

  v_limit := public.ws_personal_map_limit(v_user);

  if v_limit is not null then
    perform 1 from public.projects where user_id = v_user and org_id is null and deleted_at is null for update;
    select count(*) into v_count from public.projects where user_id = v_user and org_id is null and deleted_at is null;
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

-- Compare-and-swap save. Personal maps: the owner, exactly as before. Org
-- maps: editors and up; a viewer gets ORG_READ_ONLY rather than a silent no-op.
create or replace function public.save_cloud_project(
  p_id uuid, p_name text, p_payload jsonb, p_expected_revision integer
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_current integer;
  v_org uuid;
  v_new integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'project payload too large' using errcode = '22023';
  end if;

  select p.revision, p.org_id into v_current, v_org from public.projects p
   where p.id = p_id and p.deleted_at is null
     and ((p.org_id is null and p.user_id = v_user)
          or (p.org_id is not null and public.has_org_role(p.org_id, 'viewer')))
   for update;

  if v_current is null then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_org is not null and not public.has_org_role(v_org, 'editor') then
    raise exception 'ORG_READ_ONLY: you have view-only access to this map' using errcode = '42501';
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_current then
    raise exception 'SAVE_CONFLICT: project changed elsewhere (revision % vs %)',
      p_expected_revision, v_current using errcode = 'P0001';
  end if;

  v_new := v_current + 1;
  update public.projects
     set name = p_name, payload = p_payload, revision = v_new, updated_at = now()
   where id = p_id;
  return v_new;
end;
$$;

-- Trash and restore: personal maps by their owner as before; company maps by
-- admins and up only, as for 3D figures and properties (ws_guard_ownership).
create or replace function public.trash_cloud_project(p_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_rows int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update public.projects p set deleted_at = now()
   where p.id = p_id and p.deleted_at is null
     and ((p.org_id is null and p.user_id = v_user)
          or (p.org_id is not null and public.has_org_role(p.org_id, 'admin')));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.restore_cloud_project(p_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_rows int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update public.projects p set deleted_at = null
   where p.id = p_id and p.deleted_at is not null
     and p.deleted_at > now() - interval '30 days'
     and ((p.org_id is null and p.user_id = v_user)
          or (p.org_id is not null and public.has_org_role(p.org_id, 'admin')));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- A new map inside a property. Does not touch the creator's personal quota.
create or replace function public.create_org_project(p_property uuid, p_name text, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_limit int; v_count int; v_id uuid;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_name is null or length(p_name) = 0 or length(p_name) > 200 then
    raise exception 'invalid project name' using errcode = '22023';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'project payload too large' using errcode = '22023';
  end if;
  v_org := public.ws_property_org(p_property);
  if v_org is null or not public.has_org_role(v_org, 'viewer') then
    raise exception 'PROPERTY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_org, 'editor') then
    raise exception 'ORG_READ_ONLY: viewers cannot add maps' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('org-maps:' || v_org::text, 0));
  v_limit := public.org_map_limit(v_org);
  if v_limit is not null then
    select count(*) into v_count from public.projects where org_id = v_org and deleted_at is null;
    if v_count >= v_limit then
      raise exception 'ORG_PROJECT_LIMIT: this workspace plan allows % maps', v_limit using errcode = 'P0001';
    end if;
  end if;

  insert into public.projects (user_id, org_id, property_id, name, payload, updated_at)
  values (v_user, v_org, p_property, p_name, p_payload, now())
  returning id into v_id;
  return v_id;
end;
$$;

-- ── 9. 3D figures: same split, plus org storage folders ─────────────────
do $$
declare r record;
begin
  for r in select policyname, cmd from pg_policies
           where schemaname = 'public' and tablename = 'three_d_projects'
             and policyname in ('Owners read their 3D projects', 'Owners create their 3D projects',
                                'Owners update their 3D projects', 'Owners delete their 3D projects') loop
    if r.cmd in ('SELECT', 'DELETE') then
      execute format('alter policy %I on public.three_d_projects using ((select auth.uid()) = user_id and org_id is null)', r.policyname);
    elsif r.cmd = 'INSERT' then
      execute format('alter policy %I on public.three_d_projects with check ((select auth.uid()) = user_id and org_id is null)', r.policyname);
    else
      execute format('alter policy %I on public.three_d_projects using ((select auth.uid()) = user_id and org_id is null) with check ((select auth.uid()) = user_id and org_id is null)', r.policyname);
    end if;
  end loop;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'three_d_projects'
                 and policyname = 'Org members read org 3D projects') then
    create policy "Org members read org 3D projects" on public.three_d_projects for select to authenticated
      using (org_id is not null and public.has_org_role(org_id, 'viewer'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'three_d_projects'
                 and policyname = 'Org editors create org 3D projects') then
    create policy "Org editors create org 3D projects" on public.three_d_projects for insert to authenticated
      with check (org_id is not null and user_id = (select auth.uid()) and public.has_org_role(org_id, 'editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'three_d_projects'
                 and policyname = 'Org editors update org 3D projects') then
    create policy "Org editors update org 3D projects" on public.three_d_projects for update to authenticated
      using (org_id is not null and public.has_org_role(org_id, 'editor'))
      with check (org_id is not null and public.has_org_role(org_id, 'editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'three_d_projects'
                 and policyname = 'Org admins delete org 3D projects') then
    create policy "Org admins delete org 3D projects" on public.three_d_projects for delete to authenticated
      using (org_id is not null and public.has_org_role(org_id, 'admin'));
  end if;
end $$;

-- Organization of an org/<org id>/... object name; null for anything else,
-- including names with "." or ".." segments.
create or replace function public.ws_storage_org(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_name is null or p_name ~ '(^|/)\.\.?(/|$)' or p_name like '%\\%' then null
    when split_part(p_name, '/', 1) = 'org' and split_part(p_name, '/', 3) <> '' and split_part(p_name, '/', 4) <> ''
      then public.ws_uuid(split_part(p_name, '/', 2))
  end
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Org members read org 3D files') then
    create policy "Org members read org 3D files" on storage.objects for select to authenticated
      using (bucket_id = 'three-d-files' and public.has_org_role(public.ws_storage_org(name), 'viewer'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Org editors upload org 3D files') then
    create policy "Org editors upload org 3D files" on storage.objects for insert to authenticated
      with check (bucket_id = 'three-d-files' and public.has_org_role(public.ws_storage_org(name), 'editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Org editors replace org 3D files') then
    create policy "Org editors replace org 3D files" on storage.objects for update to authenticated
      using (bucket_id = 'three-d-files' and public.has_org_role(public.ws_storage_org(name), 'editor'))
      with check (bucket_id = 'three-d-files' and public.has_org_role(public.ws_storage_org(name), 'editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Org editors delete org 3D files') then
    create policy "Org editors delete org 3D files" on storage.objects for delete to authenticated
      using (bucket_id = 'three-d-files' and public.has_org_role(public.ws_storage_org(name), 'editor'));
  end if;
end $$;

-- Folder a figure's files live in, with a trailing slash.
create or replace function public.ws_figure_root(p_org uuid, p_owner uuid, p_id uuid)
returns text language sql immutable set search_path = '' as $$
  select case when p_org is null then p_owner::text || '/' || p_id::text || '/'
              else 'org/' || p_org::text || '/' || p_id::text || '/' end
$$;

-- file_paths with every path moved from p_src to p_dst, after checking each
-- file is already at its new name (the browser copies before it moves).
create or replace function public.ws_rebase_figure_files(p_paths jsonb, p_src text, p_dst text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  e jsonb;
  v_path text;
  v_new text;
begin
  for e in select value from jsonb_array_elements(coalesce(p_paths, '[]'::jsonb)) loop
    v_path := e ->> 'path';
    if v_path is null or left(v_path, length(p_src)) <> p_src or v_path ~ '(^|/)\.\.?(/|$)' then
      raise exception 'FILE_PATH_UNEXPECTED: a file of this figure is outside its folder' using errcode = 'P0001';
    end if;
    v_new := p_dst || substr(v_path, length(p_src) + 1);
    if not exists (select 1 from storage.objects o where o.bucket_id = 'three-d-files' and o.name = v_new) then
      raise exception 'FILES_NOT_COPIED: % has not been copied yet', v_new using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_set(e, '{path}', to_jsonb(v_new)));
  end loop;
  return v_out;
end;
$$;

-- ── 10. Moving between owners ────────────────────────────────────────────
-- May the caller take this row out of where it is and into p_target_org?
-- Its personal owner; an editor of its organization for a move between that
-- organization's own properties; an admin of its organization for a move to
-- another company (taking work out of a company is an admin decision, as in
-- move_to_personal).
create or replace function public.ws_can_edit_source(p_org uuid, p_owner uuid, p_target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_org is null then p_owner = auth.uid()
    when p_org = p_target_org then public.has_org_role(p_org, 'editor')
    else public.has_org_role(p_org, 'admin')
  end
$$;

create or replace function public.move_to_property(p_kind text, p_id uuid, p_property uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_src_org uuid;
  v_src_owner uuid;
  v_paths jsonb;
  v_limit int;
  v_count int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('map', 'figure', 'portfolio') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  v_org := public.ws_property_org(p_property);
  if v_org is null or not public.has_org_role(v_org, 'viewer') then
    raise exception 'PROPERTY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_org, 'editor') then
    raise exception 'forbidden: editors and up can add to a property' using errcode = '42501';
  end if;

  if p_kind = 'map' then
    select p.org_id, p.user_id into v_src_org, v_src_owner from public.projects p
     where p.id = p_id and p.deleted_at is null for update;
    if not found or not public.ws_can_edit_source(v_src_org, v_src_owner, v_org) then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_src_org is distinct from v_org then
      perform pg_advisory_xact_lock(hashtextextended('org-maps:' || v_org::text, 0));
      v_limit := public.org_map_limit(v_org);
      if v_limit is not null then
        select count(*) into v_count from public.projects where org_id = v_org and deleted_at is null;
        if v_count >= v_limit then
          raise exception 'ORG_PROJECT_LIMIT: this workspace plan allows % maps', v_limit using errcode = 'P0001';
        end if;
      end if;
    end if;
    update public.projects set org_id = v_org, property_id = p_property where id = p_id;

  elsif p_kind = 'figure' then
    select t.org_id, t.user_id, t.file_paths into v_src_org, v_src_owner, v_paths from public.three_d_projects t
     where t.id = p_id and t.deleted_at is null for update;
    if not found or not public.ws_can_edit_source(v_src_org, v_src_owner, v_org) then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_src_org is distinct from v_org then
      v_paths := public.ws_rebase_figure_files(v_paths,
        public.ws_figure_root(v_src_org, v_src_owner, p_id), public.ws_figure_root(v_org, null, p_id));
    end if;
    update public.three_d_projects set org_id = v_org, property_id = p_property, file_paths = v_paths where id = p_id;

  else
    -- Portfolios stay owned by their user (quota, alerts); linking only
    -- tells the property which portfolio holds its claims.
    select m.org_id, m.user_id into v_src_org, v_src_owner from public.monitored_portfolios m
     where m.id = p_id for update;
    if not found or not public.ws_can_edit_source(v_src_org, v_src_owner, v_org) then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    update public.monitored_portfolios set org_id = v_org, property_id = p_property where id = p_id;
  end if;

  return jsonb_build_object('kind', p_kind, 'id', p_id, 'org_id', v_org, 'property_id', p_property);
end;
$$;

create or replace function public.move_to_personal(p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_owner uuid;
  v_paths jsonb;
  v_limit int;
  v_count int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('map', 'figure', 'portfolio') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;

  if p_kind = 'map' then
    select p.org_id into v_org from public.projects p where p.id = p_id and p.deleted_at is null for update;
  elsif p_kind = 'figure' then
    select t.org_id, t.user_id, t.file_paths into v_org, v_owner, v_paths from public.three_d_projects t
     where t.id = p_id and t.deleted_at is null for update;
  else
    select m.org_id, m.user_id into v_org, v_owner from public.monitored_portfolios m where m.id = p_id for update;
  end if;
  if v_org is null or not (public.has_org_role(v_org, 'viewer') or (p_kind = 'portfolio' and v_owner = v_user)) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- A portfolio's owner can always take it back (it is their plan and their
  -- alert emails), even after leaving the company.
  if not public.has_org_role(v_org, 'admin') and not (p_kind = 'portfolio' and v_owner = v_user) then
    raise exception 'forbidden: only an owner or admin can move work out of the workspace' using errcode = '42501';
  end if;

  if p_kind = 'map' then
    -- It joins the caller's personal maps, so their plan limit applies.
    v_limit := public.ws_personal_map_limit(v_user);
    if v_limit is not null then
      perform 1 from public.projects where user_id = v_user and org_id is null and deleted_at is null for update;
      select count(*) into v_count from public.projects where user_id = v_user and org_id is null and deleted_at is null;
      if v_count >= v_limit then
        raise exception 'PROJECT_LIMIT: free plan allows % cloud projects', v_limit using errcode = 'P0001';
      end if;
    end if;
    update public.projects set user_id = v_user, org_id = null, property_id = null where id = p_id;
  elsif p_kind = 'figure' then
    v_paths := public.ws_rebase_figure_files(v_paths,
      public.ws_figure_root(v_org, null, p_id), public.ws_figure_root(null, v_user, p_id));
    update public.three_d_projects set user_id = v_user, org_id = null, property_id = null, file_paths = v_paths where id = p_id;
  else
    -- Back to its owner's own Tenure Monitor (the owner does not change).
    update public.monitored_portfolios set org_id = null, property_id = null where id = p_id;
  end if;

  return jsonb_build_object('kind', p_kind, 'id', p_id);
end;
$$;

-- ── 11. Activity triggers ────────────────────────────────────────────────
create or replace function public.ws_activity_items()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := case tg_table_name when 'projects' then 'map' when 'three_d_projects' then 'figure' else 'portfolio' end;
  v_label text := case tg_table_name when 'projects' then 'map' when 'three_d_projects' then '3D figure' else 'claim portfolio' end;
  v_old_del text;
  v_new_del text;
begin
  if tg_op = 'INSERT' then
    if new.org_id is not null then
      perform public.log_org_activity(new.org_id, new.property_id, 'created', v_kind, new.id,
        'Created ' || v_label || ' "' || left(new.name, 120) || '"');
    end if;
    return null;
  elsif tg_op = 'DELETE' then
    if old.org_id is not null then
      perform public.log_org_activity(old.org_id, old.property_id, 'deleted', v_kind, old.id,
        'Permanently deleted ' || v_label || ' "' || left(old.name, 120) || '"');
    end if;
    return null;
  end if;

  if new.org_id is distinct from old.org_id or new.property_id is distinct from old.property_id then
    if new.org_id is not null then
      perform public.log_org_activity(new.org_id, new.property_id, 'moved', v_kind, new.id,
        'Moved ' || v_label || ' "' || left(new.name, 120) || '" ' ||
          case when old.org_id is distinct from new.org_id then 'into the workspace' else 'to another property' end,
        jsonb_build_object('from_org', old.org_id, 'from_property', old.property_id, 'to_property', new.property_id));
    end if;
    if old.org_id is not null and old.org_id is distinct from new.org_id then
      perform public.log_org_activity(old.org_id, old.property_id, 'moved', v_kind, old.id,
        'Moved ' || v_label || ' "' || left(old.name, 120) || '" out of the workspace',
        jsonb_build_object('from_property', old.property_id, 'to_org', new.org_id));
    end if;
    return null;
  end if;
  if new.org_id is null or tg_table_name = 'monitored_portfolios' then
    return null;
  end if;

  -- (Portfolios returned above; field access avoids copying a map's payload.)
  v_old_del := old.deleted_at::text;
  v_new_del := new.deleted_at::text;
  if v_old_del is null and v_new_del is not null then
    perform public.log_org_activity(new.org_id, new.property_id, 'deleted', v_kind, new.id,
      'Deleted ' || v_label || ' "' || left(new.name, 120) || '"');
  elsif v_old_del is not null and v_new_del is null then
    perform public.log_org_activity(new.org_id, new.property_id, 'updated', v_kind, new.id,
      'Restored ' || v_label || ' "' || left(new.name, 120) || '"', jsonb_build_object('restored', true));
  else
    perform public.log_org_activity(new.org_id, new.property_id, 'updated', v_kind, new.id,
      'Edited ' || v_label || ' "' || left(new.name, 120) || '"');
  end if;
  return null;
end;
$$;

create or replace function public.ws_activity_properties()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_org_activity(new.org_id, new.id, 'created', 'property', new.id,
      'Created property "' || left(new.name, 120) || '"');
  elsif old.deleted_at is null and new.deleted_at is not null then
    perform public.log_org_activity(new.org_id, new.id, 'deleted', 'property', new.id,
      'Deleted property "' || left(new.name, 120) || '"');
  elsif (new.name, new.jurisdiction, new.commodities, new.status, new.description, new.centroid_lon, new.centroid_lat, new.crs)
        is distinct from (old.name, old.jurisdiction, old.commodities, old.status, old.description, old.centroid_lon, old.centroid_lat, old.crs) then
    perform public.log_org_activity(new.org_id, new.id, 'updated', 'property', new.id,
      'Edited property "' || left(new.name, 120) || '"',
      case when new.status is distinct from old.status
           then jsonb_build_object('status_from', old.status, 'status_to', new.status) else '{}'::jsonb end);
  end if;
  return null;
end;
$$;

create or replace function public.ws_activity_members()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  if tg_op = 'INSERT' then
    v_email := coalesce(public.ws_user_email(new.user_id), 'A member');
    perform public.log_org_activity(new.org_id, null, 'joined', 'member', new.user_id,
      v_email || ' joined as ' || new.role, jsonb_build_object('role', new.role));
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      v_email := coalesce(public.ws_user_email(new.user_id), 'A member');
      perform public.log_org_activity(new.org_id, null, 'role_changed', 'member', new.user_id,
        v_email || ': ' || old.role || ' → ' || new.role, jsonb_build_object('from', old.role, 'to', new.role));
    end if;
  else
    v_email := coalesce(public.ws_user_email(old.user_id), 'A member');
    perform public.log_org_activity(old.org_id, null, 'removed', 'member', old.user_id,
      case when old.user_id = auth.uid() then v_email || ' left the workspace' else 'Removed ' || v_email end,
      jsonb_build_object('role', old.role, 'self', old.user_id = auth.uid()));
  end if;
  return null;
end;
$$;

create or replace function public.ws_activity_invites()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_org_activity(new.org_id, null, 'invited', 'invite', new.id,
      'Invited ' || new.email || ' as ' || new.role, jsonb_build_object('role', new.role));
  elsif old.revoked_at is null and new.revoked_at is not null and new.accepted_at is null then
    perform public.log_org_activity(new.org_id, null, 'deleted', 'invite', new.id,
      'Cancelled the invite for ' || new.email);
  end if;
  return null;
end;
$$;

-- ── 12. Invites ──────────────────────────────────────────────────────────
-- Only a SHA-256 of the token is stored; the raw token exists in the
-- invitee's email and in the inviter's browser at the moment of creation.
create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);

create index if not exists org_invites_org_idx on public.org_invites (org_id, created_at desc);
create index if not exists org_invites_inviter_idx on public.org_invites (invited_by, created_at desc);
create unique index if not exists org_invites_pending_email
  on public.org_invites (org_id, email) where accepted_at is null and revoked_at is null;

-- No client access at all: list_org_invites / create / accept / revoke.
alter table public.org_invites enable row level security;
revoke all on table public.org_invites from anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ws_activity' and tgrelid = 'public.properties'::regclass) then
    create trigger ws_activity after insert or update on public.properties
      for each row execute function public.ws_activity_properties();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ws_activity' and tgrelid = 'public.projects'::regclass) then
    create trigger ws_activity after insert or update or delete on public.projects
      for each row execute function public.ws_activity_items();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ws_activity' and tgrelid = 'public.three_d_projects'::regclass) then
    create trigger ws_activity after insert or update or delete on public.three_d_projects
      for each row execute function public.ws_activity_items();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ws_activity' and tgrelid = 'public.monitored_portfolios'::regclass) then
    -- Portfolios: only links and unlinks (renames and deletes belong to the
    -- owner's own monitor and its audit log).
    create trigger ws_activity after update of org_id, property_id on public.monitored_portfolios
      for each row execute function public.ws_activity_items();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ws_activity' and tgrelid = 'public.organization_members'::regclass) then
    create trigger ws_activity after insert or update or delete on public.organization_members
      for each row execute function public.ws_activity_members();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ws_activity' and tgrelid = 'public.org_invites'::regclass) then
    create trigger ws_activity after insert or update on public.org_invites
      for each row execute function public.ws_activity_invites();
  end if;
end $$;

-- Invite email, sent the way team enquiries are (Resend via pg_net, vault
-- key). Never raises: a failed email must not fail the invite.
create or replace function public.send_org_invite_email(p_invite uuid, p_token text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_api_key text;
  i public.org_invites;
  v_org text;
  v_from text;
  v_link text;
begin
  select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if v_api_key is null then
    return;
  end if;
  select * into i from public.org_invites where id = p_invite;
  if i.id is null then
    return;
  end if;
  select regexp_replace(o.name, '[[:cntrl:]]+', ' ', 'g') into v_org from public.organizations o where o.id = i.org_id;
  v_from := public.ws_user_email(i.invited_by);
  v_link := 'https://www.explorationmaps.com/invite?token=' || p_token;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Exploration Maps <notifications@explorationmaps.com>',
      'to', i.email,
      'subject', left(coalesce(v_from, 'A colleague') || ' invited you to ' || coalesce(v_org, 'a workspace') || ' on Exploration Maps', 200),
      'text', coalesce(v_from, 'A colleague') || ' invited you to join the ' || coalesce(v_org, '') || ' workspace on Exploration Maps as '
        || case i.role when 'viewer' then 'a viewer (read-only)' when 'editor' then 'an editor' else 'an ' || i.role end || '.' || E'\n\n'
        || 'Accept the invite: ' || v_link || E'\n\n'
        || 'Sign in (or create a free account) with this email address, ' || i.email || ', to accept. '
        || 'The link expires on ' || to_char(i.expires_at at time zone 'UTC', 'FMMonth FMDD, YYYY') || '.' || E'\n\n'
        || 'If you were not expecting this, you can ignore this email.'
    )
  );
exception when others then
  return;
end;
$$;

create or replace function public.create_org_invite(p_org uuid, p_email text, p_role text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
  v_count int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden: only an owner or admin can invite' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'editor', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if p_role = 'owner' and not public.has_org_role(p_org, 'owner') then
    raise exception 'forbidden: only an owner can invite another owner' using errcode = '42501';
  end if;
  if char_length(v_email) > 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;

  -- Serialize per organization so the rate limit cannot be raced.
  perform 1 from public.organizations where id = p_org for update;
  select count(*) into v_count from public.org_invites where org_id = p_org and created_at > now() - interval '1 day';
  if v_count >= 50 then
    raise exception 'INVITE_RATE_LIMIT: this workspace has sent 50 invites today' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.org_invites where invited_by = v_user and created_at > now() - interval '1 day';
  if v_count >= 100 then
    raise exception 'INVITE_RATE_LIMIT: you have sent 100 invites today' using errcode = 'P0001';
  end if;

  -- Only within this organization, which the admin can already see.
  if exists (select 1 from public.organization_members m join auth.users u on u.id = m.user_id
             where m.org_id = p_org and lower(u.email::text) = v_email) then
    raise exception 'ALREADY_MEMBER: that person is already in this workspace' using errcode = 'P0001';
  end if;

  -- Inviting again replaces the earlier link.
  update public.org_invites set revoked_at = now()
   where org_id = p_org and email = v_email and accepted_at is null and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.org_invites (org_id, email, role, token_hash, invited_by)
  values (p_org, v_email, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_user)
  returning id, expires_at into v_id, v_expires;

  begin
    perform public.send_org_invite_email(v_id, v_token);
  exception when others then
    null;
  end;

  return jsonb_build_object('id', v_id, 'email', v_email, 'role', p_role, 'expires_at', v_expires,
    'token', v_token, 'link', 'https://www.explorationmaps.com/invite?token=' || v_token);
end;
$$;

create or replace function public.accept_org_invite(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  i public.org_invites;
  v_existing text;
  v_role text;
  o public.organizations;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'INVITE_INVALID: this invite link is not valid' using errcode = 'P0001';
  end if;
  select * into i from public.org_invites
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if i.id is null or i.revoked_at is not null then
    raise exception 'INVITE_INVALID: this invite link is not valid or was cancelled' using errcode = 'P0001';
  end if;
  if i.accepted_at is not null then
    raise exception 'INVITE_USED: this invite has already been accepted' using errcode = 'P0001';
  end if;
  if i.expires_at <= now() then
    raise exception 'INVITE_EXPIRED: this invite has expired; ask for a new one' using errcode = 'P0001';
  end if;
  -- The inviter must still be allowed to grant this role: an admin who was
  -- demoted or removed cannot leave working admin invites behind.
  if public.ws_role_rank((select m.role from public.organization_members m
                          where m.org_id = i.org_id and m.user_id = i.invited_by))
     < greatest(public.ws_role_rank('admin'), public.ws_role_rank(case when i.role = 'owner' then 'owner' else 'admin' end)) then
    raise exception 'INVITE_INVALID: this invite is no longer valid; ask for a new one' using errcode = 'P0001';
  end if;

  select lower(u.email::text), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_user;
  -- Never says which address the invite was for.
  if v_email is null or v_email <> i.email or v_confirmed is null then
    raise exception 'INVITE_EMAIL_MISMATCH: this invite was sent to a different email address' using errcode = 'P0001';
  end if;

  select m.role into v_existing from public.organization_members m where m.org_id = i.org_id and m.user_id = v_user;
  if v_existing is null then
    v_role := i.role;
    insert into public.organization_members (org_id, user_id, role) values (i.org_id, v_user, i.role);
  elsif public.ws_role_rank(i.role) > public.ws_role_rank(v_existing) then
    v_role := i.role;
    update public.organization_members set role = i.role where org_id = i.org_id and user_id = v_user;
  else
    v_role := v_existing;
  end if;
  update public.org_invites set accepted_at = now(), accepted_by = v_user where id = i.id;

  select * into o from public.organizations where id = i.org_id;
  return jsonb_build_object('org_id', o.id, 'name', o.name, 'slug', o.slug, 'role', v_role);
end;
$$;

create or replace function public.revoke_org_invite(p_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_rows int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select org_id into v_org from public.org_invites where id = p_id;
  if v_org is null or not public.has_org_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.org_invites set revoked_at = now()
   where id = p_id and accepted_at is null and revoked_at is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.list_org_invites(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role,
             'created_at', i.created_at, 'expires_at', i.expires_at,
             'invited_by_email', public.ws_user_email(i.invited_by)) order by i.created_at desc)
    from public.org_invites i
    where i.org_id = p_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  ), '[]'::jsonb);
end;
$$;

-- ── 13. Organizations and memberships ────────────────────────────────────
create or replace function public.create_organization(p_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_id uuid;
  v_count int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid workspace name' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('org-create:' || v_user::text, 0));
  select count(*) into v_count from public.organizations where owner_id = v_user and created_at > now() - interval '1 day';
  if v_count >= 5 then
    raise exception 'ORG_RATE_LIMIT: you can create 5 workspaces a day' using errcode = 'P0001';
  end if;

  v_base := coalesce(public.ws_slugify(v_name), 'workspace');
  v_slug := v_base;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_slug := left(v_base, 70) || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
  end loop;

  insert into public.organizations (name, slug, owner_id, plan)
  values (v_name, v_slug, v_user, 'free')
  returning id into v_id;
  insert into public.organization_members (org_id, user_id, role) values (v_id, v_user, 'owner');
  perform public.log_org_activity(v_id, null, 'created', 'organization', v_id, 'Created the workspace "' || left(v_name, 120) || '"');
  return jsonb_build_object('id', v_id, 'name', v_name, 'slug', v_slug, 'role', 'owner');
end;
$$;

create or replace function public.update_organization(p_org uuid, p_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid workspace name' using errcode = '22023';
  end if;
  update public.organizations set name = v_name, updated_at = now() where id = p_org;
  perform public.log_org_activity(p_org, null, 'updated', 'organization', p_org, 'Renamed the workspace to "' || left(v_name, 120) || '"');
  return jsonb_build_object('id', p_org, 'name', v_name);
end;
$$;

create or replace function public.get_my_workspaces()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'slug', o.slug, 'plan', o.plan, 'role', m.role,
      'member_count', (select count(*) from public.organization_members x where x.org_id = o.id),
      'property_count', (select count(*) from public.properties p where p.org_id = o.id and p.deleted_at is null)
    ) order by lower(o.name)), '[]'::jsonb)
  from public.organization_members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid()
$$;

create or replace function public.list_org_members(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_org_role(p_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role,
             'joined_at', m.joined_at, 'is_me', m.user_id = auth.uid())
           order by public.ws_role_rank(m.role) desc, lower(u.email::text))
    from public.organization_members m left join auth.users u on u.id = m.user_id
    where m.org_id = p_org
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_current text;
  v_owners int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden: only an owner or admin can change roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'editor', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  -- Lock the organization's owner rows so two demotions cannot both pass.
  perform 1 from public.organization_members where org_id = p_org and role = 'owner' for update;
  select role into v_current from public.organization_members where org_id = p_org and user_id = p_user for update;
  if v_current is null then
    raise exception 'NOT_A_MEMBER' using errcode = 'P0002';
  end if;
  if (v_current = 'owner' or p_role = 'owner') and not public.has_org_role(p_org, 'owner') then
    raise exception 'forbidden: only an owner can change an owner or make someone an owner' using errcode = '42501';
  end if;
  if v_current = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners from public.organization_members where org_id = p_org and role = 'owner';
    if v_owners <= 1 then
      raise exception 'LAST_OWNER: a workspace needs at least one owner' using errcode = 'P0001';
    end if;
  end if;
  if v_current <> p_role then
    update public.organization_members set role = p_role where org_id = p_org and user_id = p_user;
  end if;
  return jsonb_build_object('user_id', p_user, 'role', p_role);
end;
$$;

-- Removes a member, or lets the caller leave (p_user = auth.uid()).
create or replace function public.remove_member(p_org uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_role text;
  v_owners int;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_user is distinct from v_me and not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden: only an owner or admin can remove members' using errcode = '42501';
  end if;
  perform 1 from public.organization_members where org_id = p_org and role = 'owner' for update;
  select role into v_role from public.organization_members where org_id = p_org and user_id = p_user for update;
  if v_role is null then
    if p_user is distinct from v_me and not public.has_org_role(p_org, 'viewer') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'NOT_A_MEMBER' using errcode = 'P0002';
  end if;
  if v_role = 'owner' then
    if p_user is distinct from v_me and not public.has_org_role(p_org, 'owner') then
      raise exception 'forbidden: only an owner can remove an owner' using errcode = '42501';
    end if;
    select count(*) into v_owners from public.organization_members where org_id = p_org and role = 'owner';
    if v_owners <= 1 then
      raise exception 'LAST_OWNER: make someone else an owner first' using errcode = 'P0001';
    end if;
  end if;
  delete from public.organization_members where org_id = p_org and user_id = p_user;
  return true;
end;
$$;

-- ── 14. Reads ────────────────────────────────────────────────────────────
create or replace function public.get_org_activity(
  p_org uuid, p_property uuid default null, p_limit integer default 50, p_before timestamptz default null
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_org_role(p_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc, r.id desc)
    from (
      select a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.property_id,
             p.name as property_name, p.slug as property_slug,
             public.ws_user_email(a.actor) as actor_email, a.summary, a.detail
      from public.org_activity a
      left join public.properties p on p.id = a.property_id
      where a.org_id = p_org
        and (p_property is null or a.property_id = p_property)
        and (p_before is null or a.created_at < p_before)
      order by a.created_at desc, a.id desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) r
  ), '[]'::jsonb);
end;
$$;

-- Claim portfolios linked to a property, for its members. Read-only; changes
-- stay in the owner's Tenure Monitor.
create or replace function public.get_property_claims(p_property uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := public.ws_property_org(p_property);
begin
  if v_org is null or not public.has_org_role(v_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', mp.id, 'name', mp.name, 'jurisdiction', mp.jurisdiction,
      'is_mine', mp.user_id = auth.uid(), 'owner_email', public.ws_user_email(mp.user_id),
      'tenure_count', (select count(*) from public.monitored_portfolio_tenures x where x.portfolio_id = mp.id and x.removed_at is null),
      'next_good_to_date', (select min(t.good_to_date) from public.monitored_portfolio_tenures x
                              join public.tenures t on t.id = x.tenure_id
                             where x.portfolio_id = mp.id and x.removed_at is null and t.good_to_date >= current_date),
      'tenures', coalesce((
        select jsonb_agg(jsonb_build_object('tenure_number', t.tenure_number, 'tenure_name', t.tenure_name,
                 'status', t.status, 'good_to_date', t.good_to_date, 'area_hectares', t.area_hectares,
                 'maintenance_decision', x.maintenance_decision) order by t.good_to_date nulls last, t.tenure_number)
        from (select * from public.monitored_portfolio_tenures x0
               where x0.portfolio_id = mp.id and x0.removed_at is null limit 500) x
        join public.tenures t on t.id = x.tenure_id
      ), '[]'::jsonb)
    ) order by mp.created_at)
    from public.monitored_portfolios mp
    where mp.property_id = p_property and mp.org_id = v_org
  ), '[]'::jsonb);
end;
$$;

-- ── 15. Grants ───────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default. Start from nothing, then grant what the browser calls.
do $$
declare f text;
begin
  foreach f in array array[
    'public.ws_role_rank(text)', 'public.org_role(uuid)', 'public.has_org_role(uuid, text)',
    'public.ws_uuid(text)', 'public.ws_slugify(text)', 'public.ws_user_email(uuid)',
    'public.ws_property_org(uuid)', 'public.ws_property_has_content(uuid)', 'public.properties_guard()',
    'public.org_activity_immutable()', 'public.log_org_activity(uuid, uuid, text, text, uuid, text, jsonb)',
    'public.ws_guard_ownership()', 'public.ws_check_property_link()', 'public.ws_personal_map_limit(uuid)',
    'public.org_map_limit(uuid)', 'public.create_cloud_project(text, jsonb)',
    'public.save_cloud_project(uuid, text, jsonb, integer)', 'public.trash_cloud_project(uuid)',
    'public.restore_cloud_project(uuid)', 'public.create_org_project(uuid, text, jsonb)',
    'public.ws_storage_org(text)', 'public.ws_figure_root(uuid, uuid, uuid)',
    'public.ws_rebase_figure_files(jsonb, text, text)', 'public.ws_can_edit_source(uuid, uuid, uuid)',
    'public.move_to_property(text, uuid, uuid)', 'public.move_to_personal(text, uuid)',
    'public.ws_activity_items()', 'public.ws_activity_properties()', 'public.ws_activity_members()',
    'public.ws_activity_invites()', 'public.send_org_invite_email(uuid, text)',
    'public.create_org_invite(uuid, text, text)', 'public.accept_org_invite(text)',
    'public.revoke_org_invite(uuid)', 'public.list_org_invites(uuid)', 'public.create_organization(text)',
    'public.update_organization(uuid, text)', 'public.get_my_workspaces()', 'public.list_org_members(uuid)',
    'public.set_member_role(uuid, uuid, text)', 'public.remove_member(uuid, uuid)',
    'public.get_org_activity(uuid, uuid, integer, timestamptz)', 'public.get_property_claims(uuid)'
  ] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;

  -- Browser-callable RPCs, plus the helpers RLS policies evaluate as the
  -- caller: RLS policies (org_role, has_org_role, ws_role_rank, ws_uuid,
  -- ws_storage_org) and the invoker triggers (ws_slugify, ws_property_org,
  -- ws_property_has_content; the last two answer only for the caller's own
  -- organizations).
  foreach f in array array[
    'public.ws_role_rank(text)', 'public.org_role(uuid)', 'public.has_org_role(uuid, text)',
    'public.ws_uuid(text)', 'public.ws_storage_org(text)', 'public.ws_slugify(text)',
    'public.ws_property_org(uuid)', 'public.ws_property_has_content(uuid)',
    'public.create_cloud_project(text, jsonb)', 'public.save_cloud_project(uuid, text, jsonb, integer)',
    'public.trash_cloud_project(uuid)', 'public.restore_cloud_project(uuid)',
    'public.create_org_project(uuid, text, jsonb)', 'public.move_to_property(text, uuid, uuid)',
    'public.move_to_personal(text, uuid)', 'public.create_org_invite(uuid, text, text)',
    'public.accept_org_invite(text)', 'public.revoke_org_invite(uuid)', 'public.list_org_invites(uuid)',
    'public.create_organization(text)', 'public.update_organization(uuid, text)', 'public.get_my_workspaces()',
    'public.list_org_members(uuid)', 'public.set_member_role(uuid, uuid, text)', 'public.remove_member(uuid, uuid)',
    'public.get_org_activity(uuid, uuid, integer, timestamptz)', 'public.get_property_claims(uuid)'
  ] loop
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

-- ============================================================
-- Verification (run manually after applying):
--   select policyname, cmd, qual from pg_policies where tablename in
--     ('projects','three_d_projects','organizations','organization_members','properties','org_activity');
--   -- every projects/three_d_projects owner policy mentions "org_id IS NULL"
--   select proname, proconfig from pg_proc where proname in
--     ('org_role','has_org_role','create_org_invite','accept_org_invite','move_to_property');
--   -- every one: {search_path=""}
--   select has_function_privilege('anon', 'public.create_org_invite(uuid,text,text)', 'execute'); -- false
-- ============================================================
