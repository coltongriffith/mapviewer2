-- ============================================================
-- Give the 1-day reminder to the portfolios that already exist.
--
-- 20260807000001 added the offset to tenure_plan_limits(), which governs what
-- a policy is ALLOWED to hold. It does not change what any policy already
-- holds — and the alert scheduler reads the policy row, not the plan ladder.
--
-- So every portfolio created before that migration kept its old default
-- ([90, 30] on free, [90, 30, 7] on pro) and would silently never receive the
-- final reminder unless its owner happened to open the settings screen and
-- tick a box they have no reason to know appeared. "The 1-day reminder is on
-- every plan" would have been true of the entitlement and false of every
-- existing customer, which is the worst version of a claim like that.
--
-- WHAT THIS TOUCHES, AND WHAT IT DELIBERATELY DOES NOT
--
-- Only policies whose offsets are EXACTLY one of the two previous defaults.
-- Those rows are the ones nobody chose: the value was written by
-- create_monitored_portfolio and never edited, and the 1-day rung did not
-- exist to be declined.
--
-- A customised set is left alone. Somebody who opened the settings screen and
-- picked their thresholds made a decision, and quietly adding a reminder they
-- did not select would be editing a customer's notification preferences on
-- their behalf. They can tick it themselves — it is visible and unlocked on
-- every plan now.
--
-- SAFETY: tenure_policy_offsets_guard returns early when auth.uid() is null
-- (20260801000008, lines 61-63), so a migration-time UPDATE is not re-filtered
-- against the anonymous plan shape. Without that early return this statement
-- would have intersected against an empty ladder and reset every policy to
-- [90, 30] — destroying the 7-day reminder it was meant to extend.
--
-- Rollback:
--   update public.tenure_alert_policies
--      set expiry_offsets = array[90, 30]    where expiry_offsets = array[90, 30, 1];
--   update public.tenure_alert_policies
--      set expiry_offsets = array[90, 30, 7] where expiry_offsets = array[90, 30, 7, 1];
--   alter table public.tenure_alert_policies
--     alter column expiry_offsets set default array[90, 30];
-- ============================================================

update public.tenure_alert_policies
   set expiry_offsets = array[90, 30, 1],
       updated_at = now()
 where expiry_offsets = array[90, 30];

update public.tenure_alert_policies
   set expiry_offsets = array[90, 30, 7, 1],
       updated_at = now()
 where expiry_offsets = array[90, 30, 7];

-- The column default is the last line of defence for any insert path that does
-- not name the column. create_monitored_portfolio computes its offsets from
-- tenure_plan_limits() and so already picks the new ladder up, but a default
-- that disagrees with the plan matrix is a trap for the next writer.
alter table public.tenure_alert_policies
  alter column expiry_offsets set default array[90, 30, 1];

-- ── Verification ───────────────────────────────────────────────────────────
--   -- every policy still on an old default (expect 0):
--   select count(*) from public.tenure_alert_policies
--    where expiry_offsets in (array[90, 30], array[90, 30, 7]);
--
--   -- what policies now hold:
--   select expiry_offsets, count(*) from public.tenure_alert_policies group by 1;
--
--   -- the scheduler will pick these up on its next run; no alert rows are
--   -- written here, because planExpiryAlerts is what decides which thresholds
--   -- are still in the future for each claim.
