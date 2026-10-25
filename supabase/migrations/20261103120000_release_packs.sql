-- ============================================================
-- Release packs, Phase 5B: per property, the ordered outputs of a news-release
-- package (the results table of a saved recipe, the drill plan map, 3D figures,
-- the location map), and the approvals that froze what each release used.
--
-- PACK (release_packs, one per property)
--   items: [{ kind, ref }] in figure order, at most 12, no duplicates:
--     results_table  ref = a results recipe name (drill_result_recipes.name)
--     drill_plan     ref = a map (projects.id) in the property
--     location_map   ref = a map (projects.id) in the property
--     figure_3d      ref = a 3D figure (three_d_projects.id) in the property
--   Editors create and change it; members read it. Changing the items never
--   touches an approval.
--
-- APPROVAL (release_pack_approvals, immutable)
--   The browser inserts { pack_id, batch_ids, figures, recipe, note }: what the
--   reviewer had on screen. The guard checks it against the database (under
--   the drill import lock) and refuses APPROVAL_STALE when an import, a roll
--   back, a new figure version, a map save or a recipe save happened since;
--   it then stores the server's own copy: the pack's items, every live import
--   batch of the property, each map's revision and each 3D figure's latest
--   published version (figure_versions) with its save time, the recipe
--   version, the approver and the time. Nothing is published or updated.
--   No update or delete for the API roles; a trigger refuses both for every
--   role except the foreign keys' own actions (approved_by set null, the
--   cascade when the pack's property is deleted).
--
-- Additive and idempotent: two new tables, guarded policies and triggers;
-- nothing existing is altered. No statement starts with DROP/TRUNCATE/DELETE.
-- Depends on: 20261023100000_workspaces_properties.sql (has_org_role,
-- ws_property_org, ws_uuid, ws_user_email), 20261027100000_drill_database.sql,
-- 20261028100000_drill_intercepts.sql, 20261029100000_figure_versions.sql.
-- Rollback (nothing depends on these):
--   drop table public.release_pack_approvals, public.release_packs;
--   drop function public.release_pack_guard(), public.release_pack_approval_guard(),
--     public.release_pack_approval_immutable(), public.release_pack_items_error(jsonb, uuid),
--     public.release_pack_figures(uuid, jsonb);
-- ============================================================

set local lock_timeout = '5s';

-- ── 1. Tables ────────────────────────────────────────────────────────────
create table if not exists public.release_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint release_packs_property_key unique (property_id)
);
create index if not exists release_packs_org_idx on public.release_packs (org_id);
create index if not exists release_packs_updated_by_idx on public.release_packs (updated_by);

create table if not exists public.release_pack_approvals (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.release_packs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  batch_ids uuid[] not null default '{}',
  figures jsonb not null default '[]'::jsonb check (jsonb_typeof(figures) = 'array'),
  recipe jsonb,
  note text check (note is null or char_length(note) <= 1000),
  approved_by uuid references auth.users(id) on delete set null,
  approved_by_email text,
  approved_at timestamptz not null default now()
);
create index if not exists release_pack_approvals_pack_idx on public.release_pack_approvals (pack_id, approved_at desc);
create index if not exists release_pack_approvals_property_idx on public.release_pack_approvals (property_id, approved_at desc);
create index if not exists release_pack_approvals_org_idx on public.release_pack_approvals (org_id);
create index if not exists release_pack_approvals_by_idx on public.release_pack_approvals (approved_by);

-- ── 2. Row-level security ────────────────────────────────────────────────
alter table public.release_packs enable row level security;
alter table public.release_pack_approvals enable row level security;
revoke all on table public.release_packs, public.release_pack_approvals from public, anon, authenticated;
grant select on table public.release_packs, public.release_pack_approvals to authenticated;
grant insert (property_id, items) on table public.release_packs to authenticated;
grant update (items) on table public.release_packs to authenticated;
grant insert (pack_id, batch_ids, figures, recipe, note) on table public.release_pack_approvals to authenticated;

