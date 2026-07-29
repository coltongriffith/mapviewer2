-- ============================================================
-- Real billing analytics for the admin dashboard.
--
-- Since Stripe went live, the admin "Monetization" tab still showed
-- pre-launch fiction: "paid intent" meant "exported without a watermark",
-- because there was no real subscriber to look at yet. There is now.
-- This migration adds what real billing analytics need and were missing:
--
--   1. user_plans.billing_interval + pro_since — the webhook already knew
--      a user was 'pro', but not whether they paid monthly or yearly, or
--      when they actually became a paying customer (created_at is signup
--      time, not upgrade time). Without these, MRR cannot be computed.
--   2. admin_get_revenue() — subscriber counts by plan/status/source, MRR,
--      recent subscribers, recent custom invoices, refunds, and the
--      (correctly scoped) upsell list: free-plan users who export clean,
--      i.e. NOT already-paying subscribers.
--   3. admin_get_user_detail() and admin_get_users_overview() now surface
--      plan/status/source. admin_get_user_detail() also gained
--      `custom_invoices` — UsersTab's UserDrawer (src/components/admin/
--      UsersTab.jsx) already reads d.custom_invoices; the RPC just never
--      sent it.
--
-- Additive & idempotent.
--
-- Rollback:
--   alter table public.user_plans drop column if exists billing_interval;
--   alter table public.user_plans drop column if exists pro_since;
--   drop function if exists public.admin_get_revenue();
--   -- admin_get_user_detail / admin_get_users_overview: re-run the prior
--   -- versions from 20260713000001_admin_dashboard_v2.sql.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. COLUMNS
-- ────────────────────────────────────────────────────────────
alter table public.user_plans
  add column if not exists billing_interval text check (billing_interval in ('month', 'year')),
  add column if not exists pro_since timestamptz;

-- Backfill pro_since for rows already on Pro (grandfathered accounts and any
-- real subscriber that predates this column) so MRR/cohort queries have a
-- value to sort/filter on instead of null forever.
update public.user_plans
  set pro_since = updated_at
  where plan = 'pro' and pro_since is null;

