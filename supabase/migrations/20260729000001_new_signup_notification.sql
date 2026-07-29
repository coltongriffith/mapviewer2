-- Notify the site owner by email the moment a new account is created.
-- Fires from a trigger on auth.users rather than app code, so it can never
-- be skipped by a client-side bug and never blocks signup even if the
-- notification itself fails (network error, bad key, etc. are all caught).

create extension if not exists pg_net;

-- The API key lives in Vault (see: select vault.create_secret(...)), not in
-- this function body or any table, so it never appears in a migration file,
-- a dashboard SQL editor history, or a pg_dump.
create or replace function public.send_signup_notification(
  p_user_email text,
  p_user_id uuid,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_api_key text;
begin
  select decrypted_secret into v_api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;

  if v_api_key is null then
    return; -- not configured yet — never raise, never block signup
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'Exploration Maps <notifications@explorationmaps.com>',
      'to', 'coltongriffith@live.ca',
      'subject', 'New signup: ' || coalesce(p_user_email, p_user_id::text),
      'html', '<p>New account created on explorationmaps.com.</p>'
        || '<p><strong>Email:</strong> ' || coalesce(p_user_email, '(none)') || '</p>'
        || '<p><strong>User ID:</strong> ' || p_user_id || '</p>'
        || '<p><strong>Signed up:</strong> ' || p_created_at || '</p>'
    )
  );
exception when others then
  -- A Resend outage or bad key must never fail a real user's signup.
  return;
end;
$$;

create or replace function public.on_auth_user_created_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.send_signup_notification(new.email, new.id, new.created_at);
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_notify on auth.users;
create trigger on_auth_user_created_notify
  after insert on auth.users
  for each row execute function public.on_auth_user_created_notify();
