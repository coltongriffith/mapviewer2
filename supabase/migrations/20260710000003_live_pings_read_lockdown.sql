-- ============================================================
-- live_pings: remove public reads (SAFE TO APPLY IMMEDIATELY).
--
-- live_pings was world-readable: any anonymous client could select
-- every visitor's session_id, coordinates, and city. The deployed
-- frontend only ever INSERT/UPDATEs (upsert heartbeat) and never
-- selects, so revoking SELECT closes the exposure without breaking
-- anything currently in production.
--
-- The admin live-visitors dashboard reads through the SECURITY
-- DEFINER functions admin_get_live_visitors()/admin_get_live_locations()
-- and is unaffected.
--
-- Write lockdown (INSERT/UPDATE) happens in 20260710000004 after the
-- frontend that pings via /api/track is deployed.
--
-- Rollback:
--   grant select on table public.live_pings to anon, authenticated;
--   create policy "anyone select live pings"
--     on public.live_pings for select to anon, authenticated using (true);
-- ============================================================

drop policy if exists "anyone select live pings" on public.live_pings;
revoke select on table public.live_pings from anon, authenticated;