-- ────────────────────────────────────────────────────────────
-- 2. admin_get_revenue — real Stripe-backed billing analytics.
-- ────────────────────────────────────────────────────────────
create or replace function public.admin_get_revenue()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  result jsonb;
  -- Mirrors src/utils/pricing.js — the only two live prices. Cross-check
  -- against Stripe with `npm run stripe:check` if these ever change.
  monthly_cents constant integer := 2900;
  yearly_cents constant integer := 29000;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  select jsonb_build_object(
    'plan_counts', (
      select jsonb_build_object(
        'free', count(*) filter (where plan = 'free'),
        'pro_stripe', count(*) filter (where plan = 'pro' and source = 'stripe'),
        'pro_grandfathered', count(*) filter (where plan = 'pro' and source = 'grandfathered'),
        'pro_admin', count(*) filter (where plan = 'pro' and source = 'admin')
      )
      from public.user_plans
    ),
    'status_counts', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (
        select status, count(*) n from public.user_plans
        where plan = 'pro' and source = 'stripe'
        group by status
      ) s
    ),
    -- MRR/ARR: only real, currently-billing subscribers — never
    -- grandfathered/admin comps, which are free-forever by design.
    'mrr_cents', (
      select coalesce(sum(case billing_interval when 'year' then yearly_cents / 12.0 else monthly_cents end), 0)::bigint
      from public.user_plans
      where plan = 'pro' and source = 'stripe' and status in ('active', 'trialing')
    ),
    'paying_subscribers', (
      select count(*) from public.user_plans
      where plan = 'pro' and source = 'stripe' and status in ('active', 'trialing')
    ),
    'unknown_interval_subscribers', (
      -- Real paying subscribers whose interval wasn't captured (e.g. predate
      -- this migration, or subscription.updated hasn't fired yet) — excluded
      -- from MRR above, so the total is an undercount until this is zero.
      select count(*) from public.user_plans
      where plan = 'pro' and source = 'stripe' and status in ('active', 'trialing')
        and billing_interval is null
    ),
    'new_subscribers_30d', (
      select count(*) from public.user_plans
      where plan = 'pro' and source = 'stripe' and pro_since >= now() - interval '30 days'
    ),
    'canceled_30d', (
      select count(*) from public.user_plans
      where source = 'stripe' and status = 'canceled' and updated_at >= now() - interval '30 days'
    ),
    'subscribers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', up.user_id, 'email', u.email, 'status', up.status, 'source', up.source,
        'billing_interval', up.billing_interval, 'stripe_customer_id', up.stripe_customer_id,
        'current_period_end', up.current_period_end, 'pro_since', up.pro_since
      ) order by up.pro_since desc nulls last), '[]'::jsonb)
      from public.user_plans up
      join auth.users u on u.id = up.user_id
      where up.plan = 'pro'
      limit 200
    ),
    'invoices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'stripe_invoice_id', ci.stripe_invoice_id, 'email', u.email, 'status', ci.status,
        'amount_due', ci.amount_due, 'amount_paid', ci.amount_paid, 'amount_refunded', ci.amount_refunded,
        'currency', ci.currency, 'number', ci.number, 'hosted_invoice_url', ci.hosted_invoice_url,
        'created_at', ci.created_at
      ) order by ci.created_at desc), '[]'::jsonb)
      from (select * from public.custom_invoices order by created_at desc limit 100) ci
      left join auth.users u on u.id = ci.user_id
    ),
    'refunded_cents_total', (select coalesce(sum(amount_refunded), 0) from public.custom_invoices),
    -- The old "paid intent" list, correctly scoped: free-plan users who
    -- already export clean are the best upsell candidates — a Pro
    -- subscriber exporting clean is expected behaviour, not a lead.
    'upsell_candidates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', ee.user_id, 'email', u.email, 'clean_exports', n, 'last_export', last_export
      ) order by n desc), '[]'::jsonb)
      from (
        select user_id, count(*) n, max(created_at) last_export
        from public.export_events
        where user_id is not null and "noWatermark"
        group by user_id
      ) ee
      join auth.users u on u.id = ee.user_id
      join public.user_plans up on up.user_id = ee.user_id and up.plan = 'free'
      limit 25
    )
  ) into result;

  return result;
