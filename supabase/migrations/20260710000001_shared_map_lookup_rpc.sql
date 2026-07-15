-- ============================================================
-- Shared maps: narrow lookup RPC (step 1 of 2 — ADDITIVE, safe
-- to apply while the current frontend is still deployed).
--
-- Today the frontend reads shared maps with a direct
--   select state from shared_maps where id = :id
-- allowed by an RLS policy equivalent to `using (true)`, which
-- also lets any anonymous client enumerate the whole table.
--
-- This migration adds a controlled lookup function that:
--   * accepts exactly one share identifier,
--   * returns only the map state (never user_id / view_count),
--   * cannot list or filter rows,
--   * returns NULL for unknown identifiers,
--   * bumps view_count as part of the lookup.
--
-- Existing share IDs keep working: they are crypto.randomUUID()
-- values (122 bits of randomness) and remain the lookup key, so
-- no new token column or backfill is required.
--
-- Step 2 (20260710000002) removes the open SELECT policy and must
-- only be applied AFTER the frontend that uses this RPC is live.
--
-- Rollback: drop function public.get_shared_map(text);
-- ============================================================

create or replace function public.get_shared_map(share_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  -- Bounded input: legacy ids are 32 hex chars; reject anything
  -- outside a sane length so the function can't be abused as a
  -- scanning primitive with pathological input.
  if share_id is null or length(share_id) < 8 or length(share_id) > 64 then
    return null;
  end if;

  select s.state into result
  from public.shared_maps s
  where s.id = share_id;

  if result is null then
    return null;
  end if;

  update public.shared_maps
  set view_count = coalesce(view_count, 0) + 1
  where id = share_id;

  return result;
end;
$$;

revoke all on function public.get_shared_map(text) from public;
grant execute on function public.get_shared_map(text) to anon, authenticated;
