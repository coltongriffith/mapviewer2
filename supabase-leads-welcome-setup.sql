-- ============================================================
-- Exploration Maps -- Lead welcome email + conversion tracking
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- Pairs with the send-welcome edge function.
-- ============================================================

-- Dedupe marker: set by send-welcome after a welcome email goes out, so a
-- returning exporter isn't emailed twice.
alter table leads add column if not exists welcomed_at timestamptz;

-- Which captured leads became registered accounts. Admin/service-role reporting
-- only (reads auth.users) — surfaces the leads -> signup conversion the funnel
-- previously couldn't join. Query with the service role or from the admin
-- dashboard; not exposed to anon.
create or replace view leads_conversion
with (security_invoker = true) as
  select
    l.email,
    min(l.captured_at)                          as first_captured,
    bool_or(l.welcomed_at is not null)          as welcomed,
    (max(u.id::text) is not null)               as became_user,
    max(u.created_at)                           as signed_up_at
  from leads l
  left join auth.users u on lower(u.email) = l.email
  group by l.email;
