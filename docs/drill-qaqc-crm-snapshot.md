# Historical CRM comparison snapshots

This read-only loader prepares bounded evidence for one sample import's standard comparisons. It adds no schema, chart, approval rule, lab-method assumption or production writes. Existing duplicate loader/discovery APIs and their return shapes remain unchanged.

```js
import { discoverCrmGroups, loadCrmSnapshot } from '../src/utils/drillQaqcSnapshot.js';

const selection = { propertyId, batchId };
const discovery = await discoverCrmGroups(client, selection, { signal, isCurrent });
// Present discovery.groups and require an explicit group choice only if complete.
const snapshot = await loadCrmSnapshot(client, chosenGroup, { signal, isCurrent });
// Only snapshot.complete === true may be passed to numerical comparisons.
```

Each group/scope contains `propertyId`, `batchId`, `labId`, `labBatchId`, `crmId`, `crmRevision`, `element`, and exact `unit`. Discovery reads only this batch's written historical sample versions, discovers populated standard tuples, and reads no definitions. More than4,096 group choices fails closed with a smaller-import message.

`loadCrmSnapshot` returns `{scope, records, crms, complete, issues, manifest}`. `records` contains all written sample versions, including their `crm_version_ids`; the standard population for counts is selected by exact lab/job/CRM/revision, not filtered down to successful element/unit matches. Missing selected elements and different units remain available for explicit statistical exclusions. Other labs/jobs/CRMs/revisions are outside that population. The statistics layer must independently validate sample identity, exact units, raw values, censoring and reference uniqueness.

`crms` contains only successfully resolved **pinned UUIDs** matching property + CRM + revision + element + exact unit. Rows retain `id`, `property_id`, `batch_id`, `source_row`, `record`, and `superseded_by_batch`. No current-only filter is used. UUID array order is not treated as element order. A newer same-name definition is never substituted. Multiple matching pinned versions are all returned so statistics can report ambiguity instead of choosing the first. Missing/malformed sample pins yield no matching reference; they do not trigger a current-definition search.

The shared reader loads at most5,000 written rows using250-row `(source_row,id)` keyset pages, continuing through short server-capped pages to a terminal empty page. It validates written counts, cursors, property/batch ownership and immutable batch metadata. It re-reads rollback status at the end. The source-row values are submitted-array positions; gaps are preserved and are not analysis chronology. Submitted and written counts can differ because unchanged reimport rows stay in older batches.

Selected standards can each pin multiple elements. A separate maximum of5,000 **unique candidate UUIDs** is enforced before any definition requests. All candidates must be queried in chunks of at most100, paged by UUID until empty, with exact property and CRM tuple filters on every request. Finding a matching definition early does not end the search: later candidates could make it ambiguous. More candidates returns `complete:false` and `pin_limit`; nothing is silently dropped. The total decoded JSON response budget is32MiB across sample rows, definition rows and batch metadata; callers may supply a smaller budget but cannot raise it.

`manifest` retains the exact scope, all written record IDs, `requestedCrmIds`, returned `crmIds`, provenance/request hash, submitted/written/selected counts, retrieval time and refreshed rollback status. `unresolvedCandidateIds` means candidates not returned by the selected tuple query, **not necessarily missing definitions**: other elements in a multi-element pin array legitimately do not match. It is populated only after reference reads complete. Statistics decides whether each standard has zero, exactly one or multiple matching pinned definitions.

Failed/denied/truncated reads or malformed returned scope set `complete:false`; they are not missing-reference exclusions and must not produce chart totals. A selected tuple mismatch in a returned definition fails closed. Cancellation or a stale caller lifecycle throws `AbortError`. There is no shared cache; callers must discard prior snapshots on authentication/property/import/group changes and provide `isCurrent`/AbortSignal for in-flight reads. The ordinary Supabase client and existing RLS remain authoritative, with no privileged fallback.

The historical snapshot covers records **written by this import**, not a full original file, whole laboratory job or current-property report. This module does not infer a method, validate a CRM certificate, calculate SD, replace BDL observations or assess sequence rules. Numerical comparisons and UI are separate consumers.

Tests use the actual Supabase JS client with mocked HTTP responses to inspect wire filters and pagination. Coverage includes capped pages, source gaps, exact historical pins, missing/newer/mismatched/ambiguous candidates, multi-element pin order, candidate/group/byte ceilings, errors, count mismatch, cancellation and rollback/hash refresh. Existing duplicate snapshot/statistics/view tests run unchanged against the shared reader. Hosted PostgREST/RLS and deployment performance are not proven by these mocks.
