-- Exploration Maps 3D (/3d): figures saved to the visitor's account.
--
-- One row per figure: the settings (brand, logo as a data URL, colours,
-- callouts, camera, size), the list of data files and a small JPEG
-- thumbnail. The raw CSV/TXT/OBJ text lives in the private storage bucket
-- 'three-d-files' under <user id>/<project id>/<file>, written and read
-- straight from the browser (src/three-d/account-core.js). Owner-only
-- throughout. Delete is soft (deleted_at); the files stay until the row goes.
--
-- Idempotent: guarded blocks, no DROP statements.

create table if not exists public.three_d_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  -- [{ name, path, size, role, cols }]; path is the storage object name.
  file_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(file_paths) = 'array'),
  thumbnail text check (thumbnail is null or char_length(thumbnail) <= 300000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists three_d_projects_user_updated_idx
  on public.three_d_projects (user_id, updated_at desc);

alter table public.three_d_projects enable row level security;
revoke all on public.three_d_projects from anon;
grant select, insert, update, delete on public.three_d_projects to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'three_d_projects'
                 and policyname = 'Owners read their 3D projects') then
    create policy "Owners read their 3D projects" on public.three_d_projects
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'three_d_projects'
                 and policyname = 'Owners create their 3D projects') then
    create policy "Owners create their 3D projects" on public.three_d_projects
      for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'three_d_projects'
                 and policyname = 'Owners update their 3D projects') then
    create policy "Owners update their 3D projects" on public.three_d_projects
      for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'three_d_projects'
                 and policyname = 'Owners delete their 3D projects') then
    create policy "Owners delete their 3D projects" on public.three_d_projects
      for delete to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;

-- updated_at follows every change, whatever the client sends.
create or replace function public.three_d_projects_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.three_d_projects_touch() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'three_d_projects_touch'
                 and tgrelid = 'public.three_d_projects'::regclass) then
    create trigger three_d_projects_touch
      before update on public.three_d_projects
      for each row execute function public.three_d_projects_touch();
  end if;
end $$;

-- ── Data files ──────────────────────────────────────────────────────────────
-- Private, 50 MB an object. A user reads and writes only under <their uid>/.
insert into storage.buckets (id, name, public, file_size_limit)
values ('three-d-files', 'three-d-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Owners read their 3D files') then
    create policy "Owners read their 3D files" on storage.objects
      for select to authenticated
      using (bucket_id = 'three-d-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Owners upload their 3D files') then
    create policy "Owners upload their 3D files" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'three-d-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Owners replace their 3D files') then
    create policy "Owners replace their 3D files" on storage.objects
      for update to authenticated
      using (bucket_id = 'three-d-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'three-d-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Owners delete their 3D files') then
    create policy "Owners delete their 3D files" on storage.objects
      for delete to authenticated
      using (bucket_id = 'three-d-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end $$;
