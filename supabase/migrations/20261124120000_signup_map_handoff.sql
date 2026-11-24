-- Carry an anonymous visitor's map across the sign-in email.
--
-- The editor keeps an anonymous map only in this browser's localStorage. When
-- the sign-in link opens in a different browser (a work mail client handing
-- links to its default browser is the usual case), the account starts empty
-- and the map the visitor built is gone. Telemetry, 24 Nov 2026: a visitor
-- mapped a B.C. claim, exported it, signed up from the export gate, and twice
-- landed in an empty editor; their account has no maps.
--
-- So the editor stashes the map server-side when it sends the link, puts the
-- token in the link, and the signed-in editor claims it. A token is only
-- redeemable by the account whose email it was sent to, once, within 7 days.

create table if not exists public.signup_handoffs (
  token        uuid primary key default gen_random_uuid(),
  email        text not null,
  payload      jsonb not null,
  project_name text,
  extras       jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists signup_handoffs_email_idx on public.signup_handoffs (lower(email));
create index if not exists signup_handoffs_created_idx on public.signup_handoffs (created_at);

-- No client reads or writes the table directly: only the two functions below.
alter table public.signup_handoffs enable row level security;
revoke all on table public.signup_handoffs from anon, authenticated;

create or replace function public.stash_signup_handoff(
  p_email text, p_payload jsonb, p_project_name text default null, p_extras jsonb default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid map'; end if;
  -- A map, not a dump: 2 MB of JSON is far past any registry-search map.
  if octet_length(p_payload::text) > 2000000 then raise exception 'map too large to carry over'; end if;
  if p_extras is not null and octet_length(p_extras::text) > 2000 then raise exception 'invalid extras'; end if;

  delete from public.signup_handoffs where created_at < now() - interval '7 days';
  -- Anonymous callers can reach this; bound what they can store. Earlier
  -- links stay valid (no replace-by-email), so nobody can void someone
  -- else's pending map by stashing one under their address.
  if (select count(*) from public.signup_handoffs
       where lower(email) = v_email and created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.signup_handoffs where created_at > now() - interval '1 hour') >= 500 then
    raise exception 'try again later';
  end if;

  insert into public.signup_handoffs (email, payload, project_name, extras)
  values (v_email, p_payload, left(p_project_name, 200), p_extras)
  returning token into v_token;
  return v_token;
end;
$$;

create or replace function public.claim_signup_handoff(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row public.signup_handoffs;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or v_email = '' then return null; end if;
  -- Claimed maps are not kept: the account copy is the record from here on.
  delete from public.signup_handoffs
   where token = p_token
     and lower(email) = v_email
     and created_at > now() - interval '7 days'
  returning * into v_row;
  if v_row.token is null then return null; end if;
  return jsonb_build_object('payload', v_row.payload, 'project_name', v_row.project_name, 'extras', v_row.extras);
end;
$$;

revoke all on function public.stash_signup_handoff(text, jsonb, text, jsonb) from public;
revoke all on function public.claim_signup_handoff(uuid) from public;
grant execute on function public.stash_signup_handoff(text, jsonb, text, jsonb) to anon, authenticated;
grant execute on function public.claim_signup_handoff(uuid) to authenticated;
