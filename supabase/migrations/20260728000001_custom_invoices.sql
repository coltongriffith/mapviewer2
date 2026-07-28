-- ============================================================
-- Custom invoices (Stripe Invoicing) — one-off invoices for bespoke work
-- (custom map packages, enterprise/annual deals) created manually in the
-- Stripe Dashboard, separate from the self-serve Pro subscription.
--
-- This table is a read-mostly reconciliation mirror, kept in sync by
-- api/stripe-webhook.js. It NEVER touches public.user_plans — standalone
-- invoices (no `subscription` on the Stripe Invoice) carry no subscription
-- entitlement by themselves.
--
-- Rollback:
--   drop table if exists public.custom_invoices;
-- ============================================================

create table if not exists public.custom_invoices (
  stripe_invoice_id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null,
  status text not null default 'open'
    check (status in ('open', 'paid', 'payment_failed', 'void', 'uncollectible', 'refunded', 'credited')),
  amount_due integer not null default 0,
  amount_paid integer not null default 0,
  currency text not null default 'usd',
  description text,
  number text,
  hosted_invoice_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custom_invoices enable row level security;
revoke all on table public.custom_invoices from anon, authenticated;

-- Users may read their OWN custom invoices (same shape as user_plans); all
-- writes go through the service role (the Stripe webhook).
drop policy if exists custom_invoices_select_own on public.custom_invoices;
create policy custom_invoices_select_own on public.custom_invoices
  for select to authenticated using (auth.uid() = user_id);
grant select on table public.custom_invoices to authenticated;

create index if not exists custom_invoices_user_idx on public.custom_invoices (user_id);
create index if not exists custom_invoices_customer_idx on public.custom_invoices (stripe_customer_id);

-- Post-migration verification (run manually):
--   select stripe_invoice_id, status, amount_paid, currency from public.custom_invoices;

-- ============================================================
-- Extend admin_get_user_detail (20260713000001_admin_dashboard_v2.sql) with
-- a custom_invoices list for the drawer. Same body as before plus one key —
-- create or replace in place, no drop needed (identical signature).
-- ============================================================
create or replace function public.admin_get_user_detail(p_user_id uuid)
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
        'qp_credentials', s.settings->>'qpCredentials', 'projection', s.settings->>'projectionName'
      )
      from auth.users u left join public.account_settings s on s.user_id = u.id
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
        'amount_paid', amount_paid, 'currency', currency, 'number', number,
        'hosted_invoice_url', hosted_invoice_url, 'updated_at', updated_at
      ) order by updated_at desc), '[]'::jsonb)
      from public.custom_invoices where user_id = p_user_id
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_user_detail(uuid) from public;
grant execute on function public.admin_get_user_detail(uuid) to authenticated, service_role;
