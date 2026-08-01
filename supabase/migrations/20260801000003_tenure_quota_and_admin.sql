-- ============================================================
-- TENURE MONITOR — part 3 of 3: plan limits, write paths, audit, admin ops.
--
-- WHY THE DATABASE OWNS THE LIMITS
--   src/utils/entitlements.js shapes the interface; it does not enforce
--   anything. A limit that lives only in the browser is a suggestion — it can
--   be bypassed with a direct supabase-js call and raced by two tabs. So the
--   quota is evaluated here, inside the same transaction as the insert, in
--   exactly the pattern create_cloud_project already established
--   (20260728000002). The two tables of numbers must be kept in step; the
--   comment in each names the other.
--
-- WHY WRITES GO THROUGH FUNCTIONS
--   Part 2 granted SELECT/UPDATE/DELETE on the portfolio tables but withheld
--   INSERT. Creating a portfolio or adding a title is therefore only possible
--   through the functions below, which is what makes the quota unavoidable
--   rather than merely usual.
--
-- Depends on: 20260801000001, 20260801000002, 20260710000005 (is_admin),
--             20260716000001 (user_plans).
--
-- Rollback:
--   drop function if exists public.admin_get_tenure_ops();
--   drop function if exists public.admin_set_tenure_alert_pause(uuid, boolean, text);
--   drop function if exists public.admin_set_tenure_notice(text, text, boolean);
--   drop function if exists public.admin_retry_tenure_alert(uuid);
--   drop function if exists public.acknowledge_tenure_alert(uuid);
--   drop function if exists public.remove_portfolio_tenure(uuid, uuid);
--   drop function if exists public.add_portfolio_tenures(uuid, uuid[]);
--   drop function if exists public.create_monitored_portfolio(text, integer[]);
--   drop function if exists public.tenure_plan_limits();
--   drop trigger if exists tenure_membership_audit on public.monitored_portfolio_tenures;
--   drop function if exists public.tenure_membership_audit();
--   drop trigger if exists tenure_recipient_guard on public.tenure_alert_recipients;
--   drop function if exists public.tenure_recipient_guard();
--   alter table public.monitored_portfolios drop constraint if exists monitored_portfolios_name_len;
--   drop table if exists public.tenure_system_notices;
--   alter table public.user_plans drop constraint if exists user_plans_plan_check;
--   alter table public.user_plans add constraint user_plans_plan_check
--     check (plan in ('free','pro'));
-- ============================================================

-- ── Make room for a future Company plan ────────────────────────────────────
-- Purely additive: nothing writes 'company' yet, no price exists for it, and
-- the Stripe webhook still only ever writes 'free'/'pro'. Widening the check
-- now means the later plan is configuration rather than a schema change under
-- commercial pressure.
alter table public.user_plans drop constraint if exists user_plans_plan_check;
alter table public.user_plans add constraint user_plans_plan_check
  check (plan in ('free', 'pro', 'company'));

-- ── Plan limits ────────────────────────────────────────────────────────────
-- MIRRORS src/utils/entitlements.js — keep the two in step.
--   free    → 10 tenures,  1 portfolio,   1 recipient,  [90, 30]
--   pro     → 50 tenures,  unlimited,     2 recipients, [90, 30, 7]
--   company → 500 tenures, unlimited,    10 recipients, full ladder (not sold yet)
-- NULL means unlimited. Grandfathered and admin accounts resolve as pro.
create or replace function public.tenure_plan_limits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
  v_source text;
  v_effective text;
begin
  if v_user is null then
    -- Anonymous callers get the free shape so the UI can render limits on a
    -- signed-out landing view without inventing numbers.
    return jsonb_build_object(
      'plan', 'anonymous',
      'max_monitored_tenures', 0,
      'max_portfolios', 0,
      'max_alert_recipients', 0,
      'alert_offsets', jsonb_build_array()
    );
  end if;

  select plan, source into v_plan, v_source
  from public.user_plans where user_id = v_user;

  -- Fail CLOSED on an unresolved plan: a missing row is a free account, not a
  -- free upgrade. (useAuth applies a bounded grace window client-side for a
  -- CONFIRMED Pro user during an outage; that is a UI affordance, and it
  -- deliberately does not extend to server-enforced quota.)
  if coalesce(v_source, '') in ('grandfathered', 'admin') then
    v_effective := 'pro';
  else
    v_effective := coalesce(v_plan, 'free');
  end if;

  if v_effective = 'company' then
    return jsonb_build_object(
      'plan', 'company',
      'max_monitored_tenures', 500,
      'max_portfolios', null,
      'max_alert_recipients', 10,
      'alert_offsets', jsonb_build_array(180, 120, 90, 60, 30, 14, 7, 3, 1)
    );
  elsif v_effective = 'pro' then
    return jsonb_build_object(
      'plan', 'pro',
      'max_monitored_tenures', 50,
      'max_portfolios', null,
      'max_alert_recipients', 2,
      'alert_offsets', jsonb_build_array(90, 30, 7)
    );
  end if;

  return jsonb_build_object(
    'plan', 'free',
    'max_monitored_tenures', 10,
    'max_portfolios', 1,
    'max_alert_recipients', 1,
    'alert_offsets', jsonb_build_array(90, 30)
  );
