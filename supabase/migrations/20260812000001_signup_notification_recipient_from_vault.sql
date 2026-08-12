-- Move the signup-notification recipient out of the function body and into Vault.
--
-- 20260729000001 hardcoded a personal email address as the destination. Two
-- problems with that, and editing the old migration fixes only the first:
--
--   1. The address lives in the repository, permanently, in every clone.
--   2. The address ALSO lives in the deployed function body, because that
--      migration has already run. A file edit does not change a database.
--
-- This migration is the second half: it redefines the live function so the
-- destination is read from Vault, alongside the API key that is already kept
-- there. Nothing personal remains in the source or in the database.
--
-- Set the destination with:
--   select vault.create_secret('you@yourdomain.com', 'signup_notification_to');
-- and change it later with:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'signup_notification_to'),
--     'someone-else@yourdomain.com');
--
-- If the secret is absent it falls back to support@explorationmaps.com, which
-- is the address the site already publishes on its terms, refunds and 404
-- pages. VERIFY THAT ADDRESS ACTUALLY RECEIVES MAIL before relying on it: the
-- Resend domain has sending enabled but receiving disabled, so unless MX
-- records point at a real mailbox, signup notifications would go nowhere. The
-- failure would be silent, because this function deliberately never raises.
--
-- Rollback: restore the previous body from 20260729000001 (with a literal
-- recipient), or simply set the Vault secret — no schema changes here.

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
  v_to text;
begin
  select decrypted_secret into v_api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;

  if v_api_key is null then
    return; -- not configured yet — never raise, never block signup
  end if;

  select decrypted_secret into v_to
  from vault.decrypted_secrets
  where name = 'signup_notification_to'
  limit 1;

  -- A missing secret must not mean a missing notification.
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
      'subject', 'New signup: ' || coalesce(p_user_email, p_user_id::text),
      'html', '<p>New account created on explorationmaps.com.</p>'
        || '<p><strong>Email:</strong> ' || coalesce(p_user_email, '(none)') || '</p>'
        || '<p><strong>User ID:</strong> ' || p_user_id || '</p>'
        || '<p><strong>Signed up:</strong> ' || p_created_at || '</p>'
    )
  );
exception when others then
  -- A Resend outage, a bad key or a missing secret must never fail a real
  -- user's signup.
  return;
end;
$$;

-- Verification:
--   select prosrc like '%signup_notification_to%' as reads_vault
--   from pg_proc where proname = 'send_signup_notification';
--   -- expect: true, and no email address literal other than the fallback.
