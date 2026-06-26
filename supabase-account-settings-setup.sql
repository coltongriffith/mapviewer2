-- ============================================================
-- Exploration Maps -- Account Settings Setup
-- Run this in Supabase Dashboard -> SQL Editor -> Run.
-- Safe to re-run: uses IF NOT EXISTS + exception-guarded policies.
-- ============================================================

-- One row per user holding reusable brand defaults (company name, QP name &
-- credentials, projection) that pre-fill every new project. Stored as JSONB so
-- the field set can grow without a migration.
create table if not exists account_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table account_settings enable row level security;

-- Owner-only access: a user can read and write only their own row.
do $$ begin
  create policy "users select own settings"
    on account_settings for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "users insert own settings"
    on account_settings for insert to authenticated with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "users update own settings"
    on account_settings for update to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
