-- ============================================================
-- Analytics ingestion lockdown (step 2 — apply ONLY after the
-- frontend that posts to /api/track is deployed AND the
-- SUPABASE_SERVICE_ROLE_KEY env var is configured in Vercel;
-- /api/track writes with the service role, which bypasses RLS).
--
-- Removes every direct anonymous/authenticated write path to the
-- analytics tables. From here on, ingestion happens exclusively
-- through /api/track, which enforces:
--   * an event-name allowlist,
--   * payload size / depth / string-length limits,
--   * server-derived geo (client-supplied coordinates ignored),
--   * verified-JWT user attribution,
--   * per-IP rate limits.
--
-- export_events is intentionally NOT touched: its policies already
-- bind user_id to auth.uid() and it is out of this remediation's
-- scope list.
--
-- Rollback: re-create the dropped policies (definitions preserved
-- in supabase-admin-setup.sql / supabase-product-events-setup.sql)
-- and re-grant insert/update to anon, authenticated per table.
-- ============================================================

-- live_pings: no more direct heartbeat writes from browsers.
drop policy if exists "anyone upsert own ping" on public.live_pings;
drop policy if exists "anyone update own ping" on public.live_pings;
revoke insert, update on table public.live_pings from anon, authenticated;

-- leads
drop policy if exists "anyone insert lead" on public.leads;
revoke insert on table public.leads from anon, authenticated;

-- page_views
drop policy if exists "anyone insert page view" on public.page_views;
revoke insert on table public.page_views from anon, authenticated;

-- landing_clicks
drop policy if exists "anyone insert landing click" on public.landing_clicks;
revoke insert on table public.landing_clicks from anon, authenticated;

-- search_events
drop policy if exists "anyone insert search event" on public.search_events;
revoke insert on table public.search_events from anon, authenticated;

-- product_events
drop policy if exists "anon insert product events" on public.product_events;
drop policy if exists "auth insert product events" on public.product_events;
revoke insert on table public.product_events from anon, authenticated;
