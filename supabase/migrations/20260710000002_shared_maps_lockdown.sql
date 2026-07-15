-- ============================================================
-- Shared maps: remove open table access (step 2 of 2 — apply
-- ONLY after the frontend using get_shared_map() is deployed;
-- the old frontend reads shared_maps directly and would break).
--
-- After this migration anonymous clients can no longer select
-- from shared_maps at all — enumeration of the table through the
-- public Supabase client becomes impossible. Reads go exclusively
-- through get_shared_map(share_id).
--
-- INSERT stays permitted (share creation happens client-side and
-- ids are client-generated crypto-random UUIDs). UPDATE/DELETE
-- were never granted.
--
-- Rollback:
--   grant select on table public.shared_maps to anon, authenticated;
--   create policy "anyone read shared map by id"
--     on public.shared_maps for select to anon, authenticated using (true);
-- ============================================================

drop policy if exists "anyone read shared map by id" on public.shared_maps;
revoke select on table public.shared_maps from anon, authenticated;

-- Tighten insert slightly without breaking either flow: anonymous
-- shares must not claim a user_id; signed-in shares may only claim
-- their own.
drop policy if exists "anyone create a shared map" on public.shared_maps;
create policy "anon create unowned shared map"
  on public.shared_maps for insert to anon
  with check (user_id is null);
create policy "auth create own shared map"
  on public.shared_maps for insert to authenticated
  with check (user_id is null or user_id = auth.uid());
