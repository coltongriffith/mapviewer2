-- ============================================================
-- QP sign-off on a published figure version (Phase 5, optional).
--
-- A qualified person may record that they reviewed a published version: their
-- name, credentials ("P.Geo."), the date and an optional note. A sign-off is
-- written once and never edited: it can only be retracted, with a reason,
-- after which a new one may be recorded. The pattern is drill_batch_files
-- (20261101100000_drill_batch_certificates.sql): column grants for the
-- writable inputs, and an invoker guard trigger that stamps who and when.
--
-- WHO
--   Reads follow the version's own access (the select policy asks
--   figure_versions, under its policy). Writes: an editor or above of the
--   version's company, or the owner of a personal version (as publishing).
--   One live sign-off per version.
--
-- Additive and idempotent: guarded blocks; figure_versions is untouched.
-- Depends on: 20261029100000_figure_versions.sql, 20261023100000_workspaces_properties.sql (has_org_role).
-- Rollback (nothing depends on it): drop table public.figure_version_signoffs;
--   drop function public.figure_version_signoff_guard(), public.figure_version_signoff_may_write(uuid);
-- ============================================================

set local lock_timeout = '5s';

create table if not exists public.figure_version_signoffs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.figure_versions(id) on delete cascade,
  qp_name text not null check (char_length(btrim(qp_name)) between 1 and 200),
  qp_credentials text not null check (char_length(btrim(qp_credentials)) between 1 and 100),
  signed_on date not null check (signed_on between date '1900-01-01' and date '2200-12-31'),
  note text check (note is null or char_length(note) <= 1000),
  signed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  retracted_at timestamptz,
  retracted_by uuid references auth.users(id) on delete set null,
  retraction_reason text check (retraction_reason is null or char_length(btrim(retraction_reason)) between 1 and 500)
);
create unique index if not exists figure_version_signoffs_live_key on public.figure_version_signoffs (version_id) where retracted_at is null;
create index if not exists figure_version_signoffs_version_idx on public.figure_version_signoffs (version_id, created_at);
create index if not exists figure_version_signoffs_signed_by_idx on public.figure_version_signoffs (signed_by);
create index if not exists figure_version_signoffs_retracted_by_idx on public.figure_version_signoffs (retracted_by);

alter table public.figure_version_signoffs enable row level security;
revoke all on public.figure_version_signoffs from public, anon, authenticated;
grant select on public.figure_version_signoffs to authenticated;
grant insert (version_id, qp_name, qp_credentials, signed_on, note) on public.figure_version_signoffs to authenticated;
grant update (retraction_reason) on public.figure_version_signoffs to authenticated;

-- May the caller sign off (or retract) on this version? Invoker: the version
-- must be one the caller can read.
create or replace function public.figure_version_signoff_may_write(p_version uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.figure_versions v where v.id = p_version
    and ((v.org_id is null and v.owner_id = (select auth.uid()))
         or (v.org_id is not null and public.has_org_role(v.org_id, 'editor'))))
$$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='figure_version_signoffs' and policyname='Readers see sign-offs') then
    create policy "Readers see sign-offs" on public.figure_version_signoffs for select to authenticated
      using (exists (select 1 from public.figure_versions v where v.id = version_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='figure_version_signoffs' and policyname='Editors sign off') then
    create policy "Editors sign off" on public.figure_version_signoffs for insert to authenticated
      with check (signed_by = (select auth.uid()) and public.figure_version_signoff_may_write(version_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='figure_version_signoffs' and policyname='Editors retract sign-offs') then
    create policy "Editors retract sign-offs" on public.figure_version_signoffs for update to authenticated
      using (public.figure_version_signoff_may_write(version_id))
      with check (public.figure_version_signoff_may_write(version_id));
  end if;
end $$;

-- Only the inputs above are written; who and when come from the database. An
-- update is a retraction and nothing else; a delete only the cascade when the
-- version itself is gone.
create or replace function public.figure_version_signoff_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_reason text;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.figure_versions v where v.id = old.version_id) then
      raise exception 'SIGNOFF_IMMUTABLE: a sign-off cannot be deleted; retract it with a reason' using errcode = '42501';
    end if;
    return old;
  end if;
  -- Allow the foreign keys' own ON DELETE SET NULL when an account is removed.
  if tg_op = 'UPDATE' and current_user not in ('authenticated', 'anon') then
    if (to_jsonb(new) - 'signed_by' - 'retracted_by') = (to_jsonb(old) - 'signed_by' - 'retracted_by')
       and (new.signed_by is not distinct from old.signed_by or new.signed_by is null)
       and (new.retracted_by is not distinct from old.retracted_by or new.retracted_by is null) then
      return new;
    end if;
    raise exception 'SIGNOFF_IMMUTABLE: a sign-off cannot be changed' using errcode = '42501';
  end if;
  if auth.uid() is null or not public.figure_version_signoff_may_write(new.version_id) then
    raise exception 'SIGNOFF_NOT_ALLOWED: editors and up can sign off a company version' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('signoff:' || new.version_id::text, 0));
  if tg_op = 'UPDATE' then
    if old.retracted_at is not null or new.retraction_reason is null or char_length(btrim(new.retraction_reason)) not between 1 and 500 then
      raise exception 'SIGNOFF_RETRACTION_INVALID: give a reason of up to 500 characters' using errcode = '22023';
    end if;
    v_reason := btrim(new.retraction_reason);
    new := old;
    new.retraction_reason := v_reason;
    new.retracted_at := now();
    new.retracted_by := auth.uid();
    return new;
  end if;
  if exists (select 1 from public.figure_version_signoffs s where s.version_id = new.version_id and s.retracted_at is null) then
    raise exception 'SIGNOFF_EXISTS: this version is already signed off; retract that first' using errcode = 'P0001';
  end if;
  new.qp_name := btrim(new.qp_name);
  new.qp_credentials := btrim(new.qp_credentials);
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.signed_by := auth.uid();
  new.created_at := now();
  new.retracted_at := null; new.retracted_by := null; new.retraction_reason := null;
  return new;
end $$;
revoke all on function public.figure_version_signoff_guard() from public, anon, authenticated;
revoke all on function public.figure_version_signoff_may_write(uuid) from public, anon, authenticated;
grant execute on function public.figure_version_signoff_may_write(uuid) to authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='figure_version_signoff_guard' and tgrelid='public.figure_version_signoffs'::regclass) then
    create trigger figure_version_signoff_guard before insert or update or delete on public.figure_version_signoffs
      for each row execute function public.figure_version_signoff_guard();
  end if;
end $$;
notify pgrst, 'reload schema';

-- Post-migration verification (run manually, signed in as an editor):
--   insert into public.figure_version_signoffs (version_id, qp_name, qp_credentials, signed_on) values ('<id>', 'A. Person', 'P.Geo.', current_date);
--   update public.figure_version_signoffs set retraction_reason = 'Wrong version' where version_id = '<id>';
-- ============================================================
