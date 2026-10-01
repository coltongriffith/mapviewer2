-- Keep the owner's signed-out testing and crawler traffic out of customer
-- reports.
--
-- admin_session_ids() is the one exclusion list behind every report that
-- leaves admins out: admin_get_growth, admin_get_daily_activity,
-- admin_get_day_activity, admin_get_engagement and admin_get_overview. It only
-- knew sessions tied to an admin_users account, so two kinds of non-customer
-- traffic were counted as visitors:
--
--   internal   The owner testing while signed out (a private window, or before
--              signing in). On 2026-09-22/23 this read as new visitors and the
--              only "customer" export in four weeks. A browser the owner marks
--              as internal (by opening the admin dashboard, or ?em_internal=1 on
--              any page — see public/acquisition.js) now sends an
--              `internal_session` event once per tab.
--
--   automated  Crawlers following the blog and company-page CTA links. Each
--              lands directly on /?utm_source=blog|companies with no referrer,
--              the editor opens and fires its load-time events, and the tab is
--              gone before the first 25 s heartbeat. The growth funnel counted
--              each as "opened editor" (and "imported" for company links, which
--              preload claims): 25-45 a week in September. A person who clicks
--              the same link arrives with our own site as referrer.
--
-- The automated rule is deliberately narrow. Every condition must hold, so a
-- person who arrived on a CTA link and did anything — stayed to the heartbeat,
-- clicked, searched, imported, uploaded, exported, opened a second page — is
-- still counted. Crawlers that announce themselves are dropped earlier, in
-- api/track.js.
--
-- Rollback: recreate the function with only its first two branches (the
-- admin_users joins); the grants below stay as they are.

create or replace function public.admin_session_ids(p_start timestamptz, p_end timestamptz)
returns table(session_id text)
language sql stable security definer
set search_path = 'public', 'pg_temp'
as $$
  select distinct pe.session_id
    from public.product_events pe
    join public.admin_users a on a.user_id = pe.user_id
    where pe.created_at >= p_start and pe.created_at < p_end
  union
  select distinct pv.session_id
    from public.page_views pv
    join public.admin_users a on a.user_id = pv.user_id
    where pv.created_at >= p_start and pv.created_at < p_end
  union
  -- Internal. The marker is sent when the tab opens, which can be before the
  -- window starts.
  select distinct pe.session_id
    from public.product_events pe
    where pe.event = 'internal_session'
      and pe.created_at >= p_start - interval '1 day' and pe.created_at < p_end
  union
  -- Automated: a direct hit on a CTA link that did nothing a person would.
  select f.session_id
    from (
      select distinct on (pv.session_id) pv.session_id, pv.created_at, pv.utm_source, pv.referrer
        from public.page_views pv
        where pv.created_at >= p_start and pv.created_at < p_end and pv.session_id is not null
        order by pv.session_id, pv.created_at
    ) f
    where rtrim(f.utm_source, '/') in ('blog', 'companies')
      and coalesce(f.referrer, '') = ''
      and (select count(*) from public.page_views v where v.session_id = f.session_id) = 1
      -- live_pings keeps each tab's latest heartbeat; the first repeat is at 25 s.
      and not exists (select 1 from public.live_pings l
        where l.session_id = f.session_id and l.created_at >= f.created_at + interval '20 seconds')
      and not exists (select 1 from public.landing_clicks c where c.session_id = f.session_id)
      and not exists (select 1 from public.search_events s where s.session_id = f.session_id)
      and not exists (select 1 from public.export_events x where x.session_id = f.session_id)
      -- Only events the editor fires by itself on load; anything else, or a
      -- layer without a known automatic source, means someone did something.
      and not exists (select 1 from public.product_events e
        where e.session_id = f.session_id
          and e.event not in ('editor_opened', 'first_map_checklist_shown', 'first_layer_added', 'mobile_editor_banner_shown')
          and not (e.event = 'layer_added' and coalesce(e.props->>'source', '') in ('demo', 'deeplink')))
$$;

-- Still an internal helper, not an endpoint (see 20260813000004).
revoke execute on function public.admin_session_ids(timestamptz, timestamptz)
  from authenticated, anon, public;
grant execute on function public.admin_session_ids(timestamptz, timestamptz)
  to service_role;
