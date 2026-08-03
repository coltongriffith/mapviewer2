-- ============================================================
-- TENURE MONITOR — make an interrupted promotion recoverable, and stop
-- claiming it cannot happen.
--
-- WHAT WAS WRONG
--   The importer stages every page, judges the run as a whole, and only then
--   promotes. That ordering is what makes an ABORT safe, and the abort path is
--   genuinely airtight: staging is dropped, no trusted row is touched.
--
--   The catch-all failure path then reused the same words for a case they do
--   not cover. Promotion writes batch by batch over many round trips, because
--   PostgREST cannot hold one transaction across them. A crash at batch 7 of 40
--   leaves batches 1–6 committed — and the handler cleared staging, wrote
--   status='failed', and emailed the administrator "Stored tenure records are
--   unchanged". That sentence was false in exactly the situation where somebody
--   most needs it to be true, and clearing staging destroyed the only input a
--   recovery could have used.
--
-- WHAT THIS CHANGES
--   `promotion_started_at` marks the moment the importer stops being a pure
--   reader. It splits the failure path in two:
--
--     null      — the failure happened while fetching, normalizing or judging.
--                 Trusted data really is untouched; staging is cleared and the
--                 message says so.
--     not null  — promotion had begun. Staging is now KEPT, the run is recorded
--                 as failed with an honest summary, and the next run finishes
--                 the promotion before doing anything else.
--
--   Re-promoting an already-promoted batch is a no-op by construction, which is
--   what makes the resume safe rather than merely hopeful: detectChanges
--   compares the stored row against the staged row, so for a batch that already
--   landed they are equal, no change events are emitted and no snapshot is
--   written. The tenure upsert is keyed on (jurisdiction, source,
--   source_record_id) and idempotent on its own.
--
-- WHAT THIS IS NOT
--   This is recovery, not atomicity. A truly atomic promotion means moving the
--   whole diff into one database function, which would mean reimplementing
--   changeDetect.mjs in PL/pgSQL and keeping two copies of the most
--   correctness-critical logic in the feature. That is a deliberate future
--   decision, not a review fix, and docs/tenure-monitor.md now states the real
--   guarantee rather than the one we wished for.
--
-- Depends on: 20260801000001.
--
-- Rollback:
--   drop index if exists tenure_import_runs_interrupted_idx;
--   alter table public.tenure_import_runs drop column if exists promotion_started_at;
-- ============================================================

alter table public.tenure_import_runs
  add column if not exists promotion_started_at timestamptz;

comment on column public.tenure_import_runs.promotion_started_at is
  'Set when the importer begins writing to the trusted tables. NULL means the '
  'run never touched anything outside tenure_import_staging, so a failure left '
  'stored records genuinely unchanged. Non-NULL on a failed run means the '
  'promotion was interrupted part-way and its staging rows were deliberately '
  'retained for the next run to finish.';

-- Finding an interrupted run is the first thing every sync does, so it gets an
-- index rather than a sequential scan over the run history.
create index if not exists tenure_import_runs_interrupted_idx
  on public.tenure_import_runs (source, started_at desc)
  where status = 'failed' and promotion_started_at is not null;

-- ── Post-migration verification (run manually) ─────────────────────────────
--   -- an interrupted run keeps its staging; a clean abort does not:
--   select id, status, promotion_started_at,
--          (select count(*) from public.tenure_import_staging s where s.import_run_id = r.id) as staged
--   from public.tenure_import_runs r order by started_at desc limit 10;
--   -- expect staged = 0 on every 'aborted' row, and staged > 0 only on a
--   -- 'failed' row whose promotion_started_at is set.
