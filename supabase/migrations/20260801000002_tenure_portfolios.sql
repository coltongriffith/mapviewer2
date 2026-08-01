-- ============================================================
-- TENURE MONITOR — part 2 of 3: private customer data.
--
-- The government mirror in part 1 is public. Everything here is not: which
-- titles a company chose to watch, what they intend to do with them, who is
-- responsible, what they wrote in the notes, and who gets emailed are all
-- competitively sensitive. Every table below is owner-scoped by RLS and none
-- of it is readable across accounts.
--
-- OWNERSHIP MODEL
--   Portfolios are user-scoped today, matching every other table in this
--   product (projects, templates, account_settings). `org_id` exists and is
--   nullable, and every policy routes through public.owns_portfolio(), so
--   moving to organization-scoped access later is an edit to ONE function
--   rather than a migration of ownership across five tables.
--
-- ALERT IDEMPOTENCY
--   "Never send a duplicate alert for the same claim, recipient, deadline and
--   threshold" is enforced by a UNIQUE CONSTRAINT, not by application logic.
--   A cron that fires twice, a retried job, and two workers racing all collide
--   on the database and lose. Application-level dedupe would be a promise;
--   this is a guarantee.
--
--   source_good_to_date is part of that key on purpose: when the province
--   moves a good-to-date, the old scheduled alerts become wrong rather than
--   duplicate. They are superseded (see part 3) and a fresh set is inserted
--   against the new date.
--
-- Depends on: 20260801000001_tenure_registry.sql, 20260716000001 (user_plans).
--
-- Rollback:
--   drop table if exists public.tenure_audit_log cascade;
--   drop table if exists public.tenure_alert_instances cascade;
--   drop table if exists public.monitored_portfolio_tenures cascade;
--   drop table if exists public.tenure_alert_recipients cascade;
--   drop table if exists public.monitored_portfolios cascade;
--   drop table if exists public.tenure_alert_policies cascade;
--   drop function if exists public.owns_portfolio(uuid);
-- ============================================================

-- ── Alert policies ─────────────────────────────────────────────────────────
-- expiry_offsets is an int[] rather than three booleans so paid plans can add
-- 180/120/60/14/3/1-day thresholds without a schema change. The MVP writes
-- [90,30] for free and [90,30,7] for Pro; part 3 enforces which offsets a plan
-- may actually use.
create table if not exists public.tenure_alert_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid,                       -- reserved; see ownership model above
  name text not null default 'Default alert policy',
  expiry_offsets integer[] not null default array[90, 30],
  change_events_enabled boolean not null default true,
  escalation_enabled boolean not null default false,
  -- Stored explicitly rather than inferred from the browser. B.C. deadlines
  -- are B.C. deadlines wherever the user happens to be sitting.
  timezone text not null default 'America/Vancouver',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenure_alert_policies_user_idx
  on public.tenure_alert_policies (user_id);

-- ── Portfolios ─────────────────────────────────────────────────────────────
create table if not exists public.monitored_portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid,                       -- reserved
  name text not null default 'My B.C. claims',
  jurisdiction text not null default 'BC',
  alert_policy_id uuid references public.tenure_alert_policies(id) on delete set null,
  -- Per-portfolio kill switch, settable by the owner and by an administrator
  -- during a government-data incident.
  alerts_paused boolean not null default false,
  paused_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists monitored_portfolios_user_idx
  on public.monitored_portfolios (user_id, created_at);

-- ── Ownership helper ───────────────────────────────────────────────────────
-- THE single place that answers "may the current user touch this portfolio?".
-- Every child-table policy calls it, so org-scoping later is one edit here.
-- SECURITY DEFINER so the lookup works regardless of the caller's grants on
-- monitored_portfolios, with a pinned search_path per the hardening in
-- 20260710000005.
create or replace function public.owns_portfolio(p_portfolio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.monitored_portfolios p
    where p.id = p_portfolio_id and p.user_id = auth.uid()
  );
$$;

revoke all on function public.owns_portfolio(uuid) from public;
grant execute on function public.owns_portfolio(uuid) to authenticated, service_role;

