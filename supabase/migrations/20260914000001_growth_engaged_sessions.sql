-- Keep raw tab sessions visible while separating sessions with an observed
-- action pattern. A session is "engaged" when it records more than one page
-- view or any product event. This is not a human/bot classifier; it prevents
-- landing-only traffic from obscuring the first-map funnel.
create or replace function public.admin_get_growth(p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
  real_tracking_since constant timestamptz := '2026-09-05T00:00:00Z';
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_start is null or p_end is null or p_end <= p_start or p_end - p_start > interval '92 days' then
    raise exception 'Choose a window of 1 to 90 days' using errcode = '22023';
  end if;
  with
  admins as materialized (select user_id from public.admin_users),
  admin_sessions as materialized (
    select session_id from public.admin_session_ids(p_start, p_end) where session_id is not null
    union select e.session_id from public.export_events e join admins a on a.user_id = e.user_id
      where e.created_at >= p_start and e.created_at < p_end and e.session_id is not null
    union select e.session_id from public.search_events e join admins a on a.user_id = e.user_id
      where e.created_at >= p_start and e.created_at < p_end and e.session_id is not null
  ),
  pe as materialized (
    select e.session_id, e.user_id, e.event, e.props, e.created_at
    from public.product_events e
    where e.created_at >= p_start and e.created_at < p_end
      and not exists (select 1 from admins a where a.user_id = e.user_id)
      and not exists (select 1 from admin_sessions a where a.session_id = e.session_id)
  ),
  pv as materialized (
    select e.session_id, e.created_at, e.utm_source, e.utm_medium, e.referrer
    from public.page_views e
    where e.created_at >= p_start and e.created_at < p_end
      and not exists (select 1 from admins a where a.user_id = e.user_id)
      and not exists (select 1 from admin_sessions a where a.session_id = e.session_id)
  ),
  exports as materialized (
    select session_id, created_at, props->'real_data' = 'true'::jsonb as real_data
      from pe where event = 'export_completed'
    union all
    select e.session_id, e.created_at, null::boolean
      from public.export_events e
      where e.created_at >= p_start and e.created_at < p_end
        and not exists (select 1 from admins a where a.user_id = e.user_id)
        and not exists (select 1 from admin_sessions a where a.session_id = e.session_id)
        and not exists (select 1 from pe where pe.event = 'export_completed' and pe.session_id = e.session_id
          and pe.created_at between e.created_at - interval '5 seconds' and e.created_at + interval '5 seconds')
  ),
  session_ids as (
    select session_id from pv where session_id is not null
    union select session_id from pe where session_id is not null
  ),
  first_page as (
    select distinct on (session_id) session_id, public.em_source_label(utm_source, utm_medium, referrer) as source
    from pv where session_id is not null order by session_id, created_at
  ),
  page_counts as (
    select session_id, count(*) page_views from pv where session_id is not null group by session_id
  ),
  opened as (
    select session_id, min(created_at) as opened_at from pe where event = 'editor_opened' group by session_id
  ),
  imported as (
    select e.session_id, min(e.created_at) as imported_at from pe e join opened o using (session_id)
    where e.created_at >= o.opened_at and (e.event = 'registry_claims_imported'
      or (e.event = 'layer_added' and e.props->>'source' in ('upload','csv','registry','deeplink','tenure_monitor')))
    group by e.session_id
  ),
  sessions as materialized (
    select s.session_id, coalesce(f.source, 'Unattributed') source,
      coalesce(pc.page_views, 0) > 1 or exists (select 1 from pe e where e.session_id = s.session_id) as engaged,
      o.opened_at, i.imported_at,
      exists (select 1 from exports e where e.session_id = s.session_id and e.created_at >= i.imported_at) as exported,
      exists (select 1 from exports e where e.session_id = s.session_id and e.created_at >= i.imported_at and e.real_data) as real_exported
    from session_ids s left join first_page f using (session_id)
    left join page_counts pc using (session_id)
    left join opened o using (session_id) left join imported i using (session_id)
  ),
  accounts as materialized (
    select u.id, u.email, u.email_confirmed_at joined_at,
      public.em_source_label(u.raw_user_meta_data->'em_acquisition'->>'utm_source',
        u.raw_user_meta_data->'em_acquisition'->>'utm_medium', u.raw_user_meta_data->'em_acquisition'->>'referrer') source,
      coalesce(up.plan = 'pro' and up.source = 'stripe' and up.status = 'active', false) as subscribed
    from auth.users u left join public.user_plans up on up.user_id = u.id
    where u.email_confirmed_at >= p_start and u.email_confirmed_at < p_end
      and not exists (select 1 from admins a where a.user_id = u.id)
  ),
  cohort as materialized (
    select a.*,
      a.joined_at >= real_tracking_since and a.joined_at + interval '7 days' <= p_end as activation_eligible,
      a.joined_at >= '2026-07-13T00:00:00Z'::timestamptz and a.joined_at + interval '14 days' <= p_end as return_eligible,
      exists (select 1 from public.product_events e where e.user_id = a.id and e.event = 'export_completed'
        and e.props->'real_data' = 'true'::jsonb
        and e.created_at >= a.joined_at and e.created_at < least(a.joined_at + interval '7 days', p_end)) as activated,
      exists (select 1 from public.product_events e where e.user_id = a.id
        and e.created_at >= a.joined_at + interval '7 days' and e.created_at < least(a.joined_at + interval '14 days', p_end)
        and (public.em_is_active_event(e.event) and e.event <> 'signup_completed'
          or e.event in ('tenure_search_completed','tenure_added','tenure_opened_in_editor'))) as returned
    from accounts a
  ),
  plans as materialized (
    select up.* from public.user_plans up where not exists (select 1 from admins a where a.user_id = up.user_id)
  )
  select jsonb_build_object(
    'funnel', (select jsonb_build_object('sessions', count(*),
      'engaged', count(*) filter (where engaged), 'opened', count(opened_at),
      'imported', count(imported_at), 'exported', count(*) filter (where exported),
      'real_exported', count(*) filter (where real_exported)) from sessions),
    'exports', (select jsonb_build_object('total', count(*), 'real', count(*) filter (where real_data),
      'unclassified', count(*) filter (where real_data is null), 'other', count(*) filter (where real_data = false)) from exports),
    'billing', (select jsonb_build_object(
      'active_subscribers', count(*) filter (where plan = 'pro' and source = 'stripe' and status = 'active'),
      'trials', count(*) filter (where plan = 'pro' and source = 'stripe' and status = 'trialing'),
      'past_due', count(*) filter (where source = 'stripe' and status = 'past_due'),
      'estimated_mrr_cents', coalesce(sum(case billing_interval when 'month' then 2900 when 'year' then 29000 / 12.0 end)
        filter (where plan = 'pro' and source = 'stripe' and status = 'active'), 0),
      'unknown_interval', count(*) filter (where plan = 'pro' and source = 'stripe' and status = 'active' and billing_interval is null),
      'stale_periods', count(*) filter (where plan = 'pro' and source = 'stripe' and status = 'active' and current_period_end < now())
    ) from plans),
    'cohort', (select jsonb_build_object('signups', count(*), 'current_subscribers', count(*) filter (where subscribed),
      'activation_eligible', count(*) filter (where activation_eligible),
      'activated', count(*) filter (where activation_eligible and activated),
      'activation_pending', count(*) filter (where joined_at >= real_tracking_since and not activation_eligible),
      'activation_untracked', count(*) filter (where joined_at < real_tracking_since),
      'return_eligible', count(*) filter (where return_eligible), 'returned', count(*) filter (where return_eligible and returned),
      'return_pending', count(*) filter (where not return_eligible)) from cohort),
    'sources', (select coalesce(jsonb_agg(t order by t.sessions desc, t.source), '[]'::jsonb) from (
      select source, count(*) sessions, count(*) filter (where engaged) engaged,
        count(opened_at) opened, count(imported_at) imported,
        count(*) filter (where exported) exported, count(*) filter (where real_exported) real_exported
      from sessions group by source order by sessions desc, source limit 30) t),
    'signup_sources', (select coalesce(jsonb_agg(t order by t.signups desc, t.source), '[]'::jsonb) from (
      select source, count(*) signups, count(*) filter (where subscribed) current_subscribers
      from cohort group by source order by signups desc, source limit 30) t),
    'friction', (select jsonb_build_object(
      'export_failures', count(*) filter (where event = 'export_failed'),
      'pro_gate_sessions', count(distinct session_id) filter (where event = 'pro_gate_shown'),
      'checkout_sessions', count(distinct session_id) filter (where event = 'upgrade_checkout_started')) from pe),
    'follow_up', (select coalesce(jsonb_agg(t order by t.last_export desc), '[]'::jsonb) from (
      select u.id user_id, u.email, count(*) exports, max(e.created_at) last_export
      from pe e join auth.users u on u.id = e.user_id
      join public.user_plans up on up.user_id = u.id and up.plan = 'free'
      where e.event = 'export_completed' and e.props->'real_data' = 'true'::jsonb
      group by u.id, u.email order by last_export desc limit 10) t),
    'meta', jsonb_build_object('start', p_start, 'end', p_end, 'tz', 'America/Vancouver',
      'generated_at', now(), 'real_tracking_since', real_tracking_since,
      'engagement_definition', 'two_page_views_or_product_event')
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_growth(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_get_growth(timestamptz, timestamptz) to authenticated;
