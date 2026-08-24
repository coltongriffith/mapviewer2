-- The session timeline was missing every product event.
--
-- admin_get_session_timeline unions page_views, search_events, export_events,
-- leads and landing_clicks. product_events — the table that records what
-- somebody actually DID in the editor (editor_opened, project_created,
-- layer_added, share_created, export_failed, the whole tenure funnel) — was
-- never in that union, even though it carries session_id and is indexed on it
-- (product_events_session_idx).
--
-- So the modal under-reported every session. Session 1787494828495-… on
-- 2026-08-23 has four rows across the analytics tables:
--
--   14:20:28.787  product_event  editor_opened
--   14:20:28.798  product_event  mobile_editor_banner_shown
--   14:20:28.803  page_view      /
--   14:20:35.395  search         registry qc · 0 results
--
-- and the timeline showed two of them. The visitor arrived on a phone, got the
-- mobile banner, and searched Quebec 7 seconds later — the two events that
-- explain the visit were the two that were dropped.
--
-- Worse than incomplete: the two dashboard-v2 feeds (Overview "Activity feed",
-- the user drawer's "Recent activity") are built FROM product_events and each
-- row offers a Timeline button. Clicking one opened a timeline that could not
-- contain the event clicked, and a session whose only activity is product
-- events rendered "No tracked events for this session".
--
-- Fixes the gap by unioning product_events in as kind 'product'. Everything
-- else about the function is unchanged.
--
-- search_path is set to public, pg_catalog — matching is_admin() and NOT the
-- deployed definition, which carried pg_temp. A security-definer function that
-- resolves names through the caller-writable temp schema is the pattern
-- tests/admin-rpc-contract.test.js pins against.
--
-- Rollback: re-run the definition in supabase-admin-setup.sql (the version
-- without the product_events branch).

create or replace function public.admin_get_session_timeline(p_session_id text)
returns table (event_time timestamptz, kind text, detail text)
language sql security definer stable
set search_path = public, pg_catalog as $$
  select pv.created_at, 'page_view'::text,
    coalesce(pv.path, '/') || coalesce(' via ' || nullif(pv.referrer, ''), '')
  from public.page_views pv where pv.session_id = p_session_id and is_admin()
  union all
  select se.created_at, 'search'::text,
    coalesce(se.kind, 'registry') || ' search · ' || coalesce(upper(se.province), '?')
      || ' · ' || coalesce(se.result_count::text, '0') || ' results'
      -- outcome distinguishes a genuine miss from a failed request; both carry
      -- result_count 0, so without it a broken province reads as an unpopular
      -- one (migration 20260805000001).
      || coalesce(' (' || nullif(se.outcome, 'ok') || ')', '')
  from public.search_events se where se.session_id = p_session_id and is_admin()
  union all
  select ee.created_at, 'export'::text,
    -- coalesce, not a bare concat: one null column would make the whole detail
    -- null and the row would render as a label with nothing after it.
    coalesce(upper(ee.format), '?') || ' export · ' || coalesce(ee.project_name, 'Untitled')
      || case when ee."noWatermark" then ' (no watermark)' else '' end
  from public.export_events ee where ee.session_id = p_session_id and is_admin()
  union all
  select l.captured_at, 'lead'::text, 'Email captured: ' || l.email
  from public.leads l where l.session_id = p_session_id and is_admin()
  union all
  select lc.created_at, 'click'::text, 'Clicked ' || coalesce(lc.element, '(unlabeled)')
  from public.landing_clicks lc where lc.session_id = p_session_id and is_admin()
  union all
  select pe.created_at, 'product'::text,
    replace(pe.event, '_', ' ')
      || coalesce(' · ' || nullif(left((
           -- props is small (2 KB cap, enforced in api/track.js) and free-form,
           -- so render it as key=value rather than naming keys this function
           -- would then have to keep in step with the event taxonomy.
           select string_agg(k || '=' || left(coalesce(v #>> '{}', ''), 40), ', ' order by k)
           from jsonb_each(case when jsonb_typeof(pe.props) = 'object'
                                then pe.props else '{}'::jsonb end) as p(k, v)
         ), 160), ''), '')
  from public.product_events pe where pe.session_id = p_session_id and is_admin()
  order by 1 asc;
$$;

-- Same posture as every other admin RPC: reachable by signed-in users, gated
-- on is_admin() inside; never anon or public.
revoke all on function public.admin_get_session_timeline(text) from anon, public;
grant execute on function public.admin_get_session_timeline(text) to authenticated;

-- Verification (as an admin):
--   select * from public.admin_get_session_timeline('1787494828495-e60mnu7f1t');
--   -- expect 4 rows: product, product, page_view, search
