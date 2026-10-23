# Alteration interval register

This additive database slice supports alteration through the existing drill import, preview, history, rollback and column-template RPCs. It does not add structural orientation measurements, change hole trajectories, or load alteration into 3D geology. No Tower measurements are supplied or generated.

## Input and identity

Use kind `alteration`, with these canonical JSON fields:

| Field | Meaning |
| --- | --- |
| `hole_id` | Actual source hole ID, trimmed text, 1–60 characters. |
| `from_m`, `to_m` | Measured downhole metres, finite JSON numbers below 1e12; start >=0 and end >start. |
| `code` | Nullable source category text, up to60 characters after edge trimming. |
| `description` | Nullable source description, up to500 characters after edge trimming. Code or description is required. |
| `intensity` | Nullable source **text**, up to60 characters after edge trimming. `03`, `0`, `weak` and `1-2` retain their meaning as source labels; no conversion or inferred scale. Absent, null and blank canonicalize to missing, not zero. |

One current record is identified by property + hole + from + to. Two records with that exact key in one submission are rejected; several observations at the identical interval require a different future identity model. Overlapping intervals with different keys are retained, with existing overlap warnings. Missing collars are warnings and never create coordinates or a collar. Intervals are not true-width measurements.

`drill_alteration` keeps org/property ownership, immutable written versions, batch and superseding-batch references, and `source_row`: the position in the submitted array. Source row is audit metadata, not worksheet line, chronology or part of identity. Reordering identical records does not rewrite them. Batch filename and mapping provide provenance; source file bytes are not attached by this RPC.

## API

Use existing `drill_import_batch` with kind `alteration`; `drill_rollback_batch` restores replaced versions and refuses a rollback while a later live import depends on it. The diff retains the original keys (`new`, `changed`, `unchanged`, `missing_collars`, `overlaps_existing`, etc.). `drill_property_summary` adds numeric `alteration` and includes alteration hole IDs in `holes`. Activity uses “alteration interval(s)”. Column templates accept the new kind.

Example via the existing client adapter:

```js
const request = {
  propertyId,
  kind: 'alteration',
  filename: 'alteration.csv',
  mapping: { columns: { hole_id: 'HoleID', from_m: 'From', to_m: 'To', code: 'AltCode', intensity: 'Intensity' } },
  rows: [{ hole_id: 'ACTUAL-SOURCE-ID', from_m: 10, to_m: 12, code: 'SER', intensity: '03' }],
};
const preview = await db.dryRun(request);
// Present the preview for the selected source before calling db.commit(request).
```

The example is a contract illustration, not real geological data or a production import instruction. RPC authorization derives the property org server-side; editors/admins/owners may preview/import/rollback, in-org viewers may read, other-org/anon users cannot read the table. Direct client writes and helper calls are revoked.

Original importer limits remain20,000 submitted rows,13MiB canonical-row JSON,64KiB mapping storage,2,000,000 written history rows/property and the existing database-headroom ceiling. Templates separately retain their16KiB mapping limit. Original retry semantics remain unchanged: repeating a UUID for the same property returns its stored result without comparing payload/kind, including rollback status. Retain a retry UUID only for the identical submission. All-unchanged imports produce no batch and leave source provenance intact.

Before this migration is installed, the existing RPC rejects `alteration` with `INVALID_KIND` (SQLSTATE22023). The UI should identify this as an unavailable alteration feature, while legacy kinds continue working. Missing the original drill migration is the existing RPC-unavailable case.

## Migration and rollback

`20261101120000_drill_alteration.sql` was generated with Supabase CLI2.122.0 as `20261023225351_drill_alteration.sql`, then renamed to sort after the repository's existing future-dated dependencies. It adds a table/RLS/grants/indexes, extends both kind constraints and the explicit resolver/canonical diff/validation/import/noun/summary functions. The existing generic rollback/template functions use the resolver and need no replacement. The newer QA `ws_property_has_content` implementation and its ACL are deliberately untouched; live original drill batches already protect alteration data.

Application rollback should hide the new importer and retain schema/history. Data rollback uses the existing batch RPC, newest dependent batch first. Do not restore old kind checks or functions while alteration batches/templates exist, or drop the table to undo the UI. Any schema downgrade needs a separately reviewed preservation plan. The migration includes this rollback note and a PostgREST schema reload notification. **No production migration has been applied by this change.**

Local SQL tests apply the migration twice, exercise actual roles, validate limits and canonical text, verify changed/no-op/retry/dependency rollback and check the QA guard body/ACL is unchanged. The full existing drill SQL regression file also runs against the extended functions to cover collars, surveys, assays and lithology. Hosted PostgREST schema exposure and production performance still need verification after an explicitly approved deployment.

3D selection is a later slice: current geology combines all `litho` files, so a new alteration loader must offer an explicit category-source choice rather than silently mix alteration with lithology. Structure needs stable observation identity and declared angle conventions; no such interpretation is added here.
