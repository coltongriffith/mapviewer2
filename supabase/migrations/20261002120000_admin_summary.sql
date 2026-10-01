-- One simple admin report: real people (not you, not bots), where they came
-- from, what they did, where they got stuck, and who they were. Replaces the
-- Growth, Activity, Product, Acquisition and Health tabs.
--
-- A tab session is one of:
--   you      admin account, internal marker, automated CTA hit, arrived from
--            the hosting/database/code dashboards, or landed on /admin
--   bot      a data-centre town, or left at once with no referrer
--   bounced  left at once, but a real site or search engine sent them
--   engaged  more than one page, stayed 45 s+, clicked, searched, did
--            something in the editor, or signed up
-- "People" are engaged + bounced.

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
  internal_ids as (
    select i.session_id from public.admin_session_ids(p_start, p_end) i
  ),
  pv as (
    select v.session_id, v.created_at, v.path, nullif(v.referrer, '') as referrer,
      nullif(v.utm_source, '') as utm_source, nullif(v.utm_medium, '') as utm_medium,
      v.city, v.country, v.device, v.user_id
    from public.page_views v
    where v.created_at >= p_start and v.created_at < p_end
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
      bool_or(pv.path like '/tenure-monitor%') as tenure_page
    from pv group by pv.session_id
  ),
  -- Events the editor fires by itself on load (demo map, deep link) are not
  -- something a person did; the same list admin_session_ids uses.
  evs as (
    select e.session_id,
      bool_or(e.event not in ('editor_opened', 'first_map_checklist_shown', 'first_layer_added',
          'mobile_editor_banner_shown', 'internal_session')
        and not (e.event = 'layer_added' and coalesce(e.props->>'source', '') in ('demo', 'deeplink'))) as acted,
      bool_or(e.event = 'editor_opened') as opened_editor,
      bool_or(e.event = 'registry_claims_imported'
        or (e.event = 'layer_added' and coalesce(e.props->>'source', '') not in ('demo', 'deeplink'))) as added_data,
      bool_or(e.event in ('export_completed', 'share_created')) as made_map,
      bool_or(e.event = 'share_viewed') as viewed_share,
      bool_or(e.event like 'tenure\_%') as tenure_event,
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
      coalesce(ev.viewed_share, false) or s.landing like '/map/%' as viewed_share,
      coalesce(ev.tenure_event, false) or s.tenure_page as tenure,
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
        when s2.datacentre then 'bot'
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
        when s2.landing like '/map/%' then 'Shared map links'
        when s2.referrer is not null and s2.referrer !~* 'explorationmaps\.com' then 'Other websites'
        when s2.utm_source is not null and s2.utm_source !~* '^(blog|companies)/?$' then 'Campaigns'
        else 'Direct'
      end as channel
    from s2
  ),
  cur as (select * from cls where cls.cur),
  people as (select * from cur where cur.kind in ('engaged', 'bounced')),
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
      count(distinct er.session_id) filter (where er.session_id not in (select session_id from cls where kind = 'you')) as people,
      max(er.occurred_at) as last_seen
    from public.error_events er
    where er.occurred_at >= p_start and er.occurred_at < p_end
    group by 1
  ),
  failed as (
    select lower(trim(x.query_text)) as q, upper(coalesce(x.province, '')) as province, x.kind,
      count(*) as times, max(x.created_at) as last_seen,
      bool_or(x.outcome = 'error') as errored
    from public.search_events x
    where x.created_at >= p_start and x.created_at < p_end
      and (x.outcome in ('empty', 'error') or coalesce(x.result_count, 0) = 0)
      and coalesce(x.session_id, '') not in (select session_id from cls where kind = 'you')
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
        jsonb_build_object('label', 'Tenure Monitor', 'n', (select count(*) from people where tenure))
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
                  when e.event = 'share_viewed' then 'Viewed shared map'
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