-- ── Portfolio membership ───────────────────────────────────────────────────
create table if not exists public.monitored_portfolio_tenures (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.monitored_portfolios(id) on delete cascade,
  tenure_id uuid not null references public.tenures(id) on delete cascade,

  internal_project_name text,
  internal_notes text,
  maintenance_decision text not null default 'UNDECIDED' check (maintenance_decision in (
    'UNDECIDED',
    'REVIEW',
    'INTEND_TO_MAINTAIN',
    'INTEND_TO_ALLOW_LAPSE',
    'MAINTENANCE_COMPLETED',
    'NEEDS_VERIFICATION'
  )),
  decision_due_date date,
  -- A free-text reference the user recorded after doing the work themselves in
  -- MTO (an event number, a receipt note). Explicitly NOT a credential store:
  -- part 3 caps its length and the UI states that passwords do not belong here.
  maintenance_reference text,
  assigned_user_id uuid references auth.users(id) on delete set null,
  monitoring_enabled boolean not null default true,

  added_by_user_id uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  -- Soft removal: history and past alerts stay meaningful after a user stops
  -- watching a title.
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- One live membership per (portfolio, tenure). Partial, so a title can be
-- removed and re-added later without tripping the constraint.
create unique index if not exists monitored_portfolio_tenures_live_unique
  on public.monitored_portfolio_tenures (portfolio_id, tenure_id)
  where removed_at is null;
create index if not exists monitored_portfolio_tenures_portfolio_idx
  on public.monitored_portfolio_tenures (portfolio_id) where removed_at is null;
create index if not exists monitored_portfolio_tenures_tenure_idx
  on public.monitored_portfolio_tenures (tenure_id) where removed_at is null;

-- ── Alert recipients ───────────────────────────────────────────────────────
create table if not exists public.tenure_alert_recipients (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.tenure_alert_policies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  role text not null default 'member',
  receives_expiry_alerts boolean not null default true,
  receives_change_alerts boolean not null default true,
  receives_failure_alerts boolean not null default false,
  escalation_priority integer not null default 0,
  -- Set when a provider reports a hard bounce, so the dispatcher stops
  -- retrying an address that will never accept mail.
  bounced_at timestamptz,
  bounce_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenure_alert_recipients_email_unique unique (policy_id, email)
);

create index if not exists tenure_alert_recipients_policy_idx
  on public.tenure_alert_recipients (policy_id);

-- ── Alert instances ────────────────────────────────────────────────────────
create table if not exists public.tenure_alert_instances (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.monitored_portfolios(id) on delete cascade,
  tenure_id uuid not null references public.tenures(id) on delete cascade,
  recipient_id uuid not null references public.tenure_alert_recipients(id) on delete cascade,

  alert_type text not null check (alert_type in ('EXPIRY', 'CHANGE', 'NOT_OBSERVED')),
  offset_days integer not null default 0,
  scheduled_for date not null,
  -- The good-to-date this alert was calculated FROM. When the province moves
  -- the date, instances carrying the stale value are superseded rather than
  -- sent — this column is what makes that detectable.
  source_good_to_date date,
  -- For CHANGE alerts: which detected event produced this notice.
  change_event_id uuid references public.tenure_change_events(id) on delete cascade,

  status text not null default 'pending' check (status in (
    'pending',     -- scheduled, not yet due or not yet sent
    -- Claimed by a dispatcher and being delivered right now. The dispatcher
    -- flips 'pending' → 'sending' with a compare-and-swap BEFORE it calls the
    -- email provider, so a second worker (or the same job re-fired by a flaky
    -- scheduler) finds nothing left to take. Sending first and marking after
    -- would send twice whenever the marking step lost a race, and a duplicate
    -- deadline email undermines trust in every other one.
    'sending',
    'sent',
    'failed',      -- delivery attempted and rejected; retried up to the cap
    'superseded',  -- the good-to-date moved; this notice is no longer correct
    'suppressed',  -- held because the last import run was not trustworthy
    'cancelled'    -- the tenure left the portfolio, or monitoring was disabled
  )),
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid references auth.users(id) on delete set null,
  delivery_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- THE anti-duplication guarantee. One notice per claim, per recipient, per
-- threshold, per deadline — enforced by the database, so no scheduler bug,
-- double-fired cron or concurrent worker can produce a second copy.
--
-- coalesce() on the two nullable members because Postgres treats NULLs as
-- distinct in a unique index, which would silently reopen the duplicate door
-- for CHANGE alerts (no good-to-date) and EXPIRY alerts (no change event).
create unique index if not exists tenure_alert_instances_unique
  on public.tenure_alert_instances (
    portfolio_id,
    tenure_id,
    recipient_id,
    alert_type,
    offset_days,
    coalesce(source_good_to_date, '1900-01-01'::date),
    coalesce(change_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- The dispatcher's working set: everything due and not yet sent.
create index if not exists tenure_alert_instances_due_idx
  on public.tenure_alert_instances (scheduled_for)
  where status = 'pending';
create index if not exists tenure_alert_instances_portfolio_idx
  on public.tenure_alert_instances (portfolio_id, scheduled_for desc);
create index if not exists tenure_alert_instances_tenure_idx
  on public.tenure_alert_instances (tenure_id, status);

-- ── Audit log ──────────────────────────────────────────────────────────────
-- Who changed a maintenance decision, when, and from what. This is the record
-- a company needs when someone asks why a claim was allowed to lapse.
create table if not exists public.tenure_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  portfolio_id uuid references public.monitored_portfolios(id) on delete cascade,
  entity text not null,          -- 'portfolio_tenure' | 'alert_policy' | 'alert_instance' | 'admin'
  entity_id uuid,
  action text not null,          -- 'decision_changed' | 'note_updated' | 'acknowledged' | …
  previous_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index if not exists tenure_audit_log_portfolio_idx
  on public.tenure_audit_log (portfolio_id, created_at desc);
create index if not exists tenure_audit_log_entity_idx
  on public.tenure_audit_log (entity, entity_id, created_at desc);

-- ── Row level security ─────────────────────────────────────────────────────
-- Default posture: revoke everything, then grant exactly what the UI needs.
-- Creation of portfolios and memberships goes through quota-bearing RPCs in
-- part 3, so INSERT is deliberately absent from the grants below.

alter table public.monitored_portfolios enable row level security;
revoke all on table public.monitored_portfolios from anon, authenticated;
drop policy if exists portfolios_select_own on public.monitored_portfolios;
create policy portfolios_select_own on public.monitored_portfolios
  for select to authenticated using (user_id = auth.uid());
drop policy if exists portfolios_update_own on public.monitored_portfolios;
create policy portfolios_update_own on public.monitored_portfolios
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists portfolios_delete_own on public.monitored_portfolios;
create policy portfolios_delete_own on public.monitored_portfolios
  for delete to authenticated using (user_id = auth.uid());
grant select, update, delete on table public.monitored_portfolios to authenticated;

alter table public.tenure_alert_policies enable row level security;
revoke all on table public.tenure_alert_policies from anon, authenticated;
drop policy if exists alert_policies_own on public.tenure_alert_policies;
create policy alert_policies_own on public.tenure_alert_policies
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on table public.tenure_alert_policies to authenticated;

alter table public.monitored_portfolio_tenures enable row level security;
revoke all on table public.monitored_portfolio_tenures from anon, authenticated;
drop policy if exists portfolio_tenures_select_own on public.monitored_portfolio_tenures;
create policy portfolio_tenures_select_own on public.monitored_portfolio_tenures
  for select to authenticated using (public.owns_portfolio(portfolio_id));
drop policy if exists portfolio_tenures_update_own on public.monitored_portfolio_tenures;
create policy portfolio_tenures_update_own on public.monitored_portfolio_tenures
  for update to authenticated
  using (public.owns_portfolio(portfolio_id))
  with check (public.owns_portfolio(portfolio_id));
drop policy if exists portfolio_tenures_delete_own on public.monitored_portfolio_tenures;
create policy portfolio_tenures_delete_own on public.monitored_portfolio_tenures
  for delete to authenticated using (public.owns_portfolio(portfolio_id));
grant select, update, delete on table public.monitored_portfolio_tenures to authenticated;

alter table public.tenure_alert_recipients enable row level security;
revoke all on table public.tenure_alert_recipients from anon, authenticated;
drop policy if exists alert_recipients_own on public.tenure_alert_recipients;
create policy alert_recipients_own on public.tenure_alert_recipients
  for all to authenticated
  using (exists (
    select 1 from public.tenure_alert_policies p
    where p.id = policy_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.tenure_alert_policies p
    where p.id = policy_id and p.user_id = auth.uid()
  ));
grant select, insert, update, delete on table public.tenure_alert_recipients to authenticated;

-- Alert instances are READ-ONLY to the client. They are generated by the
-- scheduler and mutated by the dispatcher; the one thing a user may do is
-- acknowledge one, which goes through an RPC in part 3 so the acknowledgement
-- is audited rather than silently written.
alter table public.tenure_alert_instances enable row level security;
revoke all on table public.tenure_alert_instances from anon, authenticated;
drop policy if exists alert_instances_select_own on public.tenure_alert_instances;
create policy alert_instances_select_own on public.tenure_alert_instances
  for select to authenticated using (public.owns_portfolio(portfolio_id));
grant select on table public.tenure_alert_instances to authenticated;

-- Audit log is append-only from the user's perspective: readable for their own
-- portfolios, never writable or editable by the client.
alter table public.tenure_audit_log enable row level security;
revoke all on table public.tenure_audit_log from anon, authenticated;
drop policy if exists tenure_audit_select_own on public.tenure_audit_log;
create policy tenure_audit_select_own on public.tenure_audit_log
  for select to authenticated using (public.owns_portfolio(portfolio_id));
grant select on table public.tenure_audit_log to authenticated;

-- ── Post-migration verification (run manually) ─────────────────────────────
--   -- as user A, create a portfolio via the RPC in part 3, then as user B:
--   select * from public.monitored_portfolios;            -- expect 0 rows
--   select * from public.monitored_portfolio_tenures;     -- expect 0 rows
--   select * from public.tenure_alert_instances;          -- expect 0 rows
--   -- direct membership insert must be refused (no INSERT grant):
--   insert into public.monitored_portfolio_tenures (portfolio_id, tenure_id)
--     values ('<A''s portfolio>', '<any tenure>');        -- expect permission denied
--   -- RLS on everywhere:
--   select relname, relrowsecurity from pg_class where relname like '%portfolio%'
--      or relname like 'tenure_alert%' or relname = 'tenure_audit_log';
