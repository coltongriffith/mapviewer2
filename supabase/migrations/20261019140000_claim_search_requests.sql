-- Search requests: "tell us the project" under an empty claim search.
--
-- The table and its two admin functions were created on the database directly
-- and never committed; this records them as they stand in production, so that
-- part is a no-op there. Rows are written only by /api/track (service role)
-- and read in the admin Feedback tab.
--
-- New: the session timeline shows a request alongside the search before it,
-- as kind 'request'. The rest of admin_get_session_timeline is unchanged from
-- 20260824000001_session_timeline_product_events.sql, which is the rollback.

create table if not exists public.claim_search_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  query_text text not null,
  province text not null,
  mode text,
  session_id text,
  user_id uuid,
  note text,
  user_agent text,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

-- The same person asking for the same thing twice is one request.
create unique index if not exists claim_search_requests_unique_ask
  on public.claim_search_requests (lower(email), lower(query_text), province);
create index if not exists claim_search_requests_open_idx
  on public.claim_search_requests (created_at) where answered_at is null;

alter table public.claim_search_requests enable row level security;
revoke all on public.claim_search_requests from anon, authenticated;

create or replace function public.admin_get_claim_search_requests(p_open_only boolean default true, p_limit integer default 200)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'open_count', (select count(*) from public.claim_search_requests where answered_at is null),
    'items', coalesce((
      select jsonb_agg(row_to_json(r) order by r.created_at asc)
      from (
        select c.id, c.email, c.query_text, c.province, c.mode, c.note,
               c.session_id, c.created_at, c.answered_at
        from public.claim_search_requests c
        where (not coalesce(p_open_only, true) or c.answered_at is null)
        order by c.created_at asc
        limit greatest(1, least(coalesce(p_limit, 200), 1000))
      ) r
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

create or replace function public.admin_set_claim_request_answered(p_id uuid, p_answered boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.claim_search_requests
     set answered_at = case when coalesce(p_answered, true) then now() else null end
   where id = p_id
  returning jsonb_build_object('id', id, 'answered_at', answered_at) into result;
  if result is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return result;
end;
$function$;

revoke all on function public.admin_get_claim_search_requests(boolean, integer) from public, anon;
revoke all on function public.admin_set_claim_request_answered(uuid, boolean) from public, anon;
grant execute on function public.admin_get_claim_search_requests(boolean, integer) to authenticated;
grant execute on function public.admin_set_claim_request_answered(uuid, boolean) to authenticated;

create or replace function public.admin_get_session_timeline(p_session_id text)
returns table (event_time timestamptz, kind text, detail text)
language sql security definer stable
set search_path = public, pg_catalog as $$
  select pv.created_at, 'page_view'::text,
    coalesce(pv.path, '/') || coalesce(' via ' || nullif(pv.referrer, ''), '')
  from public.page_views pv where pv.session_id = p_session_id and is_admin()
  union all
  select se.created_at, 'search'::text,
    coalesce(se.kind, 'registry') || ' search · ' || coalesce(upper(se.province), '?')
      || ' · ' || coalesce(se.result_count::text, '0') || ' results'
      -- outcome distinguishes a genuine miss from a failed request; both carry
      -- result_count 0, so without it a broken province reads as an unpopular
      -- one (migration 20260805000001).
      || coalesce(' (' || nullif(se.outcome, 'ok') || ')', '')
  from public.search_events se where se.session_id = p_session_id and is_admin()
  union all
  select ee.created_at, 'export'::text,
    -- coalesce, not a bare concat: one null column would make the whole detail
    -- null and the row would render as a label with nothing after it.
    coalesce(upper(ee.format), '?') || ' export · ' || coalesce(ee.project_name, 'Untitled')
      || case when ee."noWatermark" then ' (no watermark)' else '' end
  from public.export_events ee where ee.session_id = p_session_id and is_admin()
  union all
  select l.captured_at, 'lead'::text, 'Email captured: ' || l.email
  from public.leads l where l.session_id = p_session_id and is_admin()
  union all
  select lc.created_at, 'click'::text, 'Clicked ' || coalesce(lc.element, '(unlabeled)')
  from public.landing_clicks lc where lc.session_id = p_session_id and is_admin()
  union all
  select pe.created_at, 'product'::text,
    replace(pe.event, '_', ' ')
      || coalesce(' · ' || nullif(left((
           -- props is small (2 KB cap, enforced in api/track.js) and free-form,
           -- so render it as key=value rather than naming keys this function
           -- would then have to keep in step with the event taxonomy.
           select string_agg(k || '=' || left(coalesce(v #>> '{}', ''), 40), ', ' order by k)
           from jsonb_each(case when jsonb_typeof(pe.props) = 'object'
                                then pe.props else '{}'::jsonb end) as p(k, v)
         ), 160), ''), '')
  from public.product_events pe where pe.session_id = p_session_id and is_admin()
  union all
  select r.created_at, 'request'::text,
    'Asked us to find "' || r.query_text || '" · ' || upper(r.province)
      || coalesce(' · ' || nullif(left(r.note, 120), ''), '')
  from public.claim_search_requests r where r.session_id = p_session_id and is_admin()
  order by 1 asc;
$$;

-- Same posture as every other admin RPC: reachable by signed-in users, gated
-- on is_admin() inside; never anon or public.
revoke all on function public.admin_get_session_timeline(text) from anon, public;
grant execute on function public.admin_get_session_timeline(text) to authenticated;
