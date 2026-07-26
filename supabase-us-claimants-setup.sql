-- ============================================================================
-- U.S. mining claim CLAIMANTS store  (run once, in the Supabase SQL editor)
-- ============================================================================
-- Ownership, joined to geometry by MLRS serial number.
--
-- The BLM spatial layer this app queries publishes geometry but NO claimant
-- names, so "show me this company's Nevada ground" currently degrades to a
-- claim-NAME match, which establishes nothing about ownership. This table holds
-- the ownership side. /api/claims joins it to BLM geometry on the serial
-- (CSE_NR), and only results resolved through this table are allowed to be
-- titled as a company's claims.
--
-- SOURCE-AGNOSTIC ON PURPOSE. Every candidate source produces the same shape —
-- (serial, claimant name, state) — so the `source` column carries which one a
-- row came from and rows from different sources coexist:
--   mlrs_report_120  BLM MLRS "Serial Number Crosswalk by Customer". The
--                    authoritative option: BLM is the system of record. Gated
--                    behind Login.gov with no machine API, so it is an
--                    authenticated periodic export, not a live feed.
--   ndom             Nevada Division of Minerals ArcGIS Hub (MLRS-derived).
--   claims_hub       The third-party C.L.A.I.M.S. multi-state hub. Useful as a
--                    cross-check; NOT a source of record for a filing.
-- See docs/us-claims.md ("Claimant join via serial number").
--
-- THIS IS A SNAPSHOT, NOT LIVE DATA. `snapshot_date` is mandatory and is
-- surfaced all the way into the exported map's source credit. A stale snapshot
-- presented as current ownership is the failure this column exists to prevent.
--
-- Copy this whole file into the Supabase SQL editor and click "Run".
-- It is safe to re-run: every statement is idempotent.
-- ============================================================================

-- Trigram index support so claimant-name ILIKE searches stay fast.
create extension if not exists pg_trgm;

create table if not exists public.us_claim_claimants (
  id              bigint generated always as identity primary key,
  serial          text not null,   -- MLRS case serial; joins to BLM CSE_NR
  claimant_name   text not null,   -- claimant string EXACTLY as published
  claimant_role   text,            -- BLM's own wording: locator / owner of
                                   -- record / agent / lessee. Never collapsed:
                                   -- a locator is often a staking contractor,
                                   -- not the beneficial owner, and flattening
                                   -- the two would recreate the bug this whole
                                   -- table exists to fix.
  state           text,            -- two-letter state, for scoping
  source          text not null,   -- mlrs_report_120 | ndom | claims_hub
  snapshot_date   date not null,   -- when the source extract was produced
  raw             jsonb,           -- original row, for traceability
  loaded_at       timestamptz not null default now()
);

-- One row per (serial, claimant, source): the loader upserts on this, so a
-- re-run of the same extract updates rather than duplicates.
create unique index if not exists us_claim_claimants_unique
  on public.us_claim_claimants (serial, claimant_name, source);

-- Fast claimant-name substring search (company mode, tier 1-3 of the ladder).
create index if not exists us_claim_claimants_name_trgm
  on public.us_claim_claimants using gin (claimant_name gin_trgm_ops);

-- Fast serial lookup (the join back to BLM geometry).
create index if not exists us_claim_claimants_serial
  on public.us_claim_claimants (serial);

create index if not exists us_claim_claimants_state
  on public.us_claim_claimants (state);

-- ── Row level security ──────────────────────────────────────────────────────
-- Public read-only: claimant data published by BLM is already public, and the
-- search proxy reads it with the anon key. The loader writes with the
-- service-role key, which bypasses RLS, so no write policy is needed.
alter table public.us_claim_claimants enable row level security;

drop policy if exists "us_claim_claimants public read" on public.us_claim_claimants;
create policy "us_claim_claimants public read"
  on public.us_claim_claimants for select
  using (true);

-- ── Current snapshot date per source ────────────────────────────────────────
-- The API reads this to stamp results with the snapshot they came from, so the
-- exported credit line can say "snapshot 2026-07-01" rather than implying live
-- data. Exposed as a view so a single cheap select answers it.
create or replace view public.us_claim_claimants_snapshots as
  select source,
         max(snapshot_date) as snapshot_date,
         count(*)           as rows,
         max(loaded_at)     as loaded_at
    from public.us_claim_claimants
   group by source;

-- ── Replace one source's rows atomically ────────────────────────────────────
-- A fresh extract supersedes the previous one for that source. Deleting by
-- source keeps other sources (and their snapshot dates) intact.
create or replace function public.replace_us_claimants_source(p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.us_claim_claimants where source = p_source;
end;
$$;
