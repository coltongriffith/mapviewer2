# Historical duplicate snapshot loader

`loadDuplicateSnapshot(client, scope, options)` is a read-only preparation helper for future duplicate comparisons. It is not connected to the application UI and introduces no database migration, write RPC, chart, threshold, or acceptance decision.

## Contract

Supply the caller's normal authenticated Supabase client and an explicit scope:

```js
const scope = { propertyId, batchId, sampleType, labId, labBatchId, element, unit };
const snapshot = await loadDuplicateSnapshot(client, scope, {
  signal: controller.signal,
  isCurrent: () => selectionRevision === activeRevision && sessionRevision === activeSessionRevision,
  onProgress: ({ phase, loaded, expected }) => { /* phase: records or parents */ },
});
// The future statistics helper consumes { scope, records, parents, complete }.
```

`sampleType` must be `field_dup`, `coarse_dup`, or `pulp_dup`. Laboratory, lab job, element, and unit are explicit exact strings; no units, types, coordinates or laboratory values are inferred. The caller must cancel/discard results on selection, property **or authenticated-session** changes. The loader has no cross-call cache. Both before and after each request it checks the abort signal and `isCurrent`; cancelled/stale work throws `AbortError` rather than returning a partial result. Progress callbacks may trigger cancellation.

Result fields:

- `scope`: a copied selection; later caller mutations cannot change it.
- `records`: all read historical rows **written by this one import**, including superseded rows. The statistics helper selects type/lab/job and assesses element/unit exclusions.
- `parents`: exact historical pinned parent UUIDs for the selected type/lab/job, including selected rows missing the chosen element. No lookup by sample name and no current-version substitution.
- `complete`: true only after all written rows and requested reference queries finish and the final batch status is re-read with unchanged immutable metadata. It does **not** mean a whole lab job, submitted spreadsheet, current property state or scientific assessment is complete.
- `missingParentIds`: valid requested UUIDs that were not returned under current RLS after all reference reads finish (`manifest.referenceReadsComplete`). This array stays empty when a reference query fails: that failure cannot establish which individual UUIDs are absent. Missing/invalid/null pins still remain on their input records for the statistics helper's unassessed exclusions. A denied/failed query is a load failure, not a scientific exclusion.
- `issues`: stable load codes (`unavailable`, `batch_unavailable`, `invalid_batch`, `read_failed`, `invalid_response`, `invalid_cursor`, `invalid_reference`, `count_mismatch`, `byte_limit`, `batch_changed`). With any issue, downstream calculations must not publish numeric summaries. Invalid input/options throw before any request.
- `manifest`: version, full scope, batch hash/provenance, submitted and expected/loaded written counts, observed selected count, exact record/requested-parent/returned-parent/missing-parent UUIDs, retrieval time, byte count and final observed rollback timestamp. `population` is always `written_import_rows`; `currentStateClaimed` is always false. With `statusRefreshed:false`, rollback status is only the initial observation. Manifest counts on incomplete results describe progress, not report totals.

The result preserves raw scientific strings, source rows, batch IDs and supersession annotations on the returned records. Scientific identity/type/unit/censoring validation belongs to the pure statistics function, which must reject mismatched references instead of substituting data. No pass/fail or method-equivalence assertion is made here. Future numerical exports must combine this evidence manifest with their exact statistics/rules version and settings.

## Reading bounds and consistency

Every request uses `property_id` equality and normal RLS. The batch is fetched by exact UUID. Sample pages additionally use `batch_id` equality with `(source_row,id)` keyset ordering and a requested limit of 250. Validated cursors prevent malformed PostgREST logical filters. Empty pages terminate traversal; short pages do not, because server caps may be lower. Duplicate, out-of-order, foreign-scope and malformed cursor rows are refused. Gaps in source-row ordinals are valid because imports may skip unchanged records.

The loader requires exactly `rows_written` rows, at most 5,000; `row_count` is separately the submitted count. An unchanged submitted row is not part of this written subset. Reference UUIDs are deduplicated into groups of at most 100. Each reference query also uses property equality, and each group pages by raw UUID until empty. No `superseded_by_batch is null` filter is used on rows or pinned parents. Missing references cannot broaden a query across properties or permissions.

The cumulative decoded JSON payload allowance is 32 MiB (callers may lower `maxBytes`). This caps retained work after SDK decoding; it is not a streaming transport-byte limit. The known table schema/import limits and requested page sizes bound normal responses. The loader stops on count/size/cursor anomalies rather than retrying indefinitely.

The batch status is refreshed after reads. A rollback during loading is reflected as historical status while immutable numerical evidence remains usable; changes to the immutable batch hash/counts/provenance invalidate completion. Supersession fields are observations made during their row requests, not an atomic current-state snapshot. The manifest never claims that all rows are current, nor that import timestamps are analysis dates. Combining multiple current batches would need a separate coherent snapshot design.

## Verification

`tests/drill-qaqc-snapshot.test.js` exercises the real installed Supabase query builder against synthetic HTTP responses: literal serialization, tied keysets, lower server caps, the 5,000-row boundary, scoped reference chunks, historical/missing parents, denied reads, bad cursors/counts, payload bounds, refreshed rollback/hash, cancellation and stale-selection guards. It makes no production requests. Existing foundation SQL tests own authorization policy verification; this helper adds no new authorization path.

API conventions were checked against Supabase's current [filter documentation](https://supabase.com/docs/reference/javascript/using-filters), [logical filters](https://supabase.com/docs/guides/api/sql-to-api) and [AbortSignal support](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal).
