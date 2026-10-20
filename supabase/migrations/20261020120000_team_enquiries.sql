-- Exploration Maps for Teams (/teams): the enquiry form.
--
-- Rows are written only by /api/track (service role, kind 'team_enquiry') and
-- read in Admin → Feedback. Optional data/sample files go to the private
-- storage bucket 'team-enquiries' under <enquiry id>/, uploaded straight from
-- the browser with a signed upload URL the API issues; admins download them
-- with a signed URL. Each new enquiry emails the owner, like feedback does
-- (20260910000001_user_feedback.sql), from the same vault secrets.

create table if not exists public.team_enquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text not null,
  company text not null,
  projects text,
  materials text[] not null default '{}',
  service_level text,
  deadline date,
  deadline_note text,
  message text,
  -- [{ name, size, type, path }] as declared by the form; the objects
  -- themselves live in storage under path.
  files jsonb not null default '[]'::jsonb,
  ref text,
  session_id text,
  user_agent text,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  status_at timestamptz
);

create index if not exists team_enquiries_open_idx
  on public.team_enquiries (created_at) where status <> 'closed';

alter table public.team_enquiries enable row level security;
revoke all on public.team_enquiries from anon, authenticated;

-- ── Uploaded data ───────────────────────────────────────────────────────────
-- Private. 50 MB a file; the form allows five.
insert into storage.buckets (id, name, public, file_size_limit)
values ('team-enquiries', 'team-enquiries', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Admins read team enquiry files') then
    create policy "Admins read team enquiry files" on storage.objects
      for select to authenticated
      using (bucket_id = 'team-enquiries' and public.is_admin());
  end if;
end $$;

-- ── Owner email ─────────────────────────────────────────────────────────────
create or replace function public.send_team_enquiry_notification(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api_key text;
  v_to text;
  e public.team_enquiries;
begin
  select decrypted_secret into v_api_key
  from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if v_api_key is null then
    return;
  end if;
  select * into e from public.team_enquiries where id = p_id;
  if e.id is null then
    return;
  end if;

  select decrypted_secret into v_to
  from vault.decrypted_secrets where name = 'feedback_notification_to' limit 1;
  if nullif(trim(v_to), '') is null then
    select decrypted_secret into v_to
    from vault.decrypted_secrets where name = 'signup_notification_to' limit 1;
  end if;
  v_to := coalesce(nullif(trim(v_to), ''), 'support@explorationmaps.com');

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'Exploration Maps <notifications@explorationmaps.com>',
      'to', v_to,
      'reply_to', e.email,
      'subject', '[Teams] ' || left(e.company, 80) || coalesce(' · ' || left(nullif(e.projects, ''), 60), ''),
      'text', 'From: ' || coalesce(nullif(e.name, '') || ' <' || e.email || '>', e.email) || E'\n'
        || 'Company: ' || e.company || E'\n'
        || 'Projects: ' || coalesce(nullif(e.projects, ''), '—') || E'\n'
        || 'Needs: ' || coalesce(nullif(array_to_string(e.materials, ', '), ''), '—') || E'\n'
        || 'Service level: ' || coalesce(nullif(e.service_level, ''), 'not sure') || E'\n'
        || 'Deadline: ' || coalesce(e.deadline::text, '—') || coalesce(' (' || nullif(e.deadline_note, '') || ')', '') || E'\n'
        || 'Files: ' || jsonb_array_length(e.files) || E'\n'
        || 'Came from: ' || coalesce(nullif(e.ref, ''), 'direct') || E'\n\n'
        || coalesce(e.message, '') || E'\n\n'
        || 'Reply to this email to answer. Files and status are in Admin → Feedback.'
    )
  );
exception when others then
  return;
end;
$$;

revoke all on function public.send_team_enquiry_notification(uuid) from public, anon, authenticated;

create or replace function public.on_team_enquiry_created_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.send_team_enquiry_notification(new.id);
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.on_team_enquiry_created_notify() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'on_team_enquiry_created_notify'
                 and tgrelid = 'public.team_enquiries'::regclass) then
    create trigger on_team_enquiry_created_notify
      after insert on public.team_enquiries
      for each row execute function public.on_team_enquiry_created_notify();
  end if;
end $$;

-- ── Admin ───────────────────────────────────────────────────────────────────
-- Shape is what src/components/admin/TeamEnquiriesCard.jsx renders:
--   { open_count, items: [{ id, created_at, name, email, company, projects,
--     materials, service_level, deadline, deadline_note, message, files, ref,
--     status, status_at }] }
create or replace function public.admin_get_team_enquiries(p_open_only boolean default true, p_limit integer default 200)
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
    'open_count', (select count(*) from public.team_enquiries where status <> 'closed'),
    'items', coalesce((
      select jsonb_agg(row_to_json(r) order by r.created_at desc)
      from (
        select t.id, t.created_at, t.name, t.email, t.company, t.projects, t.materials,
               t.service_level, t.deadline, t.deadline_note, t.message, t.files, t.ref,
               t.status, t.status_at
        from public.team_enquiries t
        where (not coalesce(p_open_only, true) or t.status <> 'closed')
        order by t.created_at desc
        limit greatest(1, least(coalesce(p_limit, 200), 1000))
      ) r
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

create or replace function public.admin_set_team_enquiry_status(p_id uuid, p_status text)
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
  if p_status not in ('new', 'contacted', 'closed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.team_enquiries
     set status = p_status, status_at = now()
   where id = p_id
  returning jsonb_build_object('id', id, 'status', status, 'status_at', status_at) into result;
  if result is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return result;
end;
$function$;

revoke all on function public.admin_get_team_enquiries(boolean, integer) from public, anon;
revoke all on function public.admin_set_team_enquiry_status(uuid, text) from public, anon;
grant execute on function public.admin_get_team_enquiries(boolean, integer) to authenticated;
grant execute on function public.admin_set_team_enquiry_status(uuid, text) to authenticated;

-- ── Session timeline ────────────────────────────────────────────────────────
-- An enquiry shows in the visitor's session as kind 'request', next to the
-- pages they read before sending it. Otherwise unchanged from
-- 20261019140000_claim_search_requests.sql, which is the rollback.
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
  union all
  select t.created_at, 'request'::text,
    'Teams enquiry · ' || t.company
      || coalesce(' · ' || nullif(array_to_string(t.materials, ', '), ''), '')
  from public.team_enquiries t where t.session_id = p_session_id and is_admin()
  order by 1 asc;
$$;

-- Same posture as every other admin RPC: reachable by signed-in users, gated
-- on is_admin() inside; never anon or public.
revoke all on function public.admin_get_session_timeline(text) from anon, public;
grant execute on function public.admin_get_session_timeline(text) to authenticated;
