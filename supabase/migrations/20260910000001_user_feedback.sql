-- In-app feedback and issue reports.
--
-- error_events (20260729000003) records what the code saw. It says nothing
-- about what the USER saw: a broken export they gave up on, a confusing
-- import, a feature they wanted. The only channel for that was them finding
-- the support address on the terms page. This adds a first-party one: a
-- "Send feedback" form in the app, reachable from the sidebar and from the
-- crash screen, that lands here and emails the owner.
--
-- Written by api/feedback.js (service role); read from Admin → Feedback via
-- admin_get_feedback; triaged with admin_set_feedback_status.
--
-- Everything is idempotent.

create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  kind         text not null check (kind in ('bug', 'feedback', 'idea')),
  message      text not null check (char_length(message) between 1 and 4000),
  -- Contact address a signed-out user chose to leave. Signed-in users are
  -- identified by user_id and this stays null.
  email        text check (email is null or char_length(email) <= 200),
  path         text,
  release      text,
  session_id   text,
  user_id      uuid references auth.users (id) on delete set null,
  user_agent   text,
  -- Diagnostics captured at submit time: the last few client errors, viewport,
  -- the crash message when sent from the error boundary. Never user-typed.
  context      jsonb,
  status       text not null default 'new' check (status in ('new', 'acknowledged', 'resolved')),
  status_at    timestamptz
);

create index if not exists feedback_recent_idx on public.feedback (created_at desc);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);

-- Service-role writes only, same posture as error_events.
alter table public.feedback enable row level security;
revoke all on table public.feedback from public, anon, authenticated;
grant all on table public.feedback to service_role;

-- ── Owner notification ──────────────────────────────────────────────────────
-- Same mechanism as the signup email (20260729000001 / 20260812000001): the
-- Resend key and the recipient (feedback_notification_to) live in Vault, and the trigger swallows every
-- failure so a Resend outage can never lose a report — the row is the record,
-- the email is the nudge. pg_net is already installed by 20260729000001.
create or replace function public.send_feedback_notification(
  p_id uuid,
  p_kind text,
  p_message text,
  p_email text,
  p_path text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api_key text;
  v_to text;
  v_from_user text;
begin
  select decrypted_secret into v_api_key
  from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if v_api_key is null then
    return;
  end if;

  -- Dedicated recipient first (set with
  --   select vault.create_secret('you@yourdomain.com', 'feedback_notification_to');
  -- ), then the signup-notification recipient, then the published support
  -- address. Never a personal address in this file.
  select decrypted_secret into v_to
  from vault.decrypted_secrets where name = 'feedback_notification_to' limit 1;
  if nullif(trim(v_to), '') is null then
    select decrypted_secret into v_to
    from vault.decrypted_secrets where name = 'signup_notification_to' limit 1;
  end if;
  v_to := coalesce(nullif(trim(v_to), ''), 'support@explorationmaps.com');

  if p_user_id is not null then
    select email into v_from_user from auth.users where id = p_user_id;
  end if;
  v_from_user := coalesce(v_from_user, p_email, 'anonymous');

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'Exploration Maps <notifications@explorationmaps.com>',
      'to', v_to,
      'reply_to', case when v_from_user like '%@%' then v_from_user else null end,
      'subject', '[' || p_kind || '] ' || left(regexp_replace(p_message, E'[\\r\\n]+', ' ', 'g'), 80),
      'text', 'From: ' || v_from_user || E'\n'
        || 'Kind: ' || p_kind || E'\n'
        || 'Page: ' || coalesce(p_path, '(unknown)') || E'\n'
        || 'Report: ' || p_id || E'\n\n'
        || p_message || E'\n\n'
        || 'Triage it in Admin → Feedback.'
    )
  );
exception when others then
  return;
end;
$$;

revoke all on function public.send_feedback_notification(uuid, text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.on_feedback_created_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.send_feedback_notification(new.id, new.kind, new.message, new.email, new.path, new.user_id);
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.on_feedback_created_notify() from public, anon, authenticated;

drop trigger if exists on_feedback_created_notify on public.feedback;
create trigger on_feedback_created_notify
  after insert on public.feedback
  for each row execute function public.on_feedback_created_notify();

-- ── Admin read ──────────────────────────────────────────────────────────────
-- Newest p_limit reports, optionally filtered by status. Shape is what
-- src/components/admin/FeedbackTab.jsx renders:
--   { open_count, items: [{ id, created_at, kind, message, email, path,
--                           release, user_id, user_email, context, status }] }
create or replace function public.admin_get_feedback(p_status text default null, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'open_count', (select count(*) from public.feedback where status = 'new'),
    'items', (
      select coalesce(jsonb_agg(i), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', f.id,
          'created_at', f.created_at,
          'kind', f.kind,
          'message', f.message,
          'email', f.email,
          'path', f.path,
          'release', f.release,
          'session_id', f.session_id,
          'user_id', f.user_id,
          'user_email', u.email,
          'user_agent', f.user_agent,
          'context', f.context,
          'status', f.status,
          'status_at', f.status_at
        ) as i
        from public.feedback f
        left join auth.users u on u.id = f.user_id
        where p_status is null or f.status = p_status
        order by f.created_at desc
        limit greatest(1, least(coalesce(p_limit, 100), 500))
      ) s
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_get_feedback(text, integer) from public, anon, authenticated;
grant execute on function public.admin_get_feedback(text, integer) to authenticated;

-- ── Admin triage ────────────────────────────────────────────────────────────
create or replace function public.admin_set_feedback_status(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('new', 'acknowledged', 'resolved') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.feedback
     set status = p_status,
         status_at = case when p_status = 'new' then null else now() end
   where id = p_id
  returning jsonb_build_object('id', id, 'status', status, 'status_at', status_at) into result;
  if result is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

revoke all on function public.admin_set_feedback_status(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_feedback_status(uuid, text) to authenticated;

-- Rollback:
--   drop trigger if exists on_feedback_created_notify on public.feedback;
--   drop function if exists public.on_feedback_created_notify();
--   drop function if exists public.send_feedback_notification(uuid, text, text, text, text, uuid);
--   drop function if exists public.admin_set_feedback_status(uuid, text);
--   drop function if exists public.admin_get_feedback(text, integer);
--   drop table if exists public.feedback;
