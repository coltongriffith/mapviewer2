-- ============================================================
-- Drill database, Phase 2C: a property's results recipe. The metal
-- equivalent (elements, prices, recoveries, units), the compositing rules
-- (cut-off, minimum length, internal dilution, the "incl." cut-off), BDL
-- treatment, rounding and the true-width note, defined once per property so
-- the property page's results table and the /3d figures built from it read
-- the same numbers. The intercepts themselves are computed in the browser
-- from the current assays (shared/drillResults.js); only the recipe is stored.
--
-- ROLES (as in 20261023100000_workspaces_properties.sql)
--   viewer  read every recipe and its history (drill_property_recipes)
--   editor  save a new version (drill_save_recipe)
--   Recipes are never written from the browser directly.
--
-- VERSIONING
--   A property keeps any number of named recipes ("Default", "Gold only").
--   Saving one adds a row with the next version and marks the previous row
--   superseded (superseded_at); nothing is updated in place or deleted, so a
--   release can say which version produced its table. The current row is
--   the one with superseded_at null (one per property and name). A save that
--   names the version it started from (p_base_version) is refused when
--   someone saved a newer one meanwhile; saving the same recipe again is a
--   no-op.
--
-- LIMITS
--   16 kB per recipe, 20 names and 1,000 versions per property.
--
-- Additive and idempotent: one new table, guarded policies, three new
-- functions; nothing existing is altered. No statement starts with
-- DROP/TRUNCATE/DELETE.
-- Depends on: 20261023100000_workspaces_properties.sql (has_org_role,
-- ws_property_org, ws_user_email, log_org_activity),
-- 20261027100000_drill_database.sql (drill_num; the assays the recipe reads).
-- Rollback (nothing depends on these):
--   drop function public.drill_save_recipe, public.drill_property_recipes,
--     public.drill_recipe_error; drop table public.drill_result_recipes.
-- ============================================================

set local lock_timeout = '5s';

-- ── 1. Table ─────────────────────────────────────────────────────────────
create table if not exists public.drill_result_recipes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  version integer not null check (version >= 1),
  recipe jsonb not null check (jsonb_typeof(recipe) = 'object' and pg_column_size(recipe) <= 16384),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint drill_result_recipes_version_key unique (property_id, name, version)
);

create unique index if not exists drill_result_recipes_current_key on public.drill_result_recipes (property_id, name) where superseded_at is null;
create index if not exists drill_result_recipes_org_idx on public.drill_result_recipes (org_id);
create index if not exists drill_result_recipes_created_by_idx on public.drill_result_recipes (created_by);

-- ── 2. Row-level security ────────────────────────────────────────────────
-- Members read (auth.uid() once per statement, as for the drill tables);
-- nobody writes directly.
alter table public.drill_result_recipes enable row level security;
revoke all on table public.drill_result_recipes from anon, authenticated;
grant select on table public.drill_result_recipes to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drill_result_recipes'
                 and policyname = 'Members read drill_result_recipes') then
    create policy "Members read drill_result_recipes" on public.drill_result_recipes for select to authenticated
      using (org_id in (select m.org_id from public.organization_members m where m.user_id = (select auth.uid())));
  end if;
end $$;

-- ── 3. Checks ────────────────────────────────────────────────────────────
-- What is wrong with a recipe (null when it can be stored). The browser runs
-- fuller checks first (checkRecipe in shared/drillResults.js); this is the
-- shape every stored recipe is guaranteed to have.
create or replace function public.drill_recipe_error(p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then 'the recipe must be an object'
    when pg_column_size(p) > 16384 then 'the recipe is larger than 16 kB'
    when jsonb_typeof(p->'elements') is distinct from 'array' then 'the recipe needs 1 to 20 elements'
    when jsonb_array_length(p->'elements') not between 1 and 20 then 'the recipe needs 1 to 20 elements'
    when exists (select 1 from jsonb_array_elements(p->'elements') e
                 where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'name') is distinct from 'string'
                    or char_length(btrim(e->>'name')) not between 1 and 40
                    or coalesce(e->>'unit', '') not in ('%', 'g/t', 'ppm', 'ppb')
                    or coalesce(jsonb_typeof(e->'price'), 'null') not in ('number', 'null')
                    or coalesce(jsonb_typeof(e->'recovery'), 'null') not in ('number', 'null')
                    or public.drill_num(e->'price') < 0
                    or public.drill_num(e->'recovery') not between 0 and 100)
      then 'each element needs a name (up to 40 characters), a unit (%, g/t, ppm or ppb), and a price and recovery (0 to 100%) when given'
    when (select count(distinct e->>'name') from jsonb_array_elements(p->'elements') e) <> jsonb_array_length(p->'elements')
      then 'an element is listed twice'
    when jsonb_typeof(p->'primary') is distinct from 'string'
      or not exists (select 1 from jsonb_array_elements(p->'elements') e where e->>'name' = p->>'primary')
      then 'the primary element must be one of the elements'
    when public.drill_num(p->'cutoff') is null or public.drill_num(p->'cutoff') < 0
      or public.drill_num(p->'minLength') is null or public.drill_num(p->'minLength') < 0
      or public.drill_num(p->'maxDilution') is null or public.drill_num(p->'maxDilution') < 0
      then 'cutoff, minLength and maxDilution must be numbers, 0 or more'
    when coalesce(jsonb_typeof(p->'inclCutoff'), 'null') not in ('number', 'null')
      or public.drill_num(p->'inclCutoff') <= public.drill_num(p->'cutoff')
      then 'inclCutoff must be above the cut-off (or null)'
    when coalesce(jsonb_typeof(p->'inclMinLength'), 'null') not in ('number', 'null') or public.drill_num(p->'inclMinLength') < 0
      or coalesce(jsonb_typeof(p->'inclMaxDilution'), 'null') not in ('number', 'null') or public.drill_num(p->'inclMaxDilution') < 0
      then 'inclMinLength and inclMaxDilution must be numbers, 0 or more'
    when coalesce(p->>'bdl', 'stored') not in ('stored', 'half', 'zero', 'dl') then 'bdl must be stored, half, zero or dl'
    when coalesce(jsonb_typeof(p->'trueWidth'), 'null') not in ('string', 'null') or char_length(p->>'trueWidth') > 1000
      then 'the true-width note must be text of up to 1,000 characters'
  end