end;
$$;

revoke all on function public.tenure_plan_limits() from public;
grant execute on function public.tenure_plan_limits() to authenticated, service_role;

-- ── Create a portfolio ─────────────────────────────────────────────────────
-- Also creates the default alert policy and seeds the owner's own address as
-- the first recipient, so a new portfolio is actually monitored rather than
-- silently inert until somebody finds the settings screen.
create or replace function public.create_monitored_portfolio(
  p_name text,
  p_offsets integer[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_limits jsonb;
  v_max_portfolios int;
  v_count int;
  v_allowed jsonb;
  v_offsets integer[];
  v_policy uuid;
  v_portfolio uuid;
  v_email text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 120 then
    raise exception 'invalid portfolio name' using errcode = '22023';
  end if;

  v_limits := public.tenure_plan_limits();
  v_max_portfolios := nullif(v_limits->>'max_portfolios', '')::int;

  if v_max_portfolios is not null then
    -- Lock this user's rows so two concurrent creates at the limit serialize.
    perform 1 from public.monitored_portfolios where user_id = v_user for update;
    select count(*) into v_count from public.monitored_portfolios where user_id = v_user;
    if v_count >= v_max_portfolios then
      raise exception 'PORTFOLIO_LIMIT: this plan allows % portfolio(s)', v_max_portfolios
        using errcode = 'P0001';
    end if;
  end if;

  -- Requested offsets are intersected with what the plan permits, rather than
  -- rejected. Asking for a 7-day reminder on the free plan gets you 90/30 and
  -- an upgrade prompt in the UI — not an error dialog.
  v_allowed := v_limits->'alert_offsets';
  if p_offsets is null then
    select array_agg(value::int order by value::int desc)
      into v_offsets from jsonb_array_elements_text(v_allowed) as value;
  else
    select array_agg(distinct o order by o desc) into v_offsets
    from unnest(p_offsets) as o
    where o::text in (select value from jsonb_array_elements_text(v_allowed) as value);
    if v_offsets is null or array_length(v_offsets, 1) is null then
      select array_agg(value::int order by value::int desc)
        into v_offsets from jsonb_array_elements_text(v_allowed) as value;
    end if;
  end if;

  insert into public.tenure_alert_policies (user_id, name, expiry_offsets)
  values (v_user, 'Default alert policy', coalesce(v_offsets, array[90, 30]))
  returning id into v_policy;

  insert into public.monitored_portfolios (user_id, name, alert_policy_id)
  values (v_user, btrim(p_name), v_policy)
  returning id into v_portfolio;

  -- Seed the owner as the first recipient. auth.users is readable from a
  -- definer function; the address is the one they already signed in with.
  select email into v_email from auth.users where id = v_user;
  if v_email is not null then
    insert into public.tenure_alert_recipients (policy_id, user_id, email, role, receives_failure_alerts)
    values (v_policy, v_user, v_email, 'owner', true)
    on conflict (policy_id, email) do nothing;
  end if;

  insert into public.tenure_audit_log (user_id, portfolio_id, entity, entity_id, action, new_value)
  values (v_user, v_portfolio, 'portfolio', v_portfolio, 'portfolio_created', btrim(p_name));

  return v_portfolio;
end;
$$;

revoke all on function public.create_monitored_portfolio(text, integer[]) from public;
grant execute on function public.create_monitored_portfolio(text, integer[]) to authenticated;

-- ── Add tenures to a portfolio ─────────────────────────────────────────────
-- Transactional and partial-by-design: adding 12 titles to a free portfolio
-- holding 3 adds 7 and reports the rest as skipped, rather than failing the
-- whole batch. The user gets their claims AND an honest upgrade prompt.
create or replace function public.add_portfolio_tenures(
  p_portfolio_id uuid,
  p_tenure_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_limits jsonb;
  v_max int;
  v_current int;
  v_room int;
  v_added int := 0;
  v_already int := 0;
  v_requested int;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.owns_portfolio(p_portfolio_id) then
    raise exception 'portfolio not found' using errcode = '42501';
  end if;
  if p_tenure_ids is null or array_length(p_tenure_ids, 1) is null then
    return jsonb_build_object('added', 0, 'already_present', 0, 'skipped_over_limit', 0);
  end if;

  v_requested := array_length(p_tenure_ids, 1);
  -- Bound the batch so one request cannot be used to hammer the quota check.
  if v_requested > 1000 then
    raise exception 'too many tenures in one request' using errcode = '22023';
  end if;

  v_limits := public.tenure_plan_limits();
  v_max := nullif(v_limits->>'max_monitored_tenures', '')::int;

  -- Lock the user's live memberships so two tabs cannot both see room for one.
  perform 1
  from public.monitored_portfolio_tenures mpt
  join public.monitored_portfolios p on p.id = mpt.portfolio_id
  where p.user_id = v_user and mpt.removed_at is null
  for update of mpt;

  select count(*) into v_current
  from public.monitored_portfolio_tenures mpt
  join public.monitored_portfolios p on p.id = mpt.portfolio_id
  where p.user_id = v_user and mpt.removed_at is null;

  if v_max is null then
    v_room := v_requested;
  else
    v_room := greatest(v_max - v_current, 0);
  end if;

  -- Re-adding a previously removed title revives that membership instead of
  -- creating a second row, so its notes and decision history survive.
  for v_id in
    select unnest(p_tenure_ids)
  loop
    if exists (
      select 1 from public.monitored_portfolio_tenures
      where portfolio_id = p_portfolio_id and tenure_id = v_id and removed_at is null
    ) then
      v_already := v_already + 1;
      continue;
    end if;

    exit when v_room <= 0;

    -- Only real tenures. A client passing an unknown uuid gets it dropped
    -- rather than creating a dangling membership.
    if not exists (select 1 from public.tenures where id = v_id) then
      continue;
    end if;

    update public.monitored_portfolio_tenures
       set removed_at = null, updated_at = now(), monitoring_enabled = true
     where portfolio_id = p_portfolio_id and tenure_id = v_id and removed_at is not null;

    if not found then
      insert into public.monitored_portfolio_tenures (portfolio_id, tenure_id, added_by_user_id)
      values (p_portfolio_id, v_id, v_user);
    end if;

    v_added := v_added + 1;
    v_room := v_room - 1;
  end loop;

  if v_added > 0 then
    insert into public.tenure_audit_log (user_id, portfolio_id, entity, entity_id, action, new_value)
    values (v_user, p_portfolio_id, 'portfolio_tenure', p_portfolio_id, 'tenures_added', v_added::text);
  end if;

  return jsonb_build_object(
    'added', v_added,
    'already_present', v_already,
    'skipped_over_limit', greatest(v_requested - v_added - v_already, 0),
    'max_monitored_tenures', v_max,
    'current_total', v_current + v_added
  );
end;
$$;

revoke all on function public.add_portfolio_tenures(uuid, uuid[]) from public;
grant execute on function public.add_portfolio_tenures(uuid, uuid[]) to authenticated;

-- ── Remove a tenure (soft) ─────────────────────────────────────────────────
-- Soft removal plus cancellation of that title's pending alerts, so stopping
-- monitoring actually stops the emails. Without the second half, a removed
-- claim would keep reminding somebody about a deadline they chose to drop.
create or replace function public.remove_portfolio_tenure(
  p_portfolio_id uuid,
  p_tenure_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.owns_portfolio(p_portfolio_id) then
    raise exception 'portfolio not found' using errcode = '42501';
  end if;

  update public.monitored_portfolio_tenures
     set removed_at = now(), updated_at = now()
   where portfolio_id = p_portfolio_id and tenure_id = p_tenure_id and removed_at is null;

  if not found then return false; end if;

  update public.tenure_alert_instances
     set status = 'cancelled', updated_at = now()
   where portfolio_id = p_portfolio_id and tenure_id = p_tenure_id and status = 'pending';

  insert into public.tenure_audit_log (user_id, portfolio_id, entity, entity_id, action, previous_value)
  values (v_user, p_portfolio_id, 'portfolio_tenure', p_tenure_id, 'tenure_removed', p_tenure_id::text);

  return true;
end;
$$;

revoke all on function public.remove_portfolio_tenure(uuid, uuid) from public;
grant execute on function public.remove_portfolio_tenure(uuid, uuid) to authenticated;

-- ── Alert-recipient limit and address validation ───────────────────────────
--
-- Recipients are created by a direct INSERT under RLS, because "add a
-- colleague's address" is a plain form and an RPC would buy nothing. But that
-- left `max_alert_recipients` as the one plan limit this feature returned from
-- tenure_plan_limits() and then never enforced — a limit that lived only in
-- src/utils/entitlements.js, which is exactly what the header of this file says
-- a limit must never be. One supabase-js call bypassed it.
--
-- That matters for more than billing. The alert engine fans one email out to
-- every row here, from a domain with valid SPF/DKIM, so an unbounded recipient
-- list is an outbound-mail primitive pointed at addresses that never opted in.
--
-- A BEFORE INSERT trigger rather than an RPC: it is the one chokepoint every
-- insert passes through, including any future screen, and it leaves the
-- existing client call working unchanged.
create or replace function public.tenure_recipient_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int;
  v_count int;
begin
  new.email := lower(btrim(coalesce(new.email, '')));

  -- Shape check only. This is not an attempt to decide whether an address is
  -- deliverable — the dispatcher records a hard bounce and stops using it.
  -- The point is to reject obvious junk and, importantly, anything carrying
  -- whitespace or a control character that could be smuggled into a header.
  if new.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or length(new.email) > 254 then
    raise exception 'invalid recipient email address' using errcode = '22023';
  end if;

  -- Service-role callers (the importer, the alert engine, migrations) are not
  -- subject to a customer plan limit, and auth.uid() is null for them.
  if auth.uid() is null then
    return new;
  end if;

  select nullif(public.tenure_plan_limits()->>'max_alert_recipients', '')::int into v_limit;
  if v_limit is null then
    return new;   -- unlimited
  end if;

  -- Lock this policy's existing rows so two concurrent inserts at the limit
  -- serialize, the same way create_monitored_portfolio locks before counting.
  perform 1 from public.tenure_alert_recipients where policy_id = new.policy_id for update;
  select count(*) into v_count
  from public.tenure_alert_recipients where policy_id = new.policy_id;

  if v_count >= v_limit then
    raise exception 'RECIPIENT_LIMIT: this plan allows % alert recipient(s)', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists tenure_recipient_guard on public.tenure_alert_recipients;
create trigger tenure_recipient_guard
  before insert on public.tenure_alert_recipients
  for each row execute function public.tenure_recipient_guard();

-- ── Portfolio name bounds ──────────────────────────────────────────────────
-- create_monitored_portfolio validates the name on creation, but renaming is a
-- direct UPDATE under RLS, so that validation was bypassable by the very path
-- the UI uses. The name is rendered into every reminder email, so bound it at
-- the column where neither path can miss it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'monitored_portfolios_name_len'
  ) then
    alter table public.monitored_portfolios
      add constraint monitored_portfolios_name_len
      check (length(btrim(name)) between 1 and 120);
  end if;
end
$$;

-- ── Membership audit trigger ───────────────────────────────────────────────
-- Decisions and notes are edited by direct UPDATE under RLS (part 2), which is
-- the right shape for a form. A trigger — not a wrapper function — is what
-- guarantees every one of those edits lands in the audit log, including edits
-- made from a future screen nobody has written yet.
create or replace function public.tenure_membership_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Reference notes are a convenience field, never a credential store. Cap the
  -- length here so the cap cannot be bypassed by a direct API call; the UI
  -- states plainly that MTO passwords do not belong in it.
  if new.maintenance_reference is not null and length(new.maintenance_reference) > 500 then
    raise exception 'maintenance reference too long' using errcode = '22023';
  end if;
  if new.internal_notes is not null and length(new.internal_notes) > 5000 then
    raise exception 'internal notes too long' using errcode = '22023';
  end if;
  -- Also rendered into reminder emails, so bounded here for the same reason
  -- the portfolio name is bounded at its column.
  if new.internal_project_name is not null and length(new.internal_project_name) > 120 then
    raise exception 'internal project name too long' using errcode = '22023';
  end if;

  if new.maintenance_decision is distinct from old.maintenance_decision then
    insert into public.tenure_audit_log
      (user_id, portfolio_id, entity, entity_id, action, previous_value, new_value)
    values (auth.uid(), new.portfolio_id, 'portfolio_tenure', new.id,
            'decision_changed', old.maintenance_decision, new.maintenance_decision);
  end if;

  if new.assigned_user_id is distinct from old.assigned_user_id then
    insert into public.tenure_audit_log
      (user_id, portfolio_id, entity, entity_id, action, previous_value, new_value)
    values (auth.uid(), new.portfolio_id, 'portfolio_tenure', new.id,
            'assignee_changed', old.assigned_user_id::text, new.assigned_user_id::text);
  end if;

  if new.internal_notes is distinct from old.internal_notes then
    -- The note body is the customer's private content; the audit trail records
    -- that it changed and when, not a second copy of every draft.
    insert into public.tenure_audit_log
      (user_id, portfolio_id, entity, entity_id, action, new_value)
    values (auth.uid(), new.portfolio_id, 'portfolio_tenure', new.id,
            'note_updated', left(coalesce(new.internal_notes, ''), 80));
  end if;

  if new.monitoring_enabled is distinct from old.monitoring_enabled then
    insert into public.tenure_audit_log
      (user_id, portfolio_id, entity, entity_id, action, previous_value, new_value)
    values (auth.uid(), new.portfolio_id, 'portfolio_tenure', new.id,
            'monitoring_toggled', old.monitoring_enabled::text, new.monitoring_enabled::text);
    -- Turning monitoring off must stop the pending reminders too.
    if new.monitoring_enabled = false then
      update public.tenure_alert_instances
         set status = 'cancelled', updated_at = now()
       where portfolio_id = new.portfolio_id and tenure_id = new.tenure_id and status = 'pending';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tenure_membership_audit on public.monitored_portfolio_tenures;
create trigger tenure_membership_audit
  before update on public.monitored_portfolio_tenures
  for each row execute function public.tenure_membership_audit();

-- ── Acknowledge an alert ───────────────────────────────────────────────────
create or replace function public.acknowledge_tenure_alert(p_alert_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_portfolio uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select portfolio_id into v_portfolio
  from public.tenure_alert_instances where id = p_alert_id;

  if v_portfolio is null or not public.owns_portfolio(v_portfolio) then
    -- Same answer for "does not exist" and "belongs to someone else", so this
    -- cannot be used to probe for other customers' alert ids.
    raise exception 'alert not found' using errcode = '42501';
  end if;

  update public.tenure_alert_instances
     set acknowledged_at = now(), acknowledged_by_user_id = v_user, updated_at = now()
   where id = p_alert_id and acknowledged_at is null;

  if not found then return false; end if;

  insert into public.tenure_audit_log (user_id, portfolio_id, entity, entity_id, action)
  values (v_user, v_portfolio, 'alert_instance', p_alert_id, 'acknowledged');

  return true;
end;
$$;

revoke all on function public.acknowledge_tenure_alert(uuid) from public;
grant execute on function public.acknowledge_tenure_alert(uuid) to authenticated;

-- ── Portfolio summary ──────────────────────────────────────────────────────
-- One round trip for the header strip. Days are computed in America/Vancouver
-- in SQL so the numbers match src/utils/tenureDates.js exactly rather than
-- drifting by a day for users east of the province.
create or replace function public.tenure_portfolio_summary(p_portfolio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'America/Vancouver')::date;
  v_result jsonb;
begin
  if not public.owns_portfolio(p_portfolio_id) then
    raise exception 'portfolio not found' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_tenures', count(*),
    'total_hectares', coalesce(sum(t.area_hectares), 0),
    'expiring_30', count(*) filter (
      where t.good_to_date is not null and t.good_to_date - v_today between 0 and 30),
    'expiring_90', count(*) filter (
      where t.good_to_date is not null and t.good_to_date - v_today between 0 and 90),
    'expiring_365', count(*) filter (
      where t.good_to_date is not null and t.good_to_date - v_today between 0 and 365),
    'expired', count(*) filter (
      where t.good_to_date is not null and t.good_to_date < v_today),
    'missing_date', count(*) filter (where t.good_to_date is null),
    'needs_review', count(*) filter (
      where mpt.maintenance_decision in ('REVIEW', 'NEEDS_VERIFICATION', 'UNDECIDED')),
    'not_observed', count(*) filter (where t.missing_run_count >= 2),
    'changed_recently', (
      select count(distinct ce.tenure_id)
      from public.tenure_change_events ce
      join public.monitored_portfolio_tenures m2 on m2.tenure_id = ce.tenure_id
      where m2.portfolio_id = p_portfolio_id and m2.removed_at is null
        and ce.detected_at > now() - interval '30 days'
    )
  )
  into v_result
  from public.monitored_portfolio_tenures mpt
  join public.tenures t on t.id = mpt.tenure_id
  where mpt.portfolio_id = p_portfolio_id and mpt.removed_at is null;

  return coalesce(v_result, jsonb_build_object('total_tenures', 0, 'total_hectares', 0));
end;
$$;

revoke all on function public.tenure_portfolio_summary(uuid) from public;
grant execute on function public.tenure_portfolio_summary(uuid) to authenticated;

-- ── System notices (government-data incidents) ─────────────────────────────
create table if not exists public.tenure_system_notices (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenure_system_notices enable row level security;
revoke all on table public.tenure_system_notices from anon, authenticated;
drop policy if exists tenure_notices_read on public.tenure_system_notices;
-- Everyone reads active notices: an incident banner is useless if it is only
-- visible to the person who filed it.
create policy tenure_notices_read on public.tenure_system_notices
  for select using (active = true);
grant select on table public.tenure_system_notices to anon, authenticated;

-- ── Administrative operations ──────────────────────────────────────────────
-- Everything below is gated on is_admin() inside the function body AND has its
-- EXECUTE grant limited to authenticated, matching the hardening in
-- 20260710000005. Every override writes an audit row.

create or replace function public.admin_get_tenure_ops()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'last_successful_sync', (
      select jsonb_build_object(
        'completed_at', completed_at, 'records_processed', records_processed,
        'records_rejected', records_rejected, 'mode', mode, 'alerts_safe', alerts_safe)
      from public.tenure_import_runs
      where status = 'succeeded' order by completed_at desc nulls last limit 1
    ),
    'recent_runs', coalesce((
      select jsonb_agg(r order by r->>'started_at' desc)
      from (
        select jsonb_build_object(
          'id', id, 'mode', mode, 'status', status, 'started_at', started_at,
          'completed_at', completed_at, 'records_received', records_received,
          'records_processed', records_processed, 'records_rejected', records_rejected,
          'records_created', records_created, 'records_updated', records_updated,
          'material_changes_detected', material_changes_detected,
          'schema_fingerprint', schema_fingerprint, 'alerts_safe', alerts_safe,
          'error_summary', error_summary, 'guardrail_report', guardrail_report) as r
        from public.tenure_import_runs order by started_at desc limit 25
      ) s
    ), '[]'::jsonb),
    'tenure_count', (select count(*) from public.tenures),
    'owner_count', (select count(*) from public.tenure_owners),
    'not_observed_count', (select count(*) from public.tenures where missing_run_count >= 2),
    'alerts', (
      select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'due_now', count(*) filter (
          where status = 'pending'
            and scheduled_for <= (now() at time zone 'America/Vancouver')::date),
        'failed', count(*) filter (where status = 'failed'),
        'suppressed', count(*) filter (where status = 'suppressed'),
        'sent_7d', count(*) filter (where status = 'sent' and sent_at > now() - interval '7 days'))
      from public.tenure_alert_instances
    ),
    'bounced_recipients', coalesce((
      select jsonb_agg(jsonb_build_object('email', email, 'bounced_at', bounced_at, 'reason', bounce_reason))
      from public.tenure_alert_recipients where bounced_at is not null limit 50
    ), '[]'::jsonb),
    'portfolios', coalesce((
      select jsonb_agg(p order by p->>'monitored' desc)
      from (
        select jsonb_build_object(
          'portfolio_id', mp.id,
          'name', mp.name,
          'user_id', mp.user_id,
          'alerts_paused', mp.alerts_paused,
          'created_at', mp.created_at,
          'plan', coalesce(up.plan, 'free'),
          'monitored', (
            select count(*) from public.monitored_portfolio_tenures m
            where m.portfolio_id = mp.id and m.removed_at is null)) as p
        from public.monitored_portfolios mp
        left join public.user_plans up on up.user_id = mp.user_id
        order by mp.created_at desc limit 200
      ) s
    ), '[]'::jsonb),
    'recent_changes', coalesce((
      select jsonb_agg(c order by c->>'detected_at' desc)
      from (
        select jsonb_build_object(
          'tenure_number', t.tenure_number, 'event_type', ce.event_type,
          'previous_value', ce.previous_value, 'current_value', ce.current_value,
          'severity', ce.severity, 'detected_at', ce.detected_at) as c
        from public.tenure_change_events ce
        join public.tenures t on t.id = ce.tenure_id
        order by ce.detected_at desc limit 50
      ) s
    ), '[]'::jsonb),
    'active_notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'message', message, 'severity', severity))
      from public.tenure_system_notices where active = true
    ), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

revoke all on function public.admin_get_tenure_ops() from public;
grant execute on function public.admin_get_tenure_ops() to authenticated;

-- Pause alerts globally (p_portfolio_id null) or for one portfolio.
create or replace function public.admin_set_tenure_alert_pause(
  p_portfolio_id uuid,
  p_paused boolean,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_portfolio_id is null then
    update public.monitored_portfolios
       set alerts_paused = p_paused, paused_reason = p_reason, updated_at = now();
  else
    update public.monitored_portfolios
       set alerts_paused = p_paused, paused_reason = p_reason, updated_at = now()
     where id = p_portfolio_id;
  end if;
  get diagnostics v_count = row_count;

  insert into public.tenure_audit_log (user_id, portfolio_id, entity, entity_id, action, new_value)
  values (auth.uid(), p_portfolio_id, 'admin', p_portfolio_id,
          case when p_paused then 'alerts_paused' else 'alerts_resumed' end,
          coalesce(p_reason, ''));

  return v_count;
end;
$$;

revoke all on function public.admin_set_tenure_alert_pause(uuid, boolean, text) from public;
grant execute on function public.admin_set_tenure_alert_pause(uuid, boolean, text) to authenticated;

-- Post or clear a government-data incident banner.
create or replace function public.admin_set_tenure_notice(
  p_message text,
  p_severity text default 'warning',
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_active then
    if p_message is null or length(btrim(p_message)) = 0 or length(p_message) > 500 then
      raise exception 'invalid notice message' using errcode = '22023';
    end if;
    -- One banner at a time: a stack of stale notices is noise, not information.
    update public.tenure_system_notices set active = false, updated_at = now() where active = true;
    insert into public.tenure_system_notices (message, severity, created_by)
    values (btrim(p_message), p_severity, auth.uid())
    returning id into v_id;
  else
    update public.tenure_system_notices set active = false, updated_at = now() where active = true;
  end if;

  insert into public.tenure_audit_log (user_id, entity, action, new_value)
  values (auth.uid(), 'admin', case when p_active then 'notice_posted' else 'notice_cleared' end,
          left(coalesce(p_message, ''), 200));

  return v_id;
end;
$$;

revoke all on function public.admin_set_tenure_notice(text, text, boolean) from public;
grant execute on function public.admin_set_tenure_notice(text, text, boolean) to authenticated;

-- Re-queue a failed alert. Resets the attempt counter so the dispatcher will
-- pick it up on its next run.
create or replace function public.admin_retry_tenure_alert(p_alert_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.tenure_alert_instances
     set status = 'pending', attempt_count = 0, updated_at = now()
   where id = p_alert_id and status in ('failed', 'suppressed');

  if not found then return false; end if;

  insert into public.tenure_audit_log (user_id, entity, entity_id, action)
  values (auth.uid(), 'admin', p_alert_id, 'alert_retry_queued');

  return true;
end;
$$;

revoke all on function public.admin_retry_tenure_alert(uuid) from public;
grant execute on function public.admin_retry_tenure_alert(uuid) to authenticated;

-- ── Post-migration verification (run manually) ─────────────────────────────
--   select public.tenure_plan_limits();
--   -- as a free user with one portfolio:
--   select public.create_monitored_portfolio('second');      -- expect PORTFOLIO_LIMIT
--   -- adding 12 titles to a free portfolio holding 3:
--   select public.add_portfolio_tenures('<id>', array[...]); -- expect added:7, skipped:5
--   -- as a non-admin:
--   select public.admin_get_tenure_ops();                    -- expect not authorized
--   -- audit trail is populated:
--   select action, previous_value, new_value from public.tenure_audit_log order by created_at desc limit 10;
