-- ============================================================
-- Two small extensions to Tenure Monitor, both to existing structures.
--
-- 1. A FINAL 1-DAY REMINDER, on every plan.
--
--    The offset ladders live in two places that must agree: the client matrix
--    in src/utils/entitlements.js shapes the settings screen, and
--    tenure_plan_limits() is the authority the tenure_policy_offsets_guard
--    trigger (20260801000008) intersects every saved policy against. Adding
--    the offset to the client alone would let a user tick "1 day before" and
--    have the trigger silently strip it back out on save.
--
--    It goes to FREE as well as PRO. The product's whole position on deadline
--    reminders is that going quiet about a real date is the worse failure —
--    it is why expiry alerts still send when an import is untrusted
--    (plan.mjs maySend). Charging for the last reminder before a claim lapses
--    would contradict that for the sake of a paywall the 7-day offset already
--    provides. Free stays capped where it matters: 10 titles, 1 portfolio,
--    1 recipient.
--
-- 2. WHO LAST TOUCHED A NOTE, AND WHEN.
--
--    internal_notes has existed since 20260801000002, and every edit already
--    lands in tenure_audit_log via tenure_membership_audit(). What the claim
--    detail panel could not show is the one thing a reader of a note actually
--    needs — whether it is current. `updated_at` cannot answer that: it moves
--    on any edit, so a note from March reads as fresh because somebody changed
--    the decision dropdown this morning.
--
--    So: two dedicated columns, written by the trigger that already detects
--    the change. Not a note-history table — the brief is explicit that notes
--    stay simple, and tenure_audit_log already holds the history for anyone
--    who needs it.
--
-- Rollback:
--   alter table public.monitored_portfolio_tenures
--     drop column if exists notes_updated_at,
--     drop column if exists notes_updated_by;
--   -- then re-apply the tenure_plan_limits() and tenure_membership_audit()
--   -- bodies from 20260801000003.
-- ============================================================

-- ── 1. Offset ladders ──────────────────────────────────────────────────────
-- Mirrors src/utils/entitlements.js. THE DATABASE IS THE AUTHORITY; the client
-- matrix only shapes the UI.
--
--   free    → 10 tenures,  1 portfolio,  1 recipient,  [90, 30, 1]
--   pro     → 50 tenures,  unlimited,    2 recipients, [90, 30, 7, 1]
--   company → 500 tenures, unlimited,   10 recipients, full ladder (not sold)
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
      'alert_offsets', jsonb_build_array(90, 30, 7, 1)
    );
  end if;

  return jsonb_build_object(
    'plan', 'free',
    'max_monitored_tenures', 10,
    'max_portfolios', 1,
    'max_alert_recipients', 1,
    'alert_offsets', jsonb_build_array(90, 30, 1)
  );
end;
$$;

revoke all on function public.tenure_plan_limits() from public, anon;
grant execute on function public.tenure_plan_limits() to authenticated, service_role;

-- ── 2. Note metadata ───────────────────────────────────────────────────────
alter table public.monitored_portfolio_tenures
  add column if not exists notes_updated_at timestamptz,
  add column if not exists notes_updated_by uuid references auth.users(id) on delete set null;

comment on column public.monitored_portfolio_tenures.notes_updated_at is
  'When internal_notes last changed. Distinct from updated_at, which moves on any edit.';

-- The same trigger as 20260801000003, with the note branch extended. Rewritten
-- whole rather than patched, because a trigger body that lives in two
-- migrations is a trigger body nobody can read.
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

    -- Set here rather than trusting the client: a caller that could set its own
    -- notes_updated_by could attribute a note to a colleague. Assigned even
    -- when the note is cleared, because "emptied on the 3rd" is also something
    -- a reader needs to be able to see.
    new.notes_updated_at := now();
    new.notes_updated_by := auth.uid();
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

revoke execute on function public.tenure_membership_audit() from public, anon, authenticated;

drop trigger if exists tenure_membership_audit on public.monitored_portfolio_tenures;
create trigger tenure_membership_audit
  before update on public.monitored_portfolio_tenures
  for each row execute function public.tenure_membership_audit();

-- ── Verification ───────────────────────────────────────────────────────────
--   -- 1-day offset is now in the ladder:
--   select public.tenure_plan_limits()->'alert_offsets';
--
--   -- and the guard accepts it (previously it would strip the 1 back out):
--   update public.tenure_alert_policies set expiry_offsets = array[90, 30, 1]
--    where user_id = auth.uid();
--   select expiry_offsets from public.tenure_alert_policies where user_id = auth.uid();
--
--   -- note metadata is stamped by the trigger, not by the caller:
--   select notes_updated_at, notes_updated_by from public.monitored_portfolio_tenures
--    where id = '<membership id>';
