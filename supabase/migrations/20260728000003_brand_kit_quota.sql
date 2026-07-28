-- ============================================================
-- Server-side cap on reusable brand kits (public.templates).
--
-- The studio gates kit creation in the browser, but a direct Supabase insert
-- would bypass it. A BEFORE INSERT trigger enforces the same entitlement in
-- the database, so the pricing promise holds regardless of client.
--
-- Entitlements mirrored from src/utils/entitlements.js:
--   free  → 0 saved kits (may still style + apply the current map)
--   pro / grandfathered / admin → unlimited
--
-- Rollback:
--   drop trigger if exists enforce_brand_kit_quota on public.templates;
--   drop function if exists public.check_brand_kit_quota();
-- ============================================================

create or replace function public.check_brand_kit_quota()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_source text;
  v_count int;
begin
  select plan, source into v_plan, v_source
  from public.user_plans where user_id = new.user_id;

  -- Pro / grandfathered / admin: unlimited.
  if coalesce(v_plan, 'free') = 'pro' or coalesce(v_source, '') in ('grandfathered', 'admin') then
    return new;
  end if;

  select count(*) into v_count from public.templates where user_id = new.user_id;
  if v_count >= 0 then
    raise exception 'BRAND_KIT_LIMIT: saving reusable brand kits requires Pro'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_brand_kit_quota on public.templates;
create trigger enforce_brand_kit_quota
  before insert on public.templates
  for each row execute function public.check_brand_kit_quota();

-- Post-migration verification (run manually):
--   -- as a free user: insert into public.templates (user_id, name, config)
--   --   values (auth.uid(), 'x', '{}');   -- expect BRAND_KIT_LIMIT
--   -- as a grandfathered/pro user the same insert succeeds.
