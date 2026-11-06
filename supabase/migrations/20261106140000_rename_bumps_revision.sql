-- ============================================================
-- A rename is a change other tabs must see (docs/state-machines.md, ED-7).
--
-- Renaming a map from the Dashboard is a plain UPDATE of `name`. It did not
-- move `revision`, so an editor tab with the map open saved its old name
-- back on the next autosave, silently undoing the rename. A rename now bumps
-- the revision like a save, so that tab gets SAVE_CONFLICT and offers to
-- reload. save_cloud_project sets the revision itself and is left alone.
--
-- Rollback:
--   drop trigger if exists ws_d_rename_revision on public.projects;
--   drop function if exists public.ws_rename_revision();
-- ============================================================

create or replace function public.ws_rename_revision()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.name is distinct from old.name and new.revision is not distinct from old.revision then
    new.revision := coalesce(old.revision, 0) + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.ws_rename_revision() from public, anon, authenticated;

drop trigger if exists ws_d_rename_revision on public.projects;
create trigger ws_d_rename_revision
  before update of name on public.projects
  for each row execute function public.ws_rename_revision();
