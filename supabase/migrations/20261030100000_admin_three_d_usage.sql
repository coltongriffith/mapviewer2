-- Exploration Maps 3D usage and shared maps (2D and 3D) in the admin dashboard.
--
-- /3d now reports what the 2D editor reports: page views through
-- /acquisition.js and product events through /api/track (the same session
-- id, automated flag and allowlist; src/three-d/track.js). The events:
--   three_d_opened            once per tab, a few seconds after the editor opens
--   three_d_data_added        props.kind: collar, assay, survey, topo, mesh,
--                             overlay, litho, geophys, published, terrain
--                             (once per kind per tab); props.source file/drill_db
--   three_d_export_completed  props.kind: png, section, layers; props.format
--   three_d_share_created / three_d_share_viewed / three_d_share_forked
--   three_d_project_saved     props.project, props.created (once per figure per tab)
--   three_d_version_published props.version
--
-- 1. admin_get_three_d_usage(p_start, p_end, p_tz): the "3D & sharing" tab
--    (src/components/admin/ThreeDTab.jsx). Admin only, the same pattern as
--    admin_get_summary: SECURITY DEFINER, is_admin() (admin_users), empty
--    search_path, no execute for public or anon, execute for authenticated.
--    Leaves out what the Overview leaves out: your tabs and automated ones
--    (admin_session_ids), tabs that came from the hosting, database or code
--    dashboards or opened /admin, data-centre towns, and admin accounts.
--    Projects, 3D shares and versions are counted from their own tables
--    (three_d_projects, three_d_shares, figure_versions), so their history
--    reaches back before the events began; opens, exports, data added, views
--    and forks exist only from tracking_since.
--    admin_get_user_three_d(p_user_id): one account's 3D figures, links,
--    versions and exports for the Users tab's drawer, the same pattern.
-- 2. admin_automated_session_ids and admin_get_summary, as in
--    20261019120000_admin_crawler_sessions.sql with only these changes:
--    three_d_opened is something the page does by itself on load, like
--    editor_opened, so it is not engagement; a shared 3D figure
--    (/3d/share/<id>, /3d/embed/<id>, three_d_share_viewed) counts as viewing
--    a shared map, its landing is grouped like /map/… instead of listing each
--    link, and "3D figure maker" joins the features used and the steps.
--
-- Additive: no table, column or data changes; no existing signature changes.
--
-- Rollback:
--   drop function public.admin_get_three_d_usage(timestamptz, timestamptz, text);
--   drop function public.admin_get_user_three_d(uuid);
--   re-run 20261019120000_admin_crawler_sessions.sql.

create or replace function public.admin_automated_session_ids(p_start timestamptz, p_end timestamptz)
returns table(session_id text)
language sql stable security definer
set search_path = 'public', 'pg_temp'
as $$
  select f.session_id
    from (
      select distinct on (pv.session_id) pv.session_id, pv.created_at, pv.utm_source, pv.referrer, pv.country
        from public.page_views pv
        where pv.created_at >= p_start and pv.created_at < p_end and pv.session_id is not null
        order by pv.session_id, pv.created_at
    ) f
    where coalesce(f.referrer, '') = ''
      -- An internal blog or company link opened straight into a fresh tab, or
      -- any page from where the crawler traffic comes from.
      and (rtrim(coalesce(f.utm_source, ''), '/') in ('blog', 'companies') or coalesce(f.country, '') in ('SG', 'CN'))
      and (select count(*) from public.page_views v where v.session_id = f.session_id) = 1
      and not exists (select 1 from public.live_pings l
        where l.session_id = f.session_id and l.created_at >= f.created_at + interval '20 seconds')
      and not exists (select 1 from public.landing_clicks c where c.session_id = f.session_id)
      and not exists (select 1 from public.search_events s where s.session_id = f.session_id)
      and not exists (select 1 from public.export_events x where x.session_id = f.session_id)
      -- Only what the editor does by itself on load: open, show a demo or the
      -- deep-linked claims, and note a "Claim this page" arrival. /3d's open
      -- event is the same kind of thing.
      and not exists (select 1 from public.product_events e
        where e.session_id = f.session_id
          and e.event not in ('editor_opened', 'first_map_checklist_shown', 'first_layer_added',
            'mobile_editor_banner_shown', 'claim_intent', 'three_d_opened')
          and not (e.event = 'layer_added' and coalesce(e.props->>'source', '') in ('demo', 'deeplink')))
$$;

revoke execute on function public.admin_automated_session_ids(timestamptz, timestamptz)
  from authenticated, anon, public;
grant execute on function public.admin_automated_session_ids(timestamptz, timestamptz)
  to service_role;

