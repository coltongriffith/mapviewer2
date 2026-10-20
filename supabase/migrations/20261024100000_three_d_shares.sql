-- Exploration Maps 3D (/3d): public read-only share links.
--
-- A share is a snapshot of a figure, EM3D.getProject() ({ v: 1, settings,
-- camera, files: [{ name, text, role, cols }] }), plus a small JPEG
-- thumbnail, behind an unguessable id (32 hex characters from
-- gen_random_uuid(), the same scheme as shared_maps). The link is
-- https://www.explorationmaps.com/3d/share/<id>, and /3d/embed/<id> for an
-- iframe.
--
-- Mirrors the 2D shared_maps rules (20260728000004_shared_maps_bounds.sql and
-- later):
--   * no direct table access for anon or authenticated: create, read, list,
--     update and revoke go through SECURITY DEFINER RPCs with search_path '',
--   * a size cap (8 MB of JSON text; SHARE_TOO_LARGE) and a shape check
--     (SHARE_INVALID),
--   * a rate limit per signed-in user and per anonymous browser key
--     (SHARE_RATE_LIMIT), plus a ceiling on all anonymous shares per hour so
--     a client rotating its browser key cannot fill the table,
--   * anonymous shares expire after 30 days; shares owned by an account do
--     not expire and can be revoked at any time,
--   * revoking clears the stored figure as well as flagging it,
--   * view_count is bumped at most once a minute per share.
--
-- Ownership: a share made while signed in belongs to that user (user_id). A
-- share made signed out belongs to the browser that made it (creator_key, an
-- opaque random key kept in that browser's localStorage, never returned to
-- viewers). Owners can list, update ("refresh this link with the current
-- figure", e.g. after new assays) and revoke their shares.
--
-- Idempotent: guarded DO blocks, no DROP statements.
--
-- Rollback (manual):
--   drop function if exists public.create_3d_share(jsonb, text, uuid, text);
--   drop function if exists public.get_3d_share(text);
--   drop function if exists public.list_my_3d_shares(text);
--   drop function if exists public.update_3d_share(text, jsonb, text, text);
--   drop function if exists public.revoke_3d_share(text, text);
--   drop table if exists public.three_d_shares;

create table if not exists public.three_d_shares (
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  thumbnail text check (thumbnail is null or char_length(thumbnail) <= 300000),
  user_id uuid references auth.users (id) on delete cascade,
  creator_key text check (creator_key is null or char_length(creator_key) between 16 and 100),
  project_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  -- Per-share update throttle (one window an hour).
  update_window_start timestamptz,
  update_count integer not null default 0
);

-- The figure a share was made from. A deleted project leaves its links alone.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'three_d_shares_project_id_fkey'
                 and conrelid = 'public.three_d_shares'::regclass) then
    alter table public.three_d_shares
      add constraint three_d_shares_project_id_fkey
      foreign key (project_id) references public.three_d_projects (id) on delete set null;
  end if;
end $$;

create index if not exists three_d_shares_user_idx on public.three_d_shares (user_id, created_at desc);
create index if not exists three_d_shares_creator_idx on public.three_d_shares (creator_key, created_at desc);
create index if not exists three_d_shares_anon_created_idx on public.three_d_shares (created_at desc) where user_id is null;

-- Locked: RLS on with no policies, and no table privileges for the API roles.
alter table public.three_d_shares enable row level security;
revoke all on public.three_d_shares from public, anon, authenticated;

