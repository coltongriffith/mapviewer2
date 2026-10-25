-- ============================================================
-- qc_claims_in_bbox: order the rows before its `limit 2000`.
--
-- The function (supabase-qc-claims-setup.sql, in no earlier migration) stops
-- at 2000 rows with no ORDER BY, so on a box holding more claims Postgres may
-- keep a different 2000 on each call. /api/claims pages the result through
-- PostgREST (order/offset/limit over the function's output), one call per
-- page, so pages could come from different subsets: claims repeated, others
-- never shown. Ordering inside makes every call keep the same rows.
--
-- tag_number first (it is not unique: co-owners get a row each), then
-- owner_name, so a claim's rows are never split by the cut either.
--
-- The limit stays 2000: /api/claims treats a total of 2000 as "capped"
-- (QC_BBOX_MAX), so raising it here alone would report a capped box as
-- complete.
--
-- Same signature, return type, security and grants; create or replace keeps
-- the existing EXECUTE grants. Idempotent.
--
-- Rollback: rerun the definition in supabase-qc-claims-setup.sql.
-- ============================================================

create or replace function public.qc_claims_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision
)
returns table (
  tag_number    text,
  owner_name    text,
  status        text,
  good_to_date  date,
  area_hectares numeric,
  title_type    text,
  geometry      jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select tag_number, owner_name, status, good_to_date, area_hectares, title_type, geometry
  from public.qc_claims
  where geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  order by tag_number, owner_name
  limit 2000;
$$;