create or replace function public.admin_get_summary(
  p_start timestamptz, p_end timestamptz, p_tz text default 'America/Vancouver')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with
  admins as (select a.user_id from public.admin_users a),
  -- Your sessions, and separately the automated ones: both stay out of the
  -- counts, but an automated tab is a bot, not you.
  auto_ids as (
    select a.session_id from public.admin_automated_session_ids(p_start - interval '7 days', p_end) a
  ),
  internal_ids as (
    select i.session_id from public.admin_session_ids(p_start - interval '7 days', p_end) i
    except
    select a.session_id from auto_ids a
  ),
  pv as (
    select v.session_id, v.created_at, v.path, nullif(v.referrer, '') as referrer,
      nullif(v.utm_source, '') as utm_source, nullif(v.utm_medium, '') as utm_medium,
      v.city, v.country, v.device, v.user_id
    from public.page_views v
    where v.created_at >= p_start - interval '7 days' and v.created_at < p_end
      and v.session_id is not null
  ),
  sess as (
    select pv.session_id,
      min(pv.created_at) as first_at,
      max(pv.created_at) as last_at,
      count(*) as pages,
      (array_agg(pv.path order by pv.created_at))[1] as landing,
      (array_agg(pv.referrer order by pv.created_at))[1] as referrer,
      (array_agg(pv.utm_source order by pv.created_at))[1] as utm_source,
      (array_agg(pv.utm_medium order by pv.created_at))[1] as utm_medium,
      (array_agg(pv.city order by pv.created_at) filter (where pv.city is not null))[1] as city,
      (array_agg(pv.country order by pv.created_at) filter (where pv.country is not null))[1] as country,
      (array_agg(pv.device order by pv.created_at) filter (where pv.device is not null))[1] as device,
      (array_agg(pv.user_id order by pv.created_at) filter (where pv.user_id is not null))[1] as user_id,
      bool_or(pv.path like '/tenure-monitor%') as tenure_page,
      bool_or(pv.path ~ '^/3d/?$') as three_d_page
    from pv group by pv.session_id
  ),
  -- Events the editor fires by itself on load (demo map, deep link, /3d
  -- opening) are not something a person did; the same list
  -- admin_automated_session_ids uses.
  evs as (
    select e.session_id,
      bool_or(e.event not in ('editor_opened', 'first_map_checklist_shown', 'first_layer_added',
          'mobile_editor_banner_shown', 'internal_session', 'claim_intent', 'three_d_opened')
        and not (e.event = 'layer_added' and coalesce(e.props->>'source', '') in ('demo', 'deeplink'))) as acted,
      bool_or(e.event = 'editor_opened') as opened_editor,
      bool_or(e.event = 'registry_claims_imported'
        or (e.event = 'layer_added' and coalesce(e.props->>'source', '') not in ('demo', 'deeplink'))) as added_data,
      bool_or(e.event in ('export_completed', 'share_created')) as made_map,
      bool_or(e.event in ('share_viewed', 'three_d_share_viewed')) as viewed_share,
      bool_or(e.event like 'tenure\_%') as tenure_event,
      bool_or(e.event like 'three\_d\_%' and e.event <> 'three_d_share_viewed') as three_d_event,
      bool_or(e.event in ('export_gate_shown', 'pro_gate_shown')) as hit_wall,
      bool_or(e.event = 'export_failed') as export_failed,
      bool_or(e.event = 'signup_link_failed') as signup_failed,
      bool_or(e.event = 'mobile_editor_banner_shown') as phone_editor
    from public.product_events e
    where e.created_at >= p_start and e.created_at < p_end
      and e.session_id is not null
    group by e.session_id
  ),
  -- A confirmed signup is credited to the tab it started in.
  signup_sess as (
    select distinct coalesce(nullif(e.props->>'acquisition_session', ''), e.session_id) as session_id
    from public.product_events e
    where e.event = 'signup_completed'
      and e.created_at >= p_start and e.created_at < p_end + interval '1 day'
  ),
  pings as (
    select l.session_id, max(l.created_at) as last_ping
    from public.live_pings l
    where l.created_at >= p_start
    group by l.session_id
  ),
  clicks as (
    select distinct c.session_id from public.landing_clicks c
    where c.created_at >= p_start and c.created_at < p_end
  ),
  searches as (
    select x.session_id, count(*) as n from public.search_events x
    where x.created_at >= p_start and x.created_at < p_end
    group by x.session_id
  ),
  s2 as (
    select s.*,
      s.first_at >= p_start as cur,
      (s.session_id in (select session_id from internal_ids)
        or s.user_id in (select user_id from admins)
        -- Arriving from the hosting, database or code dashboards is you.
        or coalesce(s.referrer, '') ~* '(vercel\.com|vercel\.app|supabase\.co|github\.com|localhost)'
        or s.landing ~ '^/admin/?$') as internal,
      s.session_id in (select session_id from auto_ids) as automated,
      -- Towns that are essentially cloud data centres: automated browsers.
      coalesce(s.city, '') in ('Ashburn', 'Boardman', 'Boydton', 'Council Bluffs', 'The Dalles',
        'Cheyenne', 'Moncks Corner', 'Pryor', 'Lenoir') as datacentre,
      (s.pages > 1
        or p.last_ping >= s.first_at + interval '45 seconds'
        or c.session_id is not null
        or coalesce(x.n, 0) > 0
        or coalesce(ev.acted, false)) as did_something,
      coalesce(ev.opened_editor, false) as opened_editor,
      coalesce(ev.added_data, false) as added_data,
      coalesce(ev.made_map, false) as made_map,
      coalesce(ev.viewed_share, false) or s.landing like '/map/%' or s.landing ~ '^/3d/(share|embed)/' as viewed_share,
      coalesce(ev.tenure_event, false) or s.tenure_page as tenure,
      coalesce(ev.three_d_event, false) or s.three_d_page as three_d,
      coalesce(x.n, 0) > 0 as searched,
      coalesce(ev.hit_wall, false) as hit_wall,
      coalesce(ev.export_failed, false) as export_failed,
      coalesce(ev.signup_failed, false) as signup_failed,
      coalesce(ev.phone_editor, false) as phone_editor,
      ss.session_id is not null as signed_up,
      greatest(s.last_at, p.last_ping) as last_seen
    from sess s
    left join evs ev on ev.session_id = s.session_id
    left join pings p on p.session_id = s.session_id
    left join clicks c on c.session_id = s.session_id
    left join searches x on x.session_id = s.session_id
    left join signup_sess ss on ss.session_id = s.session_id
  ),
  cls as (
    select s2.*,
      case
        when s2.internal then 'you'
        when s2.signed_up then 'engaged'
        when s2.datacentre or s2.automated then 'bot'
        when s2.did_something then 'engaged'
        -- Left at once, but a real site or search engine sent them.
        when s2.referrer is not null and s2.referrer !~* 'explorationmaps\.com' then 'bounced'
        else 'bot'
      end as kind,
      case
        when coalesce(s2.utm_medium, '') ~* 'email' or coalesce(s2.utm_source, '') ~* '(newsletter|email|resend)' then 'Email'
        when s2.referrer ~* '(chatgpt\.com|openai\.com|claude\.ai|perplexity\.ai|gemini\.google|copilot\.microsoft)' then 'AI assistants'
        when s2.referrer ~* '(^|\.)google\.' then 'Google'
        when s2.referrer ~* '(^|\.)bing\.com' then 'Bing'
        when s2.referrer ~* 'duckduckgo\.com' then 'DuckDuckGo'
        when s2.referrer ~* '(yahoo\.|kagi\.com|ecosia\.org|search\.brave\.com|baidu\.com|yandex\.|qwant\.com|startpage\.com)' then 'Other search'
        when s2.referrer ~* 'linkedin\.' or coalesce(s2.utm_source, '') ~* 'linkedin' then 'LinkedIn'
        when s2.referrer ~* '(facebook\.|instagram\.|(^|\.)t\.co$|twitter\.com|(^|\.)x\.com|reddit\.com)'
          or coalesce(s2.utm_source, '') ~* '(facebook|twitter|reddit|instagram)' then 'Other social'
        when s2.landing like '/map/%' or s2.landing ~ '^/3d/(share|embed)/' then 'Shared map links'
        when s2.referrer is not null and s2.referrer !~* 'explorationmaps\.com' then 'Other websites'
        when s2.utm_source is not null and s2.utm_source !~* '^(blog|companies)/?$' then 'Campaigns'
        else 'Direct'
      end as channel
    from s2
  ),
  cur as (select * from cls where cls.cur),
  people as (select * from cur where cur.kind in ('engaged', 'bounced')),
  -- Errors and failed searches count only real visitors' tabs: not yours, not bots.
  real_ids as (select cls.session_id from cls where cls.kind in ('engaged', 'bounced')),
  new_users as (
    select u.id, u.email, u.created_at, u.email_confirmed_at,
      u.raw_user_meta_data->'em_acquisition' as acq
    from auth.users u
    where u.created_at >= p_start and u.created_at < p_end
      and u.id not in (select user_id from admins)
  ),
  day_series as (
    select g::date as d
    from generate_series((p_start at time zone p_tz)::date, (p_end at time zone p_tz)::date - 1, interval '1 day') g
  ),
  errs as (
    select coalesce(nullif(er.fingerprint, ''), left(er.message, 160)) as k,
      (array_agg(er.message order by er.occurred_at desc))[1] as message,
      (array_agg(er.path order by er.occurred_at desc))[1] as path,
      sum(coalesce(er.seen_count, 1)) as times,
      count(distinct er.session_id) as people,
      max(er.occurred_at) as last_seen
    from public.error_events er
    where er.occurred_at >= p_start and er.occurred_at < p_end
      and er.session_id in (select session_id from real_ids)
    group by 1
  ),
  failed as (
    select lower(trim(x.query_text)) as q, upper(coalesce(x.province, '')) as province, x.kind,
      count(*) as times, max(x.created_at) as last_seen,
      bool_or(x.outcome = 'error') as errored
    from public.search_events x
    where x.created_at >= p_start and x.created_at < p_end
      and (x.outcome in ('empty', 'error') or coalesce(x.result_count, 0) = 0)
      and x.session_id in (select session_id from real_ids)
      and nullif(trim(x.query_text), '') is not null
    group by 1, 2, 3
  ),
  agent_maps as (
    select m.created_at, m.user_id, m.creator_key
    from public.shared_maps m
    where m.created_at >= p_start and m.created_at < p_end
      and (m.creator_key ~ '^[0-9a-f]{48}$'
        or m.state->'layers' @> '[{"dataSource": "agent_registry"}]'::jsonb)
      and (m.user_id is null or m.user_id not in (select user_id from admins))
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'people', (select count(*) from people),
      'engaged', (select count(*) from people where kind = 'engaged'),
      'bounced', (select count(*) from people where kind = 'bounced'),
      'made_map', (select count(*) from people where made_map),
      'signups', (select count(*) from new_users where created_at >= p_start),
      'you', (select count(*) from cur where kind = 'you'),
      'bots', (select count(*) from cur where kind = 'bot')
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'd', ds.d,
        'engaged', (select count(*) from people p where p.kind = 'engaged' and (p.first_at at time zone p_tz)::date = ds.d),
        'bounced', (select count(*) from people p where p.kind = 'bounced' and (p.first_at at time zone p_tz)::date = ds.d),
        'signups', (select count(*) from new_users u where (u.created_at at time zone p_tz)::date = ds.d)
      ) order by ds.d), '[]'::jsonb)
      from day_series ds
    ),
    'sources', (
      select coalesce(jsonb_agg(r order by (r->>'people')::int desc, r->>'channel'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'channel', p.channel,
          'people', count(*),
          'engaged', count(*) filter (where p.kind = 'engaged'),
          'made_map', count(*) filter (where p.made_map),
          'signups', count(*) filter (where p.signed_up),
          'sites', (select coalesce(jsonb_agg(t.referrer order by t.n desc), '[]'::jsonb) from (
              select q.referrer, count(*) as n from people q
              where q.channel = p.channel and q.referrer is not null
              group by q.referrer order by count(*) desc limit 3) t)
        ) as r
        from people p group by p.channel
      ) sources
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', t.path, 'people', t.people, 'engaged', t.engaged)
        order by t.people desc, t.path), '[]'::jsonb)
      from (
        select case when p.landing like '/map/%' then '/map/… (shared maps)'
            when p.landing ~ '^/3d/(share|embed)/' then '/3d/share/… (shared 3D figures)'
            else coalesce(nullif(rtrim(p.landing, '/'), ''), '/') end as path,
          count(*) as people, count(*) filter (where p.kind = 'engaged') as engaged
        from people p group by 1 order by 2 desc, 1 limit 8
      ) t
    ),
    'usage', jsonb_build_object(
      'steps', jsonb_build_array(
        jsonb_build_object('key', 'visited', 'label', 'Visited', 'n', (select count(*) from people)),
        jsonb_build_object('key', 'engaged', 'label', 'Stayed or did something', 'n', (select count(*) from people where kind = 'engaged')),
        jsonb_build_object('key', 'editor', 'label', 'Opened the map editor', 'n', (select count(*) from people where opened_editor)),
        jsonb_build_object('key', 'data', 'label', 'Added data to a map', 'n', (select count(*) from people where added_data)),
        jsonb_build_object('key', 'made', 'label', 'Exported or shared a map', 'n', (select count(*) from people where made_map)),
        jsonb_build_object('key', 'signup', 'label', 'Signed up', 'n', (select count(*) from people where signed_up))
      ),
      'features', jsonb_build_array(
        jsonb_build_object('label', 'Map editor', 'n', (select count(*) from people where opened_editor)),
        jsonb_build_object('label', 'Claim search', 'n', (select count(*) from people where searched)),
        jsonb_build_object('label', 'Viewed a shared map', 'n', (select count(*) from people where viewed_share)),
        jsonb_build_object('label', 'Tenure Monitor', 'n', (select count(*) from people where tenure)),
        jsonb_build_object('label', '3D figure maker', 'n', (select count(*) from people where three_d))
      ),
      'ai', jsonb_build_object(
        'maps', (select count(*) from agent_maps),
        'chats', (select count(distinct coalesce(a.creator_key, a.user_id::text)) from agent_maps a),
        'signed_in', (select count(*) from agent_maps a where a.user_id is not null)
      )
    ),
    'problems', jsonb_build_object(
      'errors', (
        select coalesce(jsonb_agg(jsonb_build_object('message', e.message, 'path', e.path, 'times', e.times,
          'people', e.people, 'last_seen', e.last_seen) order by e.people desc, e.times desc), '[]'::jsonb)
        from (select * from errs order by people desc, times desc limit 6) e
      ),
      'failed_searches', (
        select coalesce(jsonb_agg(jsonb_build_object('query', f.q, 'province', f.province, 'kind', f.kind,
          'times', f.times, 'errored', f.errored, 'last_seen', f.last_seen) order by f.times desc, f.last_seen desc), '[]'::jsonb)
        from (select * from failed order by times desc, last_seen desc limit 8) f
      ),
      'stuck', jsonb_build_array(
        jsonb_build_object('key', 'no_data', 'label', 'Opened the editor but added no data', 'n', (select count(*) from people where opened_editor and not added_data and not made_map)),
        jsonb_build_object('key', 'no_output', 'label', 'Added data but did not export or share', 'n', (select count(*) from people where added_data and not made_map)),
        jsonb_build_object('key', 'wall', 'label', 'Hit a sign-up or Pro prompt and did not sign up', 'n', (select count(*) from people where hit_wall and not signed_up)),
        jsonb_build_object('key', 'export_failed', 'label', 'An export failed', 'n', (select count(*) from people where export_failed)),
        jsonb_build_object('key', 'signup_failed', 'label', 'Sign-up email failed to send', 'n', (select count(*) from people where signup_failed)),
        jsonb_build_object('key', 'phone', 'label', 'Opened the editor on a phone', 'n', (select count(*) from people where phone_editor))
      ),
      'feedback_open', (select count(*) from public.feedback fb where coalesce(fb.status, 'new') = 'new')
    ),
    'signups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.id, 'email', u.email, 'created_at', u.created_at, 'confirmed', u.email_confirmed_at is not null,
        'landing', u.acq->>'landing_path', 'source', coalesce(nullif(u.acq->>'utm_source', ''), nullif(u.acq->>'referrer', '')),
        'session_id', u.acq->>'acquisition_session'
      ) order by u.created_at desc), '[]'::jsonb)
      from new_users u where u.created_at >= p_start
    ),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'session_id', r.session_id, 'first_at', r.first_at, 'last_seen', r.last_seen, 'pages', r.pages,
        'city', r.city, 'country', r.country, 'device', r.device, 'channel', r.channel, 'referrer', r.referrer,
        'landing', r.landing, 'email', (select u.email from auth.users u where u.id = r.user_id),
        'user_id', r.user_id, 'steps', r.steps
      ) order by r.first_at desc), '[]'::jsonb)
      from (
        select p.*, (
          select coalesce(jsonb_agg(t.label order by t.at), '[]'::jsonb) from (
            select st.label, min(st.at) as at from (
              select e.created_at as at, case
                  when e.event = 'editor_opened' then 'Opened editor'
                  when e.event = 'registry_claims_imported'
                    or (e.event = 'layer_added' and coalesce(e.props->>'source', '') not in ('demo', 'deeplink')) then 'Added data'
                  when e.event = 'export_completed' then 'Exported'
                  when e.event = 'share_created' then 'Shared'
                  when e.event in ('share_viewed', 'three_d_share_viewed') then 'Viewed shared map'
                  when e.event = 'three_d_opened' then 'Opened 3D'
                  when e.event = 'three_d_data_added' then 'Added 3D data'
                  when e.event = 'three_d_export_completed' then 'Exported 3D'
                  when e.event = 'three_d_share_created' then 'Shared 3D'
                  when e.event in ('three_d_project_saved', 'three_d_share_forked', 'three_d_version_published') then 'Saved 3D'
                  when e.event like 'tenure\_%' then 'Tenure Monitor'
                  when e.event in ('export_gate_shown', 'pro_gate_shown') then 'Hit sign-up prompt'
                  when e.event = 'signup_link_sent' then 'Started sign-up'
                  when e.event = 'signup_completed' then 'Signed up'
                  when e.event in ('export_failed', 'signup_link_failed') then 'Error'
                end as label
              from public.product_events e where e.session_id = p.session_id
              union all
              select x.created_at, 'Searched claims' from public.search_events x where x.session_id = p.session_id
              union all
              select er.occurred_at, 'Error' from public.error_events er where er.session_id = p.session_id
              union all
              select v.created_at, 'Tenure Monitor' from public.page_views v
                where v.session_id = p.session_id and v.path like '/tenure-monitor%'
            ) st where st.label is not null group by st.label
          ) t
        ) as steps
        from people p where p.kind = 'engaged'
        order by p.first_at desc limit 30
      ) r
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_get_summary(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_get_summary(timestamptz, timestamptz, text) to authenticated;

-- ── The 3D & sharing report ─────────────────────────────────────────────────
create or replace function public.admin_get_three_d_usage(
  p_start timestamptz, p_end timestamptz, p_tz text default 'America/Vancouver')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with
  admins as (select a.user_id from public.admin_users a where a.user_id is not null),
  -- Tabs the Overview leaves out (admin_get_summary's "you" and "bot"): your
  -- tabs and automated ones, tabs from the hosting, database or code
  -- dashboards or that opened /admin, admin accounts, and data-centre towns.
  pv_sess as (
    select v.session_id,
      (array_agg(nullif(v.referrer, '') order by v.created_at))[1] as referrer,
      (array_agg(v.path order by v.created_at))[1] as landing,
      (array_agg(v.city order by v.created_at) filter (where v.city is not null))[1] as city,
      coalesce(bool_or(v.user_id in (select user_id from admins)), false) as admin_user
    from public.page_views v
    where v.created_at >= p_start - interval '7 days' and v.created_at < p_end
      and v.session_id is not null
    group by v.session_id
  ),
  skip as (
    select i.session_id from public.admin_session_ids(p_start - interval '7 days', p_end) i
      where i.session_id is not null
    union
    select s.session_id from pv_sess s
      where s.admin_user
        or coalesce(s.referrer, '') ~* '(vercel\.com|vercel\.app|supabase\.co|github\.com|localhost)'
        or s.landing ~ '^/admin/?$'
        or coalesce(s.city, '') in ('Ashburn', 'Boardman', 'Boydton', 'Council Bluffs', 'The Dalles',
          'Cheyenne', 'Moncks Corner', 'Pryor', 'Lenoir')
  ),
  -- 3D events, and 2D share views, from real visitors.
  ev as (
    select e.session_id, e.user_id, e.event, e.props, e.created_at, (e.created_at at time zone p_tz)::date as d
    from public.product_events e
    where e.created_at >= p_start and e.created_at < p_end
      and (e.event like 'three\_d\_%' or e.event = 'share_viewed')
      and e.session_id is not null
      and (e.user_id is null or e.user_id not in (select user_id from admins))
      and not exists (select 1 from skip k where k.session_id = e.session_id)
  ),
  pv as (
    select v.session_id, v.path, (v.created_at at time zone p_tz)::date as d
    from public.page_views v
    where v.created_at >= p_start and v.created_at < p_end
      and v.session_id is not null
      and (v.path ~ '^/3d(/|$)' or v.path like '/map/%')
      and (v.user_id is null or v.user_id not in (select user_id from admins))
      and not exists (select 1 from skip k where k.session_id = v.session_id)
  ),
  -- A tab that opened the 3D editor: its open event, or a page view of /3d
  -- (the page view alone covers a browser that blocks the event).
  opens as (
    select ev.session_id, ev.d from ev where ev.event = 'three_d_opened'
    union
    select pv.session_id, pv.d from pv where pv.path ~ '^/3d/?$'
  ),
  views_3d as (
    select ev.session_id, ev.d from ev where ev.event = 'three_d_share_viewed'
    union
    select pv.session_id, pv.d from pv where pv.path ~ '^/3d/(share|embed)/'
  ),
  views_2d as (
    select ev.session_id, ev.d from ev where ev.event = 'share_viewed'
    union
    select pv.session_id, pv.d from pv where pv.path like '/map/%'
  ),
  projects as (
    select p.id, p.name, p.user_id, p.created_at, p.updated_at, p.deleted_at
    from public.three_d_projects p
    where p.user_id not in (select user_id from admins)
  ),
  -- Saved again after it was made (a soft delete also moves updated_at, so a
  -- deleted figure is counted as deleted, not updated).
  created_p as (select * from projects p where p.created_at >= p_start and p.created_at < p_end),
  updated_p as (
    select * from projects p
    where p.updated_at >= p_start and p.updated_at < p_end
      and p.updated_at > p.created_at + interval '1 minute' and p.deleted_at is null
  ),
  shares_3d as (
    select s.id, s.user_id, s.project_id, s.created_at, s.revoked_at, s.expires_at, s.view_count, s.last_viewed_at,
      nullif(left(coalesce(s.state->'settings'->>'title', ''), 200), '') as title
    from public.three_d_shares s
    where s.user_id is null or s.user_id not in (select user_id from admins)
  ),
  shares_2d as (
    select m.id, m.user_id, m.created_at, m.revoked_at, m.expires_at, coalesce(m.view_count, 0) as view_count,
      m.last_viewed_at, nullif(left(coalesce(m.state->'layout'->>'title', ''), 200), '') as title,
      (m.creator_key ~ '^[0-9a-f]{48}$' or m.state->'layers' @> '[{"dataSource": "agent_registry"}]'::jsonb) as agent
    from public.shared_maps m
    where m.user_id is null or m.user_id not in (select user_id from admins)
  ),
  versions as (
    select f.figure_id, f.published_by, f.created_at
    from public.figure_versions f
    where f.figure_kind = 'figure' and f.created_at >= p_start and f.created_at < p_end
      and (f.published_by is null or f.published_by not in (select user_id from admins))
  ),
  -- Signed-in people who worked in 3D: their events (not share views, which
  -- are passive), and the tables for the time before the events.
  actives as (
    select ev.d, ev.user_id from ev where ev.user_id is not null and ev.event like 'three\_d\_%' and ev.event <> 'three_d_share_viewed'
    union
    select (p.created_at at time zone p_tz)::date, p.user_id from created_p p
    union
    select (p.updated_at at time zone p_tz)::date, p.user_id from updated_p p
    union
    select (s.created_at at time zone p_tz)::date, s.user_id from shares_3d s
      where s.user_id is not null and s.created_at >= p_start and s.created_at < p_end
    union
    select (f.created_at at time zone p_tz)::date, f.published_by from versions f where f.published_by is not null
  ),
  day_series as (
    select g::date as d
    from generate_series((p_start at time zone p_tz)::date, (p_end at time zone p_tz)::date - 1, interval '1 day') g
  ),
  saves as (
    select ev.props->>'project' as project_id, count(*) as n
    from ev where ev.event = 'three_d_project_saved' and ev.props ? 'project'
    group by 1
  ),
  proj_activity as (
    select p.id, p.name, p.user_id, p.created_at, p.updated_at, p.deleted_at,
      greatest(coalesce(sv.n, 0),
        case when (p.created_at >= p_start and p.created_at < p_end) or (p.updated_at >= p_start and p.updated_at < p_end) then 1 else 0 end) as saves,
      (select count(*) from shares_3d s where s.project_id = p.id and s.created_at >= p_start and s.created_at < p_end) as shares,
      (select coalesce(sum(s.view_count), 0) from shares_3d s where s.project_id = p.id and s.revoked_at is null) as share_views,
      (select count(*) from versions f where f.figure_id = p.id) as versions
    from projects p
    left join saves sv on sv.project_id = p.id::text
  ),
  top_shares as (
    select 'map' as kind, m.id, m.title, m.user_id, m.view_count, m.created_at, m.last_viewed_at, '/map/' || m.id as path, m.agent
    from shares_2d m
    where m.revoked_at is null and (m.expires_at is null or m.expires_at > now())
      and ((m.created_at >= p_start and m.created_at < p_end) or (m.last_viewed_at >= p_start and m.last_viewed_at < p_end))
    union all
    select 'figure', s.id, s.title, s.user_id, s.view_count, s.created_at, s.last_viewed_at, '/3d/share/' || s.id, false
    from shares_3d s
    where s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
      and ((s.created_at >= p_start and s.created_at < p_end) or (s.last_viewed_at >= p_start and s.last_viewed_at < p_end))
  )
  select jsonb_build_object(
    'tracking_since', (select min(e.created_at) from public.product_events e where e.event = 'three_d_opened'),
    'totals', jsonb_build_object(
      'opens', (select count(distinct o.session_id) from opens o),
      'active_users', (select count(distinct a.user_id) from actives a),
      'data_sessions', (select count(distinct ev.session_id) from ev where ev.event = 'three_d_data_added'),
      'exports', (select count(*) from ev where ev.event = 'three_d_export_completed'),
      'export_sessions', (select count(distinct ev.session_id) from ev where ev.event = 'three_d_export_completed'),
      'projects_created', (select count(*) from created_p),
      'projects_updated', (select count(*) from updated_p),
      'projects_deleted', (select count(*) from projects p where p.deleted_at >= p_start and p.deleted_at < p_end),
      'saves', (select count(*) from ev where ev.event = 'three_d_project_saved'),
      'versions', (select count(*) from versions),
      'shares_created', (select count(*) from shares_3d s where s.created_at >= p_start and s.created_at < p_end),
      'share_views', (select count(*) from views_3d),
      'share_forks', (select count(*) from ev where ev.event = 'three_d_share_forked')
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'd', ds.d,
        'opens', (select count(distinct o.session_id) from opens o where o.d = ds.d),
        'active_users', (select count(distinct a.user_id) from actives a where a.d = ds.d),
        'exports', (select count(*) from ev where ev.event = 'three_d_export_completed' and ev.d = ds.d),
        'projects_created', (select count(*) from created_p p where (p.created_at at time zone p_tz)::date = ds.d),
        'projects_updated', (select count(*) from updated_p p where (p.updated_at at time zone p_tz)::date = ds.d)
      ) order by ds.d), '[]'::jsonb)
      from day_series ds
    ),
    'exports_by_kind', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'n', t.n, 'sessions', t.sessions)
        order by t.n desc, t.kind), '[]'::jsonb)
      from (
        select coalesce(nullif(ev.props->>'kind', ''), 'png') as kind, count(*) as n, count(distinct ev.session_id) as sessions
        from ev where ev.event = 'three_d_export_completed' group by 1
      ) t
    ),
    'data_by_kind', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'sessions', t.sessions)
        order by t.sessions desc, t.kind), '[]'::jsonb)
      from (
        select coalesce(nullif(ev.props->>'kind', ''), 'unknown') as kind, count(distinct ev.session_id) as sessions
        from ev where ev.event = 'three_d_data_added' group by 1
      ) t
    ),
    'top_projects', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'owner_email', (select u.email from auth.users u where u.id = t.user_id),
        'user_id', t.user_id, 'created_at', t.created_at, 'updated_at', t.updated_at, 'deleted', t.deleted_at is not null,
        'saves', t.saves, 'shares', t.shares, 'share_views', t.share_views, 'versions', t.versions,
        'activity', t.saves + t.shares + t.versions
      ) order by t.saves + t.shares + t.versions desc, t.updated_at desc), '[]'::jsonb)
      from (
        select * from proj_activity a where a.saves + a.shares + a.versions > 0
        order by a.saves + a.shares + a.versions desc, a.updated_at desc limit 10
      ) t
    ),
    'shared_maps', jsonb_build_object(
      'totals', jsonb_build_object(
        'created_2d', (select count(*) from shares_2d m where m.created_at >= p_start and m.created_at < p_end),
        'created_2d_agent', (select count(*) from shares_2d m where m.created_at >= p_start and m.created_at < p_end and m.agent),
        'created_3d', (select count(*) from shares_3d s where s.created_at >= p_start and s.created_at < p_end),
        'viewed_2d', (select count(*) from views_2d),
        'viewed_3d', (select count(*) from views_3d),
        'live_2d', (select count(*) from shares_2d m where m.revoked_at is null and (m.expires_at is null or m.expires_at > now())),
        'live_3d', (select count(*) from shares_3d s where s.revoked_at is null and (s.expires_at is null or s.expires_at > now())),
        'lifetime_views_2d', (select coalesce(sum(m.view_count), 0) from shares_2d m),
        'lifetime_views_3d', (select coalesce(sum(s.view_count), 0) from shares_3d s)
      ),
      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'd', ds.d,
          'created_2d', (select count(*) from shares_2d m where m.created_at >= p_start and m.created_at < p_end and (m.created_at at time zone p_tz)::date = ds.d),
          'created_3d', (select count(*) from shares_3d s where s.created_at >= p_start and s.created_at < p_end and (s.created_at at time zone p_tz)::date = ds.d),
          'viewed_2d', (select count(*) from views_2d v where v.d = ds.d),
          'viewed_3d', (select count(*) from views_3d v where v.d = ds.d)
        ) order by ds.d), '[]'::jsonb)
        from day_series ds
      ),
      'top', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'kind', t.kind, 'title', t.title, 'owner_email', (select u.email from auth.users u where u.id = t.user_id),
          'user_id', t.user_id, 'agent', t.agent, 'views', t.view_count, 'created_at', t.created_at,
          'last_viewed_at', t.last_viewed_at, 'path', t.path
        ) order by t.view_count desc, t.created_at desc), '[]'::jsonb)
        from (select * from top_shares order by view_count desc, created_at desc limit 10) t
      )
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_get_three_d_usage(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_get_three_d_usage(timestamptz, timestamptz, text) to authenticated;

-- ── One account's 3D use (the Users tab's account drawer) ───────────────────
-- A report of its own rather than a change to admin_get_user_detail, so the
-- drawer opens as before wherever this one is missing or fails.
create or replace function public.admin_get_user_three_d(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'project_count', (select count(*) from public.three_d_projects p where p.user_id = p_user_id and p.deleted_at is null),
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'created_at', t.created_at,
        'updated_at', t.updated_at, 'deleted', t.deleted_at is not null) order by t.updated_at desc), '[]'::jsonb)
      from (select p.id, p.name, p.created_at, p.updated_at, p.deleted_at from public.three_d_projects p
        where p.user_id = p_user_id order by p.updated_at desc limit 10) t
    ),
    'shares', (select count(*) from public.three_d_shares s where s.user_id = p_user_id and s.revoked_at is null),
    'share_views', (select coalesce(sum(s.view_count), 0) from public.three_d_shares s where s.user_id = p_user_id),
    'versions', (select count(*) from public.figure_versions f where f.figure_kind = 'figure' and f.published_by = p_user_id),
    'exports', (select count(*) from public.product_events e where e.user_id = p_user_id and e.event = 'three_d_export_completed'),
    'last_active', greatest(
      (select max(e.created_at) from public.product_events e where e.user_id = p_user_id and e.event like 'three\_d\_%'),
      (select max(p.updated_at) from public.three_d_projects p where p.user_id = p_user_id))
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_get_user_three_d(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_user_three_d(uuid) to authenticated;
