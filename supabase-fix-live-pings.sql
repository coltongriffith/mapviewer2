-- Standalone fix for the live_pings 403 ("new row violates row-level
-- security policy for table live_pings"). Run this block by itself in the
-- Supabase SQL Editor (don't mix it with the full setup script) — if any
-- other statement in a multi-statement run errors, Postgres rolls back the
-- *entire* batch, including policy changes later in the file, with no
-- obvious warning. Running this in isolation rules that out.

create table if not exists live_pings (
  session_id text primary key,
  lat double precision,
  lng double precision,
  city text,
  region text,
  country text,
  created_at timestamptz default now()
);
alter table live_pings add column if not exists created_at timestamptz default now();
alter table live_pings add column if not exists region text;
alter table live_pings enable row level security;

grant select, insert, update on table live_pings to anon, authenticated;

drop policy if exists "anyone upsert own ping" on live_pings;
drop policy if exists "anyone update own ping" on live_pings;
drop policy if exists "anyone select live pings" on live_pings;

create policy "anyone upsert own ping"
  on live_pings for insert to anon, authenticated with check (true);
create policy "anyone update own ping"
  on live_pings for update to anon, authenticated using (true) with check (true);
create policy "anyone select live pings"
  on live_pings for select to anon, authenticated using (true);

create index if not exists live_pings_created_idx on live_pings (created_at);

-- Verification: run these after the block above completes with no errors.
-- 1) Confirms RLS is on and exactly these 3 policies exist:
select polname, polcmd, polroles::regrole[] from pg_policy
  where polrelid = 'public.live_pings'::regclass;
-- 2) Proves an upsert succeeds under the anon role (mirrors what the browser does):
set role anon;
insert into live_pings (session_id, lat, lng, city, country, created_at)
  values ('__verify_test__', 0, 0, 'test', 'test', now())
  on conflict (session_id) do update
    set lat = excluded.lat, created_at = excluded.created_at;
reset role;
delete from live_pings where session_id = '__verify_test__';