$$;

-- ── 4. Save ──────────────────────────────────────────────────────────────
-- Saves a new version of a property's named recipe; returns it as
-- drill_property_recipes lists it, with unchanged: true when it was already
-- the current version.
create or replace function public.drill_save_recipe(
  p_property uuid, p_name text, p_recipe jsonb, p_base_version integer default null
) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_error text;
  cur public.drill_result_recipes;
  r public.drill_result_recipes;
  v_unchanged boolean := false;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_org := public.ws_property_org(p_property);
  if v_org is null or not public.has_org_role(v_org, 'viewer') then
    raise exception 'PROPERTY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_org, 'editor') then
    raise exception 'ORG_READ_ONLY: viewers cannot change the results recipe' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'INVALID_RECIPE: the name must be 1 to 80 characters' using errcode = '22023';
  end if;
  v_error := public.drill_recipe_error(p_recipe);
  if v_error is not null then raise exception 'INVALID_RECIPE: %', v_error using errcode = '22023'; end if;
  -- One save per property at a time, so versions are consecutive.
  perform pg_advisory_xact_lock(hashtextextended('drill-recipe:' || p_property::text, 0));
  select * into cur from public.drill_result_recipes
    where property_id = p_property and name = v_name and superseded_at is null;
  if p_base_version is not null and coalesce(cur.version, 0) <> p_base_version then
    raise exception 'RECIPE_CONFLICT: version % of "%" was saved meanwhile', coalesce(cur.version, 0), v_name using errcode = 'P0001';
  end if;
  if cur.id is not null and cur.recipe = p_recipe then
    r := cur; v_unchanged := true;
  else
    if cur.id is null and (select count(distinct name) from public.drill_result_recipes where property_id = p_property) >= 20 then
      raise exception 'TOO_MANY_RECIPES: a property keeps at most 20 recipes' using errcode = '54000';
    end if;
    if (select count(*) from public.drill_result_recipes where property_id = p_property) >= 1000 then
      raise exception 'TOO_MANY_RECIPES: a property keeps at most 1,000 recipe versions' using errcode = '54000';
    end if;
    update public.drill_result_recipes set superseded_at = now() where id = cur.id;
    insert into public.drill_result_recipes (org_id, property_id, name, version, recipe, created_by)
    values (v_org, p_property, v_name, coalesce(cur.version, 0) + 1, p_recipe, v_user)
    returning * into r;
    -- Keyed by the new version's row, so no save is folded into the ten-minute
    -- debounce of other edits to the property.
    perform public.log_org_activity(v_org, p_property, 'updated', 'property', r.id,
      'Saved the results recipe "' || left(v_name, 80) || '" (version ' || r.version || ')',
      jsonb_build_object('recipe', v_name, 'version', r.version));
  end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'version', r.version, 'recipe', r.recipe, 'created_at', r.created_at,
    'created_by_email', public.ws_user_email(r.created_by), 'unchanged', v_unchanged);
end;
$$;

-- ── 5. Read ──────────────────────────────────────────────────────────────
-- The property's current recipes by name, each with its latest 20 versions.
create or replace function public.drill_property_recipes(p_property uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := public.ws_property_org(p_property);
begin
  if auth.uid() is null or v_org is null or not public.has_org_role(v_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'version', c.version, 'recipe', c.recipe, 'created_at', c.created_at,
      'created_by_email', public.ws_user_email(c.created_by),
      'versions', (select jsonb_agg(jsonb_build_object('version', v.version, 'created_at', v.created_at,
                                                       'created_by_email', public.ws_user_email(v.created_by)) order by v.version desc)
                   from (select * from public.drill_result_recipes h where h.property_id = c.property_id and h.name = c.name
                         order by h.version desc limit 20) v)
    ) order by lower(c.name), c.name)
    from public.drill_result_recipes c where c.property_id = p_property and c.superseded_at is null), '[]'::jsonb);
end;
$$;

-- ── 6. Grants ────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default. Start from nothing; the browser calls the two RPCs.
do $$
declare f text;
begin
  foreach f in array array['public.drill_recipe_error(jsonb)', 'public.drill_save_recipe(uuid, text, jsonb, integer)',
                           'public.drill_property_recipes(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array['public.drill_save_recipe(uuid, text, jsonb, integer)', 'public.drill_property_recipes(uuid)'] loop
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- Verification (run manually after applying):
--   select policyname, cmd from pg_policies where tablename = 'drill_result_recipes'; -- one SELECT policy
--   select has_function_privilege('anon', 'public.drill_property_recipes(uuid)', 'execute'); -- false
--   select has_function_privilege('authenticated', 'public.drill_recipe_error(jsonb)', 'execute'); -- false
-- ============================================================