-- ── Shared checks ───────────────────────────────────────────────────────────
-- Shape and size of a snapshot. Raises SHARE_INVALID / SHARE_TOO_LARGE.
create or replace function public.three_d_share_check(p_state jsonb, p_thumbnail text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bytes bigint;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object'
     or p_state->'v' is distinct from '1'::jsonb
     or jsonb_typeof(p_state->'settings') is distinct from 'object'
     or jsonb_typeof(p_state->'files') is distinct from 'array' then
    raise exception 'SHARE_INVALID: share payload is not a 3D figure ({ v: 1, settings, files })' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_state->'files') > 100 then
    raise exception 'SHARE_INVALID: a shared figure can carry at most 100 files' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_state->'files') f
             where jsonb_typeof(f) <> 'object'
                or jsonb_typeof(f->'name') is distinct from 'string'
                or jsonb_typeof(f->'text') is distinct from 'string'
                or char_length(f->>'name') > 300) then
    raise exception 'SHARE_INVALID: each file needs a name and its text' using errcode = 'P0001';
  end if;
  -- The figure is public and loaded whole by anyone with the link, so this is
  -- the most expensive row an unauthenticated caller can create.
  v_bytes := octet_length(p_state::text);
  if v_bytes > 8 * 1024 * 1024 then
    raise exception 'SHARE_TOO_LARGE: share payload is % KB, limit is 8192 KB', v_bytes / 1024 using errcode = 'P0001';
  end if;
  if p_thumbnail is not null and (char_length(p_thumbnail) > 300000
     or p_thumbnail !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then
    raise exception 'SHARE_INVALID: the thumbnail must be a small JPEG, PNG or WebP data URL' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.three_d_share_check(jsonb, text) from public, anon, authenticated;

-- May the caller manage this share? Signed-in owners by user_id; shares made
-- signed out by the browser key that made them.
create or replace function public.three_d_share_owned(p_user uuid, p_creator_key text, p_row_user uuid, p_row_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_row_user is not null then p_user is not null and p_row_user = p_user
    else p_row_key is not null and p_creator_key is not null
         and char_length(p_creator_key) >= 16 and p_row_key = p_creator_key
  end;
$$;

revoke all on function public.three_d_share_owned(uuid, text, uuid, text) from public, anon, authenticated;

-- ── Create ──────────────────────────────────────────────────────────────────
create or replace function public.create_3d_share(
  p_state jsonb,
  p_creator_key text,
  p_project_id uuid default null,
  p_thumbnail text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id text;
  v_recent int;
begin
  perform public.three_d_share_check(p_state, p_thumbnail);

  if p_project_id is not null and (v_user is null or not exists (
      select 1 from public.three_d_projects p
      where p.id = p_project_id and p.user_id = v_user and p.deleted_at is null)) then
    raise exception 'SHARE_INVALID: that 3D map is not in your account' using errcode = 'P0001';
  end if;

  -- Rate limits, counted from the rows themselves as for 2D shares.
  if v_user is not null then
    select count(*) into v_recent from public.three_d_shares s
      where s.user_id = v_user and s.created_at > now() - interval '1 hour';
    if v_recent >= 30 then
      raise exception 'SHARE_RATE_LIMIT: too many shares created recently' using errcode = 'P0001';
    end if;
  else
    if p_creator_key is null or char_length(p_creator_key) < 16 or char_length(p_creator_key) > 100 then
      raise exception 'SHARE_INVALID: missing creator key' using errcode = 'P0001';
    end if;
    select count(*) into v_recent from public.three_d_shares s
      where s.creator_key = p_creator_key and s.created_at > now() - interval '1 hour';
    if v_recent >= 10 then
      raise exception 'SHARE_RATE_LIMIT: too many shares created recently' using errcode = 'P0001';
    end if;
    -- A browser key is chosen by the client, so also cap anonymous shares as a whole.
    select count(*) into v_recent from public.three_d_shares s
      where s.user_id is null and s.created_at > now() - interval '1 hour';
    if v_recent >= 300 then
      raise exception 'SHARE_RATE_LIMIT: too many anonymous shares created recently; sign in to share' using errcode = 'P0001';
    end if;
  end if;

  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into public.three_d_shares (id, state, thumbnail, user_id, creator_key, project_id, expires_at)
  values (
    v_id, p_state, p_thumbnail, v_user,
    case when v_user is null then p_creator_key else null end,
    p_project_id,
    -- Anonymous shares always expire; owned shares persist until revoked.
    case when v_user is null then now() + interval '30 days' else null end
  );

  return v_id;
end;
$$;

revoke all on function public.create_3d_share(jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_3d_share(jsonb, text, uuid, text) to anon, authenticated;

-- ── Read (anyone with the id) ───────────────────────────────────────────────
-- Only the figure and its thumbnail: never the owner, browser key or counts.
-- Null for an unknown, revoked or expired id.
create or replace function public.get_3d_share(share_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_thumb text;
  v_last timestamptz;
begin
  if share_id is null or share_id !~ '^[0-9a-f]{32}$' then
    return null;
  end if;

  select s.state, s.thumbnail, s.last_viewed_at into v_state, v_thumb, v_last
  from public.three_d_shares s
  where s.id = share_id
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now());

  if v_state is null then
    return null;
  end if;

  if v_last is null or v_last < now() - interval '1 minute' then
    update public.three_d_shares
       set view_count = view_count + 1, last_viewed_at = now()
     where id = share_id;
  end if;

  return jsonb_build_object('state', v_state, 'thumbnail', v_thumb);
end;
$$;

revoke all on function public.get_3d_share(text) from public, anon, authenticated;
grant execute on function public.get_3d_share(text) to anon, authenticated;

-- ── Owner: list ─────────────────────────────────────────────────────────────
create or replace function public.list_my_3d_shares(p_creator_key text default null)
returns table (id text, project_id uuid, title text, created_at timestamptz, updated_at timestamptz,
               expires_at timestamptz, revoked_at timestamptz, view_count integer, anonymous boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.project_id,
         nullif(left(coalesce(s.state->'settings'->>'title', ''), 200), ''),
         s.created_at, s.updated_at, s.expires_at, s.revoked_at, s.view_count, s.user_id is null
  from public.three_d_shares s
  -- Same rule as three_d_share_owned, spelled out so both indexes can be used.
  where s.user_id = auth.uid()
     or (s.user_id is null and char_length(p_creator_key) >= 16 and s.creator_key = p_creator_key)
  order by s.created_at desc
  limit 200;
$$;

revoke all on function public.list_my_3d_shares(text) from public, anon, authenticated;
grant execute on function public.list_my_3d_shares(text) to anon, authenticated;

-- ── Owner: update the figure behind a link ──────────────────────────────────
-- Keeps the id (the link people already have). An anonymous share keeps its
-- original expiry. At most 30 updates per share per hour.
create or replace function public.update_3d_share(share_id text, p_state jsonb, p_thumbnail text default null,
                                                  p_creator_key text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.three_d_shares%rowtype;
begin
  perform public.three_d_share_check(p_state, p_thumbnail);

  select * into v_row from public.three_d_shares s where s.id = share_id for update;
  if not found or not public.three_d_share_owned(v_user, p_creator_key, v_row.user_id, v_row.creator_key) then
    raise exception 'SHARE_NOT_FOUND: no share of yours with that id' using errcode = 'P0001';
  end if;
  if v_row.revoked_at is not null or (v_row.expires_at is not null and v_row.expires_at <= now()) then
    raise exception 'SHARE_GONE: that link was revoked or has expired' using errcode = 'P0001';
  end if;
  if v_row.update_window_start is not null and v_row.update_window_start > now() - interval '1 hour'
     and v_row.update_count >= 30 then
    raise exception 'SHARE_RATE_LIMIT: this link was updated many times in the last hour' using errcode = 'P0001';
  end if;

  update public.three_d_shares s
     set state = p_state,
         thumbnail = p_thumbnail,
         updated_at = now(),
         update_window_start = case when s.update_window_start is null or s.update_window_start <= now() - interval '1 hour'
                                    then now() else s.update_window_start end,
         update_count = case when s.update_window_start is null or s.update_window_start <= now() - interval '1 hour'
                             then 1 else s.update_count + 1 end
   where s.id = share_id;
  return true;
end;
$$;

revoke all on function public.update_3d_share(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.update_3d_share(text, jsonb, text, text) to anon, authenticated;

-- ── Owner: revoke ───────────────────────────────────────────────────────────
-- Clears the stored figure as well as flagging it: revoking removes the data
-- that was disclosed, not merely the page.
create or replace function public.revoke_3d_share(share_id text, p_creator_key text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  update public.three_d_shares s
     set revoked_at = now(), state = '{}'::jsonb, thumbnail = null
   where s.id = share_id
     and s.revoked_at is null
     and public.three_d_share_owned(auth.uid(), p_creator_key, s.user_id, s.creator_key);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.revoke_3d_share(text, text) from public, anon, authenticated;
grant execute on function public.revoke_3d_share(text, text) to anon, authenticated;

-- Post-migration verification (run manually):
--   select public.create_3d_share('{"v":1,"settings":{},"files":[]}'::jsonb, 'browserkey-0123456789');
--   select public.get_3d_share('<id>');                                  -- { state, thumbnail }
--   select public.revoke_3d_share('<id>', 'browserkey-0123456789');      -- true
--   select public.get_3d_share('<id>');                                  -- null
