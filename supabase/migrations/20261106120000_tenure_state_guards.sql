-- ============================================================
-- Tenure monitor state guards (docs/state-machines.md, TEN-5 and TEN-8).
--
-- TEN-5: a sync dry run was recorded as status 'succeeded' with
-- records_processed 0. It then showed as the last successful sync, made the
-- alert job treat the data as untrusted, and became the guardrail baseline,
-- which disables the sharp-drop check on the next real run. Dry runs now get
-- their own status, which no reader treats as a sync.
--
-- TEN-8: authenticated users had a table-wide UPDATE grant on memberships,
-- so `update ... set removed_at = null` revived removed tenures without the
-- quota check (and `tenure_id` could be swapped in place). UPDATE is now
-- limited to the columns the app edits. The recipient guard ran on INSERT
-- only, so an UPDATE skipped email validation and could move a recipient onto
-- a policy that was already at its limit; and its row lock locked nothing on
-- a policy with no recipients, so two concurrent inserts both passed.
--
-- Rollback:
--   alter table public.tenure_import_runs drop constraint tenure_import_runs_status_check;
--   alter table public.tenure_import_runs add constraint tenure_import_runs_status_check
--     check (status in ('running', 'succeeded', 'aborted', 'failed'));
--   grant update on table public.monitored_portfolio_tenures to authenticated;
--   re-apply 20260801000003_tenure_quota_and_admin.sql (recipient guard).
-- ============================================================

-- ── TEN-5 ───────────────────────────────────────────────────────────────────
alter table public.tenure_import_runs drop constraint if exists tenure_import_runs_status_check;
alter table public.tenure_import_runs add constraint tenure_import_runs_status_check
  check (status in ('running', 'succeeded', 'aborted', 'failed', 'dry_run'));

-- ── TEN-8: memberships ─────────────────────────────────────────────────────
-- Adding, removing and reviving go through the RPCs, which check the plan.
revoke update on table public.monitored_portfolio_tenures from authenticated;
grant update (
  internal_project_name, internal_notes, maintenance_decision, decision_due_date,
  maintenance_reference, assigned_user_id, monitoring_enabled, updated_at
) on table public.monitored_portfolio_tenures to authenticated;

-- ── TEN-8: recipients ──────────────────────────────────────────────────────
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

  -- Shape check only; the dispatcher records hard bounces.
  if new.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or length(new.email) > 254 then
    raise exception 'invalid recipient email address' using errcode = '22023';
  end if;

  -- Service-role callers are not subject to a customer plan limit.
  if auth.uid() is null then
    return new;
  end if;

  -- An update that keeps the row on its policy does not add a recipient.
  if tg_op = 'UPDATE' and new.policy_id = old.policy_id then
    return new;
  end if;

  select nullif(public.tenure_plan_limits()->>'max_alert_recipients', '')::int into v_limit;
  if v_limit is null then
    return new;   -- unlimited
  end if;

  -- An advisory lock, not a row lock: a policy with no recipients has no rows
  -- to lock, and two inserts would otherwise both count zero.
  perform pg_advisory_xact_lock(hashtextextended('tenure_recipients:' || new.policy_id::text, 0));
  select count(*) into v_count
  from public.tenure_alert_recipients
  where policy_id = new.policy_id and id is distinct from new.id;

  if v_count >= v_limit then
    raise exception 'RECIPIENT_LIMIT: this plan allows % alert recipient(s)', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists tenure_recipient_guard on public.tenure_alert_recipients;
create trigger tenure_recipient_guard
  before insert or update on public.tenure_alert_recipients
  for each row execute function public.tenure_recipient_guard();