do $$
declare t text;
begin
  foreach t in array array['release_packs', 'release_pack_approvals'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Members read ' || t) then
      execute format('create policy %I on public.%I for select to authenticated using (public.has_org_role(org_id, ''viewer''))', 'Members read ' || t, t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Editors add ' || t) then
      execute format('create policy %I on public.%I for insert to authenticated with check (public.has_org_role(org_id, ''editor'') and public.ws_property_org(property_id) = org_id)', 'Editors add ' || t, t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'release_packs' and policyname = 'Editors change release_packs') then
    create policy "Editors change release_packs" on public.release_packs for update to authenticated
      using (public.has_org_role(org_id, 'editor')) with check (public.has_org_role(org_id, 'editor') and public.ws_property_org(property_id) = org_id);
  end if;
end $$;

-- ── 3. Pack items ────────────────────────────────────────────────────────
-- What is wrong with a pack's items (null when they can be stored).
create or replace function public.release_pack_items_error(p jsonb, p_property uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when p is null or jsonb_typeof(p) <> 'array' then 'the items must be a list'
    when jsonb_array_length(p) > 12 then 'a pack holds at most 12 items'
    when exists (select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'object'
                 or coalesce(e->>'kind', '') not in ('results_table', 'drill_plan', 'location_map', 'figure_3d')
                 or jsonb_typeof(e->'ref') is distinct from 'string' or char_length(e->>'ref') not between 1 and 80)
      then 'each item needs a kind (results_table, drill_plan, location_map or figure_3d) and a ref'
    when (select count(distinct (e->>'kind', e->>'ref')) from jsonb_array_elements(p) e) <> jsonb_array_length(p)
      then 'an item is listed twice'
    when exists (select 1 from jsonb_array_elements(p) e where e->>'kind' in ('drill_plan', 'location_map')
                 and not exists (select 1 from public.projects m where m.id = public.ws_uuid(e->>'ref')
                                 and m.property_id = p_property and m.deleted_at is null))
      then 'a map in the pack is not in this property'
    when exists (select 1 from jsonb_array_elements(p) e where e->>'kind' = 'figure_3d'
                 and not exists (select 1 from public.three_d_projects f where f.id = public.ws_uuid(e->>'ref')
                                 and f.property_id = p_property and f.deleted_at is null))
      then 'a 3D figure in the pack is not in this property'
  end
$$;

create or replace function public.release_pack_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_error text;
begin
  -- Unchanged items: nothing to check (also the updated_by foreign key's set null).
  if tg_op = 'UPDATE' and new.items = old.items and new.property_id = old.property_id and new.org_id = old.org_id then return new; end if;
  if tg_op = 'INSERT' then
    new.org_id := public.ws_property_org(new.property_id);
    if new.org_id is null then raise exception 'PROPERTY_NOT_FOUND' using errcode = 'P0002'; end if;
    new.created_at := now();
  elsif new.property_id <> old.property_id or new.org_id <> old.org_id then
    raise exception 'RELEASE_PACK_IMMUTABLE: a pack stays with its property' using errcode = '42501';
  end if;
  v_error := public.release_pack_items_error(new.items, new.property_id);
  if v_error is not null then raise exception 'INVALID_RELEASE_PACK: %', v_error using errcode = '22023'; end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- ── 4. Approvals ─────────────────────────────────────────────────────────
-- The maps and 3D figures of a pack's items, in order, as they are now:
-- { item, kind, id, name, revision (maps), saved_at, version_id, version,
--   label (3D figures: the latest published version, or null) }.
create or replace function public.release_pack_figures(p_property uuid, p_items jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(f order by i), '[]'::jsonb) from (
    select jsonb_build_object('item', e.i - 1, 'kind', 'map', 'id', m.id, 'name', m.name, 'revision', m.revision,
             'saved_at', m.updated_at, 'version_id', null, 'version', null, 'label', null) f, e.i
    from jsonb_array_elements(p_items) with ordinality e(v, i)
    join public.projects m on m.id = public.ws_uuid(e.v->>'ref') and m.property_id = p_property and m.deleted_at is null
    where e.v->>'kind' in ('drill_plan', 'location_map')
    union all
    select jsonb_build_object('item', e.i - 1, 'kind', 'figure', 'id', t.id, 'name', t.name, 'revision', null,
             'saved_at', t.updated_at, 'version_id', v.id, 'version', v.version, 'label', v.label), e.i
    from jsonb_array_elements(p_items) with ordinality e(v, i)
    join public.three_d_projects t on t.id = public.ws_uuid(e.v->>'ref') and t.property_id = p_property and t.deleted_at is null
    left join lateral (select x.id, x.version, x.label from public.figure_versions x
                       where x.figure_kind = 'figure' and x.figure_id = t.id order by x.version desc limit 1) v on true
    where e.v->>'kind' = 'figure_3d'
  ) z(f, i)
$$;

create or replace function public.release_pack_approval_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.release_packs;
  v_live uuid[];
  v_figs jsonb;
  v_recipe jsonb;
  v_name text;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.release_packs where id = new.pack_id;
  if p.id is null or public.ws_property_org(p.property_id) is distinct from p.org_id or not public.has_org_role(p.org_id, 'editor') then
    raise exception 'RELEASE_PACK_NOT_FOUND' using errcode = '42501';
  end if;
  if jsonb_array_length(p.items) = 0 then raise exception 'APPROVAL_INCOMPLETE: the pack has no items' using errcode = '22023'; end if;
  -- The drill import lock: no import or roll back lands while this is checked.
  perform pg_advisory_xact_lock(hashtextextended('drill:' || p.property_id::text, 0));
  v_live := array(select b.id from public.drill_import_batches b where b.property_id = p.property_id and b.rolled_back_at is null order by b.created_at, b.id);
  -- What the reviewer saw: live batches, every live one from the oldest listed on (the property summary lists the latest 50).
  if not (coalesce(new.batch_ids, '{}') <@ v_live)
     or (cardinality(coalesce(new.batch_ids, '{}')) = 0 and cardinality(v_live) > 0)
     or exists (select 1 from public.drill_import_batches b where b.property_id = p.property_id and b.rolled_back_at is null
                and not b.id = any(new.batch_ids)
                and b.created_at >= (select min(c.created_at) from public.drill_import_batches c where c.id = any(new.batch_ids))) then
    raise exception 'APPROVAL_STALE: the drill data changed since the pack was checked' using errcode = 'P0001';
  end if;
  v_figs := public.release_pack_figures(p.property_id, p.items);
  if (select count(*) from jsonb_array_elements(p.items) e where e->>'kind' <> 'results_table') <> jsonb_array_length(v_figs) then
    raise exception 'APPROVAL_INCOMPLETE: a map or 3D figure in the pack is no longer in the property' using errcode = '22023';
  end if;
  if (select coalesce(jsonb_agg(jsonb_build_array(f->'kind', f->'id', f->'version_id', f->'revision') order by o), '[]') from jsonb_array_elements(v_figs) with ordinality x(f, o))
     is distinct from (select coalesce(jsonb_agg(jsonb_build_array(f->'kind', f->'id', f->'version_id', f->'revision') order by o), '[]') from jsonb_array_elements(coalesce(new.figures, '[]')) with ordinality x(f, o)) then
    raise exception 'APPROVAL_STALE: a map or 3D figure changed since the pack was checked' using errcode = 'P0001';
  end if;
  v_name := (select e->>'ref' from jsonb_array_elements(p.items) e where e->>'kind' = 'results_table' limit 1);
  if v_name is not null then
    select jsonb_build_object('name', r.name, 'id', r.id, 'version', r.version) into v_recipe
      from public.drill_result_recipes r where r.property_id = p.property_id and r.name = v_name and r.superseded_at is null;
    if v_recipe is null then raise exception 'APPROVAL_INCOMPLETE: save the results recipe "%" first', v_name using errcode = '22023'; end if;
    if new.recipe->>'id' is distinct from v_recipe->>'id' then
      raise exception 'APPROVAL_STALE: the results recipe changed since the pack was checked' using errcode = 'P0001';
    end if;
  end if;
  new.id := gen_random_uuid();
  new.org_id := p.org_id;
  new.property_id := p.property_id;
  new.items := p.items;
  new.batch_ids := v_live;
  new.figures := v_figs;
  new.recipe := v_recipe;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.approved_by := auth.uid();
  new.approved_by_email := public.ws_user_email(auth.uid());
  new.approved_at := now();
  return new;
end;
$$;

-- The foreign keys' own actions are the only changes, for every role.
create or replace function public.release_pack_approval_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.release_packs p where p.id = old.pack_id) then
      raise exception 'APPROVAL_IMMUTABLE: an approval cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.approved_by is null and (to_jsonb(new) - 'approved_by') = (to_jsonb(old) - 'approved_by') then return new; end if;
  raise exception 'APPROVAL_IMMUTABLE: an approval cannot be changed' using errcode = '42501';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'release_pack_guard' and tgrelid = 'public.release_packs'::regclass) then
    create trigger release_pack_guard before insert or update on public.release_packs
      for each row execute function public.release_pack_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'release_pack_approval_guard' and tgrelid = 'public.release_pack_approvals'::regclass) then
    create trigger release_pack_approval_guard before insert on public.release_pack_approvals
      for each row execute function public.release_pack_approval_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'release_pack_approval_immutable' and tgrelid = 'public.release_pack_approvals'::regclass) then
    create trigger release_pack_approval_immutable before update or delete on public.release_pack_approvals
      for each row execute function public.release_pack_approval_immutable();
  end if;
end $$;

-- ── 5. Grants ────────────────────────────────────────────────────────────
-- Trigger and helper functions only; the browser uses the tables.
revoke all on function public.release_pack_items_error(jsonb, uuid), public.release_pack_guard(), public.release_pack_figures(uuid, jsonb),
  public.release_pack_approval_guard(), public.release_pack_approval_immutable() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- Verification (run manually after applying):
--   select tablename, policyname, cmd from pg_policies where tablename like 'release_pack%' order by 1, 2; -- 5 policies
--   select has_table_privilege('anon', 'public.release_packs', 'select'); -- false
--   select has_table_privilege('authenticated', 'public.release_pack_approvals', 'update'); -- false
-- ============================================================