end;
$$;
revoke all on function public.admin_get_revenue() from public;
grant execute on function public.admin_get_revenue() to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3. admin_get_user_detail — add plan/billing identity + custom_invoices
--    (UsersTab.jsx's UserDrawer already reads d.custom_invoices; this RPC
--    never sent it).
-- ────────────────────────────────────────────────────────────
drop function if exists public.admin_get_user_detail(uuid);
create function public.admin_get_user_detail(p_user_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  result jsonb;
  u_created timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select created_at into u_created from auth.users where id = p_user_id;

  select jsonb_build_object(
    'identity', (
      select jsonb_build_object(
        'user_id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
        'company', s.settings->>'companyName', 'qp_name', s.settings->>'qpName',
        'qp_credentials', s.settings->>'qpCredentials', 'projection', s.settings->>'projectionName',
        'plan', p.plan, 'plan_status', p.status, 'plan_source', p.source,
        'billing_interval', p.billing_interval, 'stripe_customer_id', p.stripe_customer_id,
        'pro_since', p.pro_since, 'current_period_end', p.current_period_end
      )
      from auth.users u
      left join public.account_settings s on s.user_id = u.id
      left join public.user_plans p on p.user_id = u.id
      where u.id = p_user_id
    ),
    'checklist', jsonb_build_object(
      'opened', exists (select 1 from public.product_events pe where pe.user_id = p_user_id and pe.event='editor_opened' and pe.created_at < u_created + interval '7 days'),
      'added_data', exists (select 1 from public.product_events pe where pe.user_id = p_user_id and pe.event='first_layer_added' and pe.created_at < u_created + interval '7 days'),
      'map_work', exists (select 1 from public.product_events pe where pe.user_id = p_user_id and (pe.event in ('element_added','registry_claims_imported') or (pe.event='layer_added' and coalesce(pe.props->>'source','') in ('upload','csv'))) and pe.created_at < u_created + interval '7 days'),
      'artifact', exists (select 1 from public.product_events pe where pe.user_id = p_user_id and pe.event in ('export_completed','share_created') and pe.created_at < u_created + interval '7 days')
    ),
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'created_at', created_at, 'updated_at', updated_at, 'has_thumb', thumbnail is not null) order by updated_at desc), '[]'::jsonb)
      from (select id, name, created_at, updated_at, thumbnail from public.projects where user_id = p_user_id order by updated_at desc limit 20) p
    ),
    'recent_events', (
      select coalesce(jsonb_agg(jsonb_build_object('t', created_at, 'event', event, 'session_id', session_id, 'props', props) order by created_at desc), '[]'::jsonb)
      from (select created_at, event, session_id, props from public.product_events where user_id = p_user_id order by created_at desc limit 20) e
    ),
    'exports_by_format', (
      select coalesce(jsonb_agg(jsonb_build_object('format', format, 'n', c, 'clean', clean) order by c desc), '[]'::jsonb)
      from (select format, count(*) c, count(*) filter (where "noWatermark") clean from public.export_events where user_id = p_user_id group by format) x
    ),
    'custom_invoices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'stripe_invoice_id', stripe_invoice_id, 'status', status, 'amount_due', amount_due,
        'amount_paid', amount_paid, 'amount_refunded', amount_refunded, 'currency', currency,
        'number', number, 'hosted_invoice_url', hosted_invoice_url, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from public.custom_invoices where user_id = p_user_id
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_user_detail(uuid) from public;
grant execute on function public.admin_get_user_detail(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 4. admin_get_users_overview — add plan/status/source per user row so the
--    Users table can show a Plan badge without a second round trip.
-- ────────────────────────────────────────────────────────────
drop function if exists public.admin_get_users_overview(text);
create function public.admin_get_users_overview(p_tz text default 'America/Vancouver')
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  result jsonb;
  today_d date := (now() at time zone p_tz)::date;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  with
  admins as (select user_id from public.admin_users),
  ub as (select u.id, u.email, u.created_at, u.last_sign_in_at from auth.users u where u.id not in (select user_id from admins)),
  enriched as (
    select ub.*,
      (select max(pe.created_at) from public.product_events pe where pe.user_id = ub.id and public.em_is_active_event(pe.event)) last_event,
      (select count(distinct (pe.created_at at time zone p_tz)::date) from public.product_events pe
        where pe.user_id = ub.id and public.em_is_value_event(pe.event) and pe.created_at >= now() - interval '30 days') value_days_30,
      (select count(*) from public.product_events pe where pe.user_id = ub.id and public.em_is_value_event(pe.event) and pe.created_at >= now() - interval '14 days') value_14,
      (
        exists (select 1 from public.product_events pe where pe.user_id = ub.id and public.em_is_activation_event(pe.event, pe.props)
                and pe.created_at < ub.created_at + interval '7 days')
        or exists (select 1 from public.export_events ee where ee.user_id = ub.id and ee.created_at < ub.created_at + interval '7 days')
        or (ub.created_at < date '2026-07-13' and exists (select 1 from public.projects p where p.user_id = ub.id and p.created_at < ub.created_at + interval '7 days'))
      ) activated
    from ub
  ),
  classified as (
    select e.*,
      case
        when not activated and e.created_at >= now() - interval '7 days' then 'new'
        when not activated then 'never_activated'
        when value_days_30 >= 3 then 'power'
        when value_14 >= 1 then 'active'
        when last_event is null or last_event < now() - interval '14 days' then 'dormant'
        else 'active'
      end status
    from enriched e
  )
  select jsonb_build_object(
    'ladder', (
      select jsonb_build_array(
        jsonb_build_object('bucket','Active this week', 'count', count(*) filter (where last_event >= now() - interval '7 days')),
        jsonb_build_object('bucket','Active this month', 'count', count(*) filter (where last_event >= now() - interval '30 days' and last_event < now() - interval '7 days')),
        jsonb_build_object('bucket','Dormant 30–90d', 'count', count(*) filter (where last_event >= now() - interval '90 days' and last_event < now() - interval '30 days')),
        jsonb_build_object('bucket','Gone 90d+', 'count', count(*) filter (where activated and (last_event is null or last_event < now() - interval '90 days'))),
        jsonb_build_object('bucket','Never activated', 'count', count(*) filter (where not activated))
      ) from classified
    ),
    'returning_week', jsonb_build_object(
      'n', (select count(*) from classified where last_event >= now() - interval '7 days'
            and exists (select 1 from public.product_events pe where pe.user_id = classified.id and public.em_is_active_event(pe.event)
                        and (pe.created_at at time zone p_tz)::date < today_d - 7)),
      'of', (select count(*) from classified where last_event >= now() - interval '7 days')
    ),
    'median_days_to_value', (
      select round(percentile_cont(0.5) within group (order by dtv)::numeric, 1)
      from (
        select extract(epoch from (
          (select min(pe.created_at) from public.product_events pe where pe.user_id = e.id and public.em_is_value_event(pe.event)) - e.created_at
        )) / 86400 dtv
        from enriched e where activated
      ) d where dtv is not null
    ),
    'activated_count', (select count(*) from classified where activated),
    'cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week', wk, 'signups', signups, 'activated', activated_n,
        'd7', jsonb_build_object('n', d7_n, 'matured', d7_mat),
        'd30', jsonb_build_object('n', d30_n, 'matured', d30_mat)
      ) order by wk desc), '[]'::jsonb)
      from (
        select date_trunc('week', (c.created_at at time zone p_tz))::date wk,
          count(*) signups,
          count(*) filter (where activated) activated_n,
          count(*) filter (where activated and now() - c.created_at >= interval '7 days'
            and exists (select 1 from public.product_events pe where pe.user_id = c.id and public.em_is_active_event(pe.event)
                        and (pe.created_at at time zone p_tz)::date > (c.created_at at time zone p_tz)::date
                        and pe.created_at < c.created_at + interval '7 days')) d7_n,
          count(*) filter (where now() - c.created_at >= interval '7 days') d7_mat,
          count(*) filter (where activated and now() - c.created_at >= interval '30 days'
            and exists (select 1 from public.product_events pe where pe.user_id = c.id and public.em_is_active_event(pe.event)
                        and (pe.created_at at time zone p_tz)::date > (c.created_at at time zone p_tz)::date
                        and pe.created_at < c.created_at + interval '30 days')) d30_n,
          count(*) filter (where now() - c.created_at >= interval '30 days') d30_mat
        from classified c
        where c.created_at >= (now() at time zone p_tz)::date - 56
        group by 1
      ) co
    ),
    'users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', id, 'email', email,
        'company', (select settings->>'companyName' from public.account_settings where user_id = classified.id),
        'created_at', created_at, 'last_sign_in_at', last_sign_in_at, 'last_event_at', last_event,
        'status', status, 'activated', activated,
        'active_days_30', value_days_30,
        'projects', (select count(*) from public.projects p where p.user_id = classified.id),
        'exports_total', (select count(*) from public.export_events ee where ee.user_id = classified.id),
        'premium_exports', (select count(*) from public.export_events ee where ee.user_id = classified.id and ee."noWatermark"),
        'plan', (select plan from public.user_plans where user_id = classified.id),
        'plan_status', (select status from public.user_plans where user_id = classified.id),
        'plan_source', (select source from public.user_plans where user_id = classified.id),
        'dots', (
          select jsonb_agg(coalesce(lvl, 0) order by gd)
          from generate_series(today_d - 13, today_d, interval '1 day') g(gd)
          left join (
            select (pe.created_at at time zone p_tz)::date d,
              max(case when public.em_is_value_event(pe.event) then 2 when public.em_is_active_event(pe.event) then 1 else 0 end) lvl
            from public.product_events pe where pe.user_id = classified.id group by 1
          ) dd on dd.d = gd
        )
      ) order by created_at desc), '[]'::jsonb)
      from (select * from classified order by created_at desc limit 500) classified
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_users_overview(text) from public;
grant execute on function public.admin_get_users_overview(text) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 5. VERIFICATION (run manually)
--   select admin_get_revenue() -> 'plan_counts';
--   select admin_get_revenue() -> 'mrr_cents';  -- 0 until a stripe-sourced
--     row has both status in (active,trialing) AND billing_interval set
--   select jsonb_pretty(admin_get_user_detail((select user_id from
--     public.user_plans where source='stripe' limit 1))->'custom_invoices');
-- ============================================================
