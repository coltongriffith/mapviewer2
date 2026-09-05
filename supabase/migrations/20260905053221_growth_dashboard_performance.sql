-- Growth reporting: bounded event scans, explicit cohorts, current billing state.
-- Reports exclude identifiable administrators; anonymous/test/bot traffic cannot
-- be perfectly classified. Client metadata is attribution context, never auth.
create index if not exists product_events_created_idx on public.product_events (created_at);

create or replace function public.admin_get_access()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return true;
end;
$$;
revoke all on function public.admin_get_access() from public, anon, authenticated;
grant execute on function public.admin_get_access() to authenticated;

create or replace function public.em_source_label(p_source text, p_medium text, p_referrer text)
returns text language sql immutable set search_path = '' as $$
  select case
    when nullif(trim(p_source), '') is not null then left(lower(trim(p_source)), 80)
      || case when nullif(trim(p_medium), '') is not null then ' / ' || left(lower(trim(p_medium)), 40) else '' end
    when nullif(trim(p_referrer), '') is not null then 'Referral: ' || left(regexp_replace(regexp_replace(p_referrer, '^https?://(www\.)?', ''), '[/\?#].*$', ''), 80)
    else 'Unattributed' end;
$$;

create or replace function public.admin_get_growth(p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
  -- Before this release, successful exports did not record real_data.
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
    select s.session_id, coalesce(f.source, 'Unattributed') source, o.opened_at, i.imported_at,
      exists (select 1 from exports e where e.session_id = s.session_id and e.created_at >= i.imported_at) as exported,
      exists (select 1 from exports e where e.session_id = s.session_id and e.created_at >= i.imported_at and e.real_data) as real_exported
    from session_ids s left join first_page f using (session_id)
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
    'funnel', (select jsonb_build_object('sessions', count(*), 'opened', count(opened_at),
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
      select source, count(*) sessions, count(opened_at) opened, count(imported_at) imported,
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
      'generated_at', now(), 'real_tracking_since', real_tracking_since)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_growth(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_get_growth(timestamptz, timestamptz) to authenticated;

-- A single, consistently scoped day report. Aggregating the event stream first
-- avoids multiplying page views by a join to heartbeat rows.
create or replace function public.admin_get_day_activity(p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_start is null or p_end is null or p_end <= p_start or p_end - p_start > interval '25 hours' then
    raise exception 'Choose a single calendar day' using errcode = '22023';
  end if;
  with admins as materialized (select user_id from public.admin_users),
  excluded as materialized (select session_id from public.admin_session_ids(p_start, p_end) where session_id is not null),
  events as materialized (
    select session_id, user_id, created_at, 'page_view' kind, null::text email, device, referrer, city, country, utm_source from public.page_views
      where created_at >= p_start and created_at < p_end
    union all select session_id, user_id, created_at, 'search', null, null, null, null, null, null from public.search_events
      where created_at >= p_start and created_at < p_end
    union all select session_id, user_id, created_at, 'export', null, null, null, null, null, null from public.export_events
      where created_at >= p_start and created_at < p_end
    union all select session_id, null::uuid, captured_at, 'lead', email, null, null, null, null, null from public.leads
      where captured_at >= p_start and captured_at < p_end
    union all select session_id, user_id, created_at, 'product', null, null, null, null, null, null from public.product_events
      where created_at >= p_start and created_at < p_end
  ),
  clean as materialized (
    select e.* from events e
    where not exists (select 1 from admins a where a.user_id = e.user_id)
      and not exists (select 1 from excluded x where x.session_id = e.session_id)
      and not exists (select 1 from events x join admins a on a.user_id = x.user_id where x.session_id = e.session_id)
  ),
  sessions as materialized (
    select session_id, min(created_at) first_seen, max(created_at) last_seen,
      count(*) filter (where kind = 'page_view') page_view_count,
      count(*) filter (where kind = 'search') search_count,
      count(*) filter (where kind = 'export') export_count,
      max(email) lead_email, max(device) device, max(referrer) referrer, max(city) city, max(country) country, max(utm_source) utm_source
    from clean where session_id is not null group by session_id
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object('page_views', count(*) filter (where kind = 'page_view'),
      'sessions', (select count(*) from sessions), 'searches', count(*) filter (where kind = 'search'),
      'exports', count(*) filter (where kind = 'export'), 'leads', count(*) filter (where kind = 'lead'),
      'signups', (select count(*) from auth.users u where email_confirmed_at >= p_start and email_confirmed_at < p_end
        and not exists (select 1 from admins a where a.user_id = u.id))) from clean),
    'sessions', (select coalesce(jsonb_agg(s order by s.first_seen desc), '[]'::jsonb)
      from (select * from sessions order by first_seen desc limit 250) s)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_day_activity(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_get_day_activity(timestamptz, timestamptz) to authenticated;

-- Estimated catalog MRR is distinct from collected revenue. Trials, comps,
-- admins and unknown intervals are never assigned invented monthly revenue.
create or replace function public.admin_get_billing_metrics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with plans as materialized (
    select up.*, u.email from public.user_plans up join auth.users u on u.id = up.user_id
    where not exists (select 1 from public.admin_users a where a.user_id = up.user_id)
  )
  select jsonb_build_object(
    'plan_counts', (select jsonb_build_object('free', count(*) filter (where plan = 'free'),
      'pro_stripe', count(*) filter (where plan = 'pro' and source = 'stripe'),
      'pro_grandfathered', count(*) filter (where plan = 'pro' and source = 'grandfathered'),
      'pro_admin', count(*) filter (where plan = 'pro' and source = 'admin')) from plans),
    'mrr_cents', (select coalesce(sum(case billing_interval when 'month' then 2900 when 'year' then 29000 / 12.0 end), 0)
      from plans where plan = 'pro' and source = 'stripe' and status = 'active'),
    'paying_subscribers', (select count(*) from plans where plan = 'pro' and source = 'stripe' and status = 'active'),
    'trial_subscribers', (select count(*) from plans where plan = 'pro' and source = 'stripe' and status = 'trialing'),
    'past_due_subscribers', (select count(*) from plans where source = 'stripe' and status = 'past_due'),
    'unknown_interval_subscribers', (select count(*) from plans where plan = 'pro' and source = 'stripe' and status = 'active' and billing_interval is null),
    'new_subscribers_30d', (select count(*) from plans where plan = 'pro' and source = 'stripe' and status = 'active' and pro_since >= now() - interval '30 days'),
    'canceled_30d', (select count(*) from plans where source = 'stripe' and status = 'canceled' and updated_at >= now() - interval '30 days'),
    'subscribers', (select coalesce(jsonb_agg(s order by s.pro_since desc nulls last), '[]'::jsonb)
      from (select user_id, email, status, source, billing_interval, stripe_customer_id, current_period_end, pro_since
        from plans where plan = 'pro' order by pro_since desc nulls last limit 200) s),
    'invoices', (select coalesce(jsonb_agg(i order by i.created_at desc), '[]'::jsonb) from (
      select ci.*, u.email from public.custom_invoices ci left join auth.users u on u.id = ci.user_id
      where not exists (select 1 from public.admin_users a where a.user_id = ci.user_id)
      order by ci.created_at desc limit 100) i),
    'refunds_by_currency', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
      select upper(currency) currency, sum(amount_refunded) cents from public.custom_invoices ci
      where amount_refunded > 0 and not exists (select 1 from public.admin_users a where a.user_id = ci.user_id)
      group by upper(currency) order by upper(currency)) r),
    'upsell_candidates', (select coalesce(jsonb_agg(e order by e.last_export desc), '[]'::jsonb) from (
      select up.user_id, up.email, count(*) exports, max(pe.created_at) last_export
      from plans up join public.product_events pe on pe.user_id = up.user_id
      where up.plan = 'free' and pe.event = 'export_completed' and pe.props->'real_data' = 'true'::jsonb
        and pe.created_at >= now() - interval '30 days'
      group by up.user_id, up.email order by last_export desc limit 25) e),
    'meta', jsonb_build_object('generated_at', now(), 'currency', 'USD', 'mrr_basis', 'catalog_estimate')
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_billing_metrics() from public, anon, authenticated;
grant execute on function public.admin_get_billing_metrics() to authenticated;
