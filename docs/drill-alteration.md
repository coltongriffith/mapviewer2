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

## Property-backed 3D loader contract

The property loader accepts one explicit `geologySource`: `lithology`, `alteration` or `none`. Its API is `pull(client, property, onProgress, tries, { geologySource })`; `pullPropertyResults` accepts the same option in its existing options object. An omitted option keeps the previous lithology files and snapshot metadata shape. Explicit selections add `geologySource` and `geologyIntervals` to the saved source reference. They do not change assay calculation, result identifiers, coordinate handling or desurvey.

Only collars, surveys, assays and the selected log table are read. `none` omits both logs; alteration never falls back to lithology or combines its categories. Alteration exports as `property-alteration.csv` with `HoleID,From,To,Code,Description,Intensity`. Numeric-looking codes and original intensity text such as `03` remain strings. The existing categorical geology parser reads the codes; intensity is retained in the figure's source CSV but is not interpreted as a grade, numerical colour scale or strength ordering.

Missing alteration-table errors (`42P01`/`PGRST205`) explain that the alteration database update is unavailable and offer a different source. This error applies only when alteration is explicitly requested; ordinary read/permission failures still fail the load. Default and no-geology loads never query that table. The caller must apply a completed load atomically and retain the existing figure when it fails.

Snapshot timestamps, retry checks and newer-data notices consider only the selected log plus collars/surveys/assays. Unselected log imports and rollbacks do not prompt updates to the figure. Current rows are read with the existing property-scoped, current-version keyset pagination, continuing through server-capped pages. This remains the existing current-data loader, not an immutable historical query: its before/after check compares the latest observed import/rollback timestamp and reads at most the latest 1,000 property import batches. It cannot guarantee a transaction-wide snapshot or complete arbitrarily old batch history.

UI source selection, saved-figure legend isolation and preventing extra uploaded logs from mixing with source-aware updates are separate caller responsibilities. Opening an existing saved figure must not rewrite its files or legend. Structure needs stable observation identity and declared angle conventions; no such interpretation is added here.

The 3D property picker offers Lithology, Alteration or No geology. An explicit Load replaces drill files and resets custom geology labels; changing source also removes uploaded geology legends and sets the source heading. Update keeps the saved source and custom labels. It refuses extra uploaded geology logs, including logs named for the opposite property source, instead of removing or pooling them. Old figures without an explicit source retain their original update behavior. Intensity stays in the CSV as descriptive text and is not modeled.
