-- Make Quebec holder search reachable by the names people actually type.
--
-- GESTIM is a francophone registry and stores holders in French word order,
-- with accents:
--
--   market name            stored in GESTIM
--   Azimut Exploration  →  "Exploration Azimut inc."
--   Midland Exploration →  "Exploration Midland inc."
--   Vior (gold)         →  "Corporation Aurifère Vior Inc."
--
-- Quebec searched owner_name as ONE contiguous substring, so neither the
-- reversed word order nor a missing accent could ever match. Measured against
-- this table on the day of writing:
--
--   "Azimut Exploration"  → 0 rows, would be 10,891
--   "Midland Exploration" → 0 rows, would be  8,646
--
-- Those are the province's #1 and #3 largest holders. 96 owners holding 57,696
-- claims (22.1%) carry French-order names; 282 owners holding 52,837 claims
-- (20.3%) carry accents. The two sets overlap and both were unreachable.
--
-- This adds a folded column — accents stripped, lowercased — for the API to
-- match tokens against, one token at a time. owner_name itself is untouched,
-- so everything displayed to a user keeps its real spelling.
--
-- Rollback:
--   drop index if exists public.qc_claims_owner_name_norm_trgm;
--   alter table public.qc_claims drop column if exists owner_name_norm;
--   drop function if exists public.immutable_unaccent(text);
--   -- the unaccent extension is left in place; dropping it would break the
--   -- function signature above if this is re-applied.

create extension if not exists unaccent;

-- unaccent() is STABLE, not IMMUTABLE, because it depends on a dictionary that
-- could in principle be changed. A generated column requires immutability, so
-- pin the dictionary explicitly and wrap it. Pinning is what makes the promise
-- honest rather than just asserted.
create or replace function public.immutable_unaccent(txt text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public, pg_catalog
as $$ select public.unaccent('public.unaccent', txt) $$;

alter table public.qc_claims
  add column if not exists owner_name_norm text
  generated always as (lower(public.immutable_unaccent(owner_name))) stored;

-- Trigram index: every token match is an unanchored LIKE ('%token%'), which no
-- btree can serve. pg_trgm is already installed for the same reason elsewhere.
create index if not exists qc_claims_owner_name_norm_trgm
  on public.qc_claims using gin (owner_name_norm gin_trgm_ops);

-- Verification:
--   select count(*) from public.qc_claims
--    where owner_name_norm like '%azimut%' and owner_name_norm like '%exploration%';
--   -- expect ~10,891, where the contiguous search returned 0
--
--   select count(*) from public.qc_claims where owner_name_norm like '%aurifere%';
--   -- expect > 0 despite the stored name being "Aurifère"
