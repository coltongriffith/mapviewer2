-- Fix admin_get_overview, which errors on every call.
--
--   ERROR 42803: column "f.event_time" must appear in the GROUP BY clause
--                or be used in an aggregate function
--
-- The 'feed' key selects an aggregate over a derived table, then puts ORDER BY
-- and LIMIT on the OUTER query:
--
--   select coalesce(jsonb_agg(row_to_json(f)::jsonb order by f.event_time desc), '[]')
--   from ( ...unions... ) f
--   order by f.event_time desc     -- invalid: not grouped, and the select list
--   limit 50                       -- is an aggregate, so this limits 1 row
--
-- Two bugs in three lines. The ORDER BY is a grouping error, so the whole
-- function fails at plan time — it is not data-dependent, and the admin
-- Overview tab has been broken for every call since. And the LIMIT never did
-- what its comment claims: the outer query returns exactly one row (the
-- aggregate), so "LIMIT 50" limited nothing. The feed would have carried every
-- matching event, not the newest 50.
--
-- Both are fixed by moving ORDER BY and LIMIT INSIDE the derived table, where
-- they select the 50 most recent rows before aggregation. The ordering of the
-- array itself is already handled by the `order by` inside jsonb_agg.
--
-- This rewrites the DEPLOYED definition rather than restating the function.
-- It is ~200 lines of plpgsql and only three of them are wrong; retyping the
-- rest into a migration invites a transcription error in code nobody would
-- re-read. The block fails loudly if the fragment is absent or if the
-- substitution changes nothing, so it can never silently no-op — on a fresh
-- database it finds the same text from 20260713000001 and applies the same fix.
--
-- Rollback: re-apply 20260713000001_admin_dashboard_v2.sql (restores the bug).

do $$
declare
  def text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_get_overview';

  if def is null then
    raise exception 'admin_get_overview not found — nothing to patch';
  end if;

  -- Whitespace-tolerant: the stored body carries CRLF line endings.
  patched := regexp_replace(
    def,
    '\)\s*f\s*order by f\.event_time desc\s*limit 50',
    '  order by 1 desc' || chr(10) || '  limit 50' || chr(10) || ') f'
  );

  if patched = def then
    raise exception
      'admin_get_overview feed ordering not found — refusing to guess. '
      'Inspect pg_get_functiondef and patch by hand.';
  end if;

  execute patched;
end $$;

-- Verification (as an admin — the function gates on is_admin()):
--   select jsonb_typeof(public.admin_get_overview(now() - interval '30 days', now()));
--   -- expect 'object', where it previously raised 42803
--
--   select jsonb_array_length(
--     public.admin_get_overview(now() - interval '90 days', now()) -> 'feed');
--   -- expect <= 50
