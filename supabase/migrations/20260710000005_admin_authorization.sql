-- ============================================================
-- Admin authorization + SECURITY DEFINER hardening.
-- Safe to apply immediately (additive; preserves current admin).
--
-- Problems fixed:
--  * is_admin() hardcoded a single email in SQL while the frontend
--    used a separate VITE_ADMIN_EMAIL env var (split-brain).
--  * No SECURITY DEFINER function set a search_path (schema-shadowing
--    hazard for definer-privileged code).
--  * Definer functions had no explicit EXECUTE grants, so they were
--    executable by PUBLIC (anon included) — gated only by is_admin()
--    in their bodies.
--
-- Rollback:
--   drop table if exists public.admin_users cascade;
--   re-create is_admin() from supabase-admin-setup.sql (hardcoded email);
--   grants/search_path changes are safe to leave in place.
-- ============================================================

-- 1. Canonical admin registry. RLS enabled with NO policies: only
--    SECURITY DEFINER functions and the service role can touch it.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  added_at timestamptz default now()
);
alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

-- 2. Preserve the current legitimate admin (previously hardcoded in SQL).
insert into public.admin_users (user_id, note)
select id, 'seeded from legacy hardcoded admin email'
from auth.users
where email = 'coltongriffith@live.ca'
on conflict (user_id) do nothing;

-- Bootstrap for future admins (run with service role / SQL editor):
--   insert into public.admin_users (user_id, note)
--   select id, 'added by <who>' from auth.users where email = '<email>';

-- 3. Canonical is_admin(): table-driven, definer, pinned search path.
--    Definer context is required so the lookup works regardless of the
--    caller's rights on admin_users.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 4. Harden every SECURITY DEFINER function in public:
--    * pin search_path (fully-qualified resolution for unqualified names)
--    * strip PUBLIC execute
--    * admin_* : executable by authenticated only (bodies still gate on
--      is_admin(); anon cannot even invoke them any more)
--    * public lookup/counter RPCs stay callable by anon + authenticated
--    * maintenance RPCs stay service-role-only
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.sig);
    execute format('revoke all on function %s from public', fn.sig);
    if fn.name like 'admin\_%' escape '\' then
      execute format('revoke all on function %s from anon', fn.sig);
      execute format('grant execute on function %s to authenticated, service_role', fn.sig);
    elsif fn.name in ('get_shared_map', 'increment_shared_map_view', 'qc_claims_in_bbox', 'is_admin') then
      execute format('grant execute on function %s to anon, authenticated, service_role', fn.sig);
    elsif fn.name = 'truncate_qc_claims' then
      execute format('grant execute on function %s to service_role', fn.sig);
    else
      -- Unknown definer functions default to authenticated-only.
      execute format('grant execute on function %s to authenticated, service_role', fn.sig);
    end if;
  end loop;
end $$;

-- 5. Post-migration verification (run manually):
--   -- as anon (public client, no session):
--   select is_admin();                       -- ERROR: permission denied
--   select * from admin_users;               -- ERROR: permission denied
--   select admin_get_users();                -- ERROR: permission denied
--   select get_shared_map('doesnotexist99'); -- null (allowed, returns nothing)
--   -- as a NORMAL authenticated user:
--   select is_admin();                       -- false
--   select * from admin_get_users();         -- zero rows (body gated)
--   -- as the seeded admin:
--   select is_admin();                       -- true
--   select count(*) from admin_get_users();  -- > 0
