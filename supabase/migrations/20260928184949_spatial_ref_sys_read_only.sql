-- Stop the API roles writing to PostGIS's spatial_ref_sys.
--
-- PostGIS is installed in `public`, so its coordinate-system catalogue is
-- exposed through the API with every privilege Supabase grants by default:
-- anyone holding the public anon key could delete or rewrite projection
-- definitions and break every ST_Transform. The Security Advisor flags it as
-- "RLS disabled in public".
--
-- The table is owned by supabase_admin, so a migration can neither REVOKE those
-- grants (they were made by supabase_admin; a REVOKE from `postgres` is a
-- silent no-op) nor ENABLE ROW LEVEL SECURITY ("must be owner of table
-- spatial_ref_sys"). `postgres` does hold the TRIGGER privilege, so writes from
-- anon and authenticated are refused here instead. Reads, and so transforms,
-- are unaffected; PostGIS upgrades run as supabase_admin and pass through.
--
-- The advisor keeps flagging the table because it checks the RLS flag, not
-- triggers. Clearing it for good means moving PostGIS to the `extensions`
-- schema, which recreates every geometry column and is its own project.
--
-- Rollback:
--   drop trigger spatial_ref_sys_read_only on public.spatial_ref_sys;
--   drop function public.spatial_ref_sys_read_only();

create or replace function public.spatial_ref_sys_read_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'spatial_ref_sys is read-only' using errcode = '42501';
  end if;
  return null;
end $$;

revoke execute on function public.spatial_ref_sys_read_only() from public, anon, authenticated;

drop trigger if exists spatial_ref_sys_read_only on public.spatial_ref_sys;
create trigger spatial_ref_sys_read_only
  before insert or update or delete or truncate on public.spatial_ref_sys
  for each statement execute function public.spatial_ref_sys_read_only();
