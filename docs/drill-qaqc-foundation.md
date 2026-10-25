# QA/QC sample register foundation

This is an additive database and client foundation for P2-3/P2-4. The optional import/register UI is documented in `drill-qaqc-ui.md`; charts are not implemented. The migration has not been applied. Existing `drill_assays`, assay import screens, results calculations and maps are unchanged. Standards and blanks commonly have no drill hole or interval; this register accepts that without inventing positions or weakening the assay table's positive-interval requirements.

## Data contract

`drill_qaqc_samples` stores a validated `record` JSON object plus generated, indexed identity fields and batch/version metadata. The identity is **property + lab_id + lab_batch_id + sample_id**. IDs are exact, case-sensitive strings, preserving leading zeroes. Choose the laboratory's stable job/submission identifier for `lab_batch_id`; a new import attempt is not a new lab job. Matching IDs are replacements within that scope, not silently joined across jobs or labs.

Required sample fields:

- `lab_id`, `lab_batch_id`, `sample_id`, `sample_type`: nonempty strings up to 120 characters. Types are `routine`, `standard`, `blank`, `field_dup`, `coarse_dup`, `pulp_dup`; none is inferred.
- `values`: 1–64 named elements, each a nonnegative finite number below 1e12, or null when below detection.
- `units`: explicit nonempty text for every element. No assumed unit or automatic conversion.
- `raw_values`: the original lab-reported text for every element (up to 100 characters), e.g. `"<0.005"` or `"1.000"`. Numeric values do not replace these strings.
- `bdl`: a subset of elements, each with a positive numeric detection limit or `true` when the lab supplies no numeric limit. A null value requires this flag. No BDL substitution is made by this adapter; record any upstream substitution policy in batch provenance. The UI and future statistics must not treat a BDL flag as an exact measurement.

Optional `hole_id` may be supplied when known. If either `from_m` or `to_m` is supplied, both and a real `hole_id` are required, with `0 <= from_m < to_m`. No collar or coordinate is created. Extra unknown fields are rejected to avoid silently losing source data; retain the original file in the property library.

Duplicate samples require `parent_sample_id`. The routine parent must already exist in the **same laboratory and lab job**; import parents separately, then duplicates. Cross-job relationships and duplicate-of-duplicate chains are explicitly unsupported in this first foundation. The stored `parent_version_id` pins the precise routine sample version. Updating the parent later does not silently rewrite an existing comparison's provenance.

Standards require `crm_id` and `crm_revision`. First import `drill_crm_values` definitions: `crm_id`, `revision`, `element`, `unit`, `expected`, `sd`, `source`. `expected >= 0`, `sd > 0`; `source` is nonempty text up to 1,000 characters naming the supplied certificate/reference. A CRM definition is immutable for **property + CRM + revision + element + unit**, including after rollback. A changed expected value, SD or source requires a new revision identifier. Samples require an exact revision, element and unit match and store the precise definition row UUIDs in `crm_version_ids`; later definitions cannot silently change old interpretation. Unit spelling is deliberately exact (for example, `g/t` and `ppm` are not automatically equated).

## Import and rollback example

The helper is used by the deliberately opened QA/QC panel and is also available to authenticated application integrations. It adds no initial-route startup code. Use the normal signed-in Supabase client, never a service key.

```js
import { importQaqc, rollbackQaqc } from './src/utils/drillQaqcDb.js';

// Illustrative synthetic values only, not Tower drill data.
const crmRows = [{ crm_id: 'CRM-A', revision: 'certificate-2025',
  element: 'Au', unit: 'g/t', expected: 1.01, sd: 0.04,
  source: 'Supplied manufacturer certificate, revision 2025' }];
const provenance = { filename: 'laboratory-job.csv', bdl_policy: 'flag only' };
await importQaqc(client, propertyId, 'crms', crmRows); // read-only preview
const crmBatchId = crypto.randomUUID(); // keep for retries, do not regenerate
await importQaqc(client, propertyId, 'crms', crmRows, {
  dryRun: false, batchId: crmBatchId, provenance,
});

const rows = [{ lab_id: 'Lab-A', lab_batch_id: 'JOB-1', sample_id: '00001',
  sample_type: 'standard', crm_id: 'CRM-A', crm_revision: 'certificate-2025',
  values: { Au: 1.02 }, units: { Au: 'g/t' },
  raw_values: { Au: '1.020' }, bdl: {} }];
const preview = await importQaqc(client, propertyId, 'samples', rows, { provenance });
// Review preview.new / changed / unchanged before committing.
const sampleBatchId = crypto.randomUUID();
const result = await importQaqc(client, propertyId, 'samples', rows, {
  provenance, dryRun: false, batchId: sampleBatchId,
});
// Inspect result.replayed and result.rolled_back after a retry.
await rollbackQaqc(client, sampleBatchId);
await rollbackQaqc(client, crmBatchId); // dependent samples must go first
```

