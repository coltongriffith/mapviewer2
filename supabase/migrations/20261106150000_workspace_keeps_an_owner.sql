-- ============================================================
-- A workspace never ends up without an owner (docs/state-machines.md, WS-8).
--
-- set_member_role and remove_member refuse to drop the last owner, but
-- deleting that person's auth account cascades their membership away and
-- bypasses both. The workspace was then left with admins nobody could promote
-- to owner. After any membership delete, if the organization still exists and
-- has no owner, its longest-standing admin becomes owner (then editor, then
-- viewer). An organization with no members left is left as it is.
--
-- Rollback:
--   drop trigger if exists ws_keep_an_owner on public.organization_members;
--   drop function if exists public.ws_keep_an_owner();
-- ============================================================

create or replace function public.ws_keep_an_owner()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_next uuid;
begin
  if old.role <> 'owner' then return null; end if;
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then return null; end if;
  if exists (select 1 from public.organization_members m where m.org_id = old.org_id and m.role = 'owner') then return null; end if;

  select m.user_id into v_next
    from public.organization_members m
   where m.org_id = old.org_id
   order by case m.role when 'admin' then 0 when 'editor' then 1 else 2 end, m.joined_at nulls last, m.user_id
   limit 1
   for update;
  if v_next is not null then
    update public.organization_members set role = 'owner' where org_id = old.org_id and user_id = v_next;
  end if;
  return null;
end;
$$;
revoke all on function public.ws_keep_an_owner() from public, anon, authenticated;

drop trigger if exists ws_keep_an_owner on public.organization_members;
create trigger ws_keep_an_owner
  after delete on public.organization_members
  for each row execute function public.ws_keep_an_owner();
