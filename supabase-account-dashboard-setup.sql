-- ============================================================
-- Exploration Maps -- Account Dashboard Setup
-- Run this in Supabase Dashboard -> SQL Editor -> Run.
-- Safe to re-run: uses IF NOT EXISTS, no data is dropped.
-- ============================================================

-- Adds a thumbnail column to projects so the new Account dashboard can show
-- a visual project gallery. Stored as a small JPEG data URL (consistent with
-- how the logo is already stored inline in layout), so no Storage bucket
-- is needed.
alter table projects add column if not exists thumbnail text;