All RPC callers receive server-side validation. Invalid rows fail atomically with a row number. Preview returns counts without writes; exact re-import returns `nothing_to_do`. A commit UUID can be retried with precisely the same kind/rows/provenance, returning the recorded result; a different request with that UUID fails `BATCH_ID_REUSED`. A previously rolled-back batch retry explicitly returns `rolled_back: true`, without resurrecting rows. To import those rows again use a new batch ID.

Each committed batch stores provenance, creator/time, counts and a request fingerprint. New sample versions supersede old rows without deleting them. Rollback withdraws the batch's versions and restores the rows it replaced. Dependencies protect earlier sample versions, duplicate parents and CRM definitions from rollback until their dependent imports are rolled back. The workspace activity feed records QA/QC imports and rollbacks, using the existing `drill_batch` entity type and `register: qaqc` metadata. This is a separate register: the existing drill batch summary and certificate selector do not yet list these batches.

Limits are 5,000 rows / 4 MB of row JSON / 16 KiB of provenance per request, 200,000 written rows per property including history, and the existing 70%-of-8-GiB database headroom ceiling. Imports serialize with other drill changes using the property's existing advisory lock.

Every written row records its one-based `source_row` within the submitted row array. Sort a batch by this field to recover laboratory row order; it is not a worksheet line number or a claimed collection time. The CSV/Excel mapper keeps physical source lines client-side for validation and stores bounded filename/hash/sheet/header metadata, not a potentially oversized line array, in provenance. An unchanged row retains its original writing batch and row order.

## Permissions and migration review

Only authenticated workspace members can read the new tables through RLS. Direct insert/update/delete are revoked, including for editors. The two write RPCs check a real authenticated identity, an accessible property and editor-or-higher membership before accessing data. Dedicated definer RPCs are necessary to enforce versioned writes; their search paths are empty, object references qualified, and PUBLIC/anonymous execution revoked. Internal validators are not callable from the browser. Active QA/QC batches also prevent deleting the property as if it were empty.

The migration was created with `supabase migration new drill_qaqc_foundation` and renamed to `20261101110000_drill_qaqc_foundation.sql` because this repository already contains later-dated dependencies than the local creation date. It depends on the workspace, property-file and drill-database migrations and changes no existing assay/import RPC. Review and apply in the owner's approved migration process; **no production schema or data has been changed**. A full local Supabase stack/advisor is not available here: verification uses real PostgreSQL semantics in PGlite with authenticated/anonymous roles, not a claimed production advisor run.

Deployment rollback before any data: remove the QA/QC functions/tables in dependency order and restore the preceding `ws_property_has_content` definition. After any imports, preserve/export the register and history and use a reviewed forward fix; do not destructively drop recorded lab data. The ordinary per-batch rollback RPC is safe history-preserving withdrawal, not schema rollback.

Tests apply the migration twice, execute real role grants/RLS, validate malformed and oversized data, duplicate identifiers, retry collisions, dry-run/no-op behavior, history, pinned CRM/parent versions, cross-unit refusal, dependency rollback, property deletion guard and isolation from production assays. Security review follows the [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [function privilege guidance](https://supabase.com/docs/guides/database/functions).

The separate import/register UI includes CSV/Excel mapping and register browsing. Deferred: links to lab certificate files, alteration/structure tables, cross-job duplicate pairing, QA/QC charts/statistics and reports. A future chart must use the pinned versions, original lab order/provenance and explicit units/BDL rules; this foundation does not label samples pass/fail or claim scientific approval.
