-- admin_session_ids is an internal helper, not an endpoint. Stop granting it
-- to signed-in users.
--
-- It is `security definer` and was granted to `authenticated` with no
-- is_admin() gate, so any signed-in customer could call it over PostgREST and
-- read back the session identifiers of ADMIN users for any window they chose.
--
-- Lower severity than a leak of customer analytics — a session_id is a
-- client-generated correlation string, not a credential, so knowing one grants
-- nothing. But it does disclose when administrators were active, and it is the
-- same shape of mistake as the one that prompted this pass: definer rights plus
-- a broad grant and nothing checking who is asking.
--
-- Found by sweeping every admin_ RPC for that combination rather than only
-- fixing the one that was reported.
--
-- The grant was never needed. Every caller is another security-definer RPC in
-- the same migration (admin_get_overview, admin_get_funnel, and friends), and
-- those already gate on is_admin(). Inside a definer function the EXECUTE check
-- runs as the function's owner, not as the signed-in user, so removing the
-- `authenticated` grant does not affect them.
--
-- Revoking is preferred over adding an is_admin() gate here: the gate would be
-- redundant for the real callers and would make the helper silently return
-- nothing if it were ever reused from a non-admin context, which is a harder
-- failure to notice than a permission error.
--
-- Rollback:
--   grant execute on function public.admin_session_ids(timestamptz,timestamptz)
--     to authenticated;

revoke execute on function public.admin_session_ids(timestamptz, timestamptz)
  from authenticated, anon, public;

-- service_role keeps it: server-side jobs run as that role and bypass the
-- client entirely.
grant execute on function public.admin_session_ids(timestamptz, timestamptz)
  to service_role;

-- Verification:
--   select has_function_privilege('authenticated',
--     'public.admin_session_ids(timestamptz,timestamptz)', 'execute');
--   -- expect false
--
--   -- and the dashboard RPCs that USE it still work for an admin:
--   select jsonb_typeof(public.admin_get_overview(now() - interval '30 days', now()));
--   -- expect 'object' when called by an admin
