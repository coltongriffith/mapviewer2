-- ============================================================
-- Exploration Maps -- Product Events (activation funnel)
-- Run this in Supabase Dashboard -> SQL Editor -> Run.
-- Safe to re-run: IF NOT EXISTS + exception-guarded policies.
-- ============================================================

-- One row per funnel event, keyed by anonymous session_id so the
-- landing -> editor -> first layer -> export funnel and the
-- share_created -> share_viewed -> share_forked -> signup loop
-- can be joined end-to-end.
create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  event text not null,
  props jsonb,
  created_at timestamptz default now()
);
create index if not exists product_events_event_idx on product_events (event, created_at desc);
create index if not exists product_events_session_idx on product_events (session_id);

alter table product_events enable row level security;
do $$ begin
  create policy "anon insert product events"
    on product_events for insert to anon with check (user_id is null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth insert product events"
    on product_events for insert to authenticated with check (user_id is null or auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Reads go through the admin dashboard (service key / admin policies),
-- mirroring the other analytics tables: no select policy for anon.

-- Activation funnel for the admin dashboard: distinct sessions per stage,
-- last 30 days. Requires is_admin() from supabase-admin-setup.sql.
create or replace function admin_get_product_funnel()
returns table (event text, sessions bigint)
language sql security definer stable as $$
  select e.event, count(distinct e.session_id) as sessions
  from public.product_events e
  where e.created_at > now() - interval '30 days'
    and is_admin()
  group by e.event;
$$;
