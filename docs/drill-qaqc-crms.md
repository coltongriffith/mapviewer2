# Descriptive CRM reference comparisons

`shared/qaqcCrms.js` compares imported standards with their exact pinned, supplied reference definitions. It is a pure statistics foundation: no chart, database write, certificate verification, unit conversion, laboratory acceptance decision or consecutive-result rule is introduced. The QA/QC register and existing maps/duplicate comparisons remain unchanged.

## Input contract

```js
const analysis = analyzeCrmSnapshot({
  scope: { propertyId, batchId, labId, labBatchId, crmId, crmRevision, element, unit },
  records, // all written sample rows in the exact property/import
  crms, // exact pinned CRM rows, including historical versions
  complete: true,
});
```

The eight scope fields are explicit, nonempty exact strings. Laboratory/job/CRM/revision select the standards population; a selected standard missing the chosen element or using another unit remains an exclusion. Other sample types, laboratories/jobs and CRM revisions are not pooled. The module bounds samples and definitions at 5,000 each. The loader must separately bound the candidate UUID union and bytes before asserting completeness.

Rows retain `id`, `property_id`, `batch_id`, `source_row` and `record`; samples additionally retain `crm_version_ids`. Match those UUIDs against the exact CRM/revision/element/unit tuple, never against whichever definition is current and never by array position. Reimported identical definitions can have distinct row UUIDs: each observation retains its actual pin. Missing definitions remain unavailable; ambiguous matches are unassessed. Invalid or out-of-property reference details are not copied into results.

Keep the loader manifest alongside the analysis: source provenance/hash, exact requested/resolved UUIDs, submitted/written counts, rollback state and retrieval time. The pure module cannot independently prove access control or that a load is complete. `complete:false` yields no numerical summaries or points. It must not be used to label a first page as a complete import.

## Arithmetic and numerical limits

For an uncensored observation x, supplied expected value μ ≥0 and supplied SD s >0:

`z = (x - μ) / s`

Reference lines are μ, μ±2s and μ±3s. Values/expected/SD must be finite JavaScript numbers below the register's 1e12 bound. Uncensored zero is valid, including μ=0. Negative mathematical lower lines are retained. The SD is not recomputed from observations and is not interpreted as a confidence half-width, standard error or expanded uncertainty. [OREAS's 59a table](https://www.oreas.com/crm/oreas-59a/) lists 1SD, confidence limits and method separately. [NIST's control-chart guidance](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc31.htm) describes the importance of the SD basis and assumptions. These support the wording **bands from supplied SD**, not independent certification or process validation.

`crmReferenceComparison(x, μ, s)` returns `{z,bands,category}`, or null for invalid/unrepresentable arithmetic. Bands are `{lower3,lower2,expected,upper2,upper3}`. The categories are mutually exclusive: `within2` (including boundary), `outside2Within3` (including the ±3 boundary), and `outside3`. Classification compares unrounded observations to the reference bands. It does not simply round z or test the displayed value.

Decimal arithmetic receives an allowance of `4 * Number.EPSILON * max(abs(lower3),abs(upper3),s)` at a band boundary. This is a few floating-point steps at the supplied reference scale, not a scientific tolerance or display precision. The underlying z and bands remain unrounded. If that allowance exceeds `sqrt(Number.EPSILON)` of one SD (about 1.49e-8 SD), if bands cease to be strictly ordered, if the score/bands are nonfinite, or if a nonzero difference underflows to a zero score, the comparison is unassessed for numerical precision/range. This conservative machine-derived guard prevents reference-scale rounding from hiding a material SD excursion. It does not imply that source data at that scale are scientifically invalid.

## Evidence and denominators

The result contains `scope`, `complete`, `interpretation:'descriptive'`, `batchRecordCount`, `selectedCount`, `eligibleCount`, `excludedCount`, `excludedByReason`, `points`, `excluded`, and `summaries`.

Points preserve `(source_row,id)` order and include sample/batch/source position, element/unit, `observed` raw/value/censoring/bound evidence, `reference` UUID/batch/source position/CRM/revision/expected/SD/source evidence, z, bands and category. Exclusions retain the same available evidence plus one reason and `status:'unassessed'`; they have no z score. Valid points have `status:'descriptive'`. Neither status is pass/fail.

Exclusion precedence is missing element, exact-unit mismatch, missing/ambiguous/mismatched reference, censoring, invalid values, missing raw text, then numerical range. Selection fields come first because an omitted element or different sample unit need not have a matching selected reference pin. Any own BDL key means censored even when an upstream importer stored a numerical substitution; raw ND and its numeric bound remain visible. Unknown-bound `true` does not manufacture a numeric bound. No DL/2, zero or bound substitution is performed.

`selectedCount = eligibleCount + excludedCount`, and primary exclusion counts sum to excludedCount. Each summary category returns `{count,total,percent}` using eligibleCount as total; the three category counts sum to eligibleCount. Empty denominators produce null percentages. Submitted count, written batch count and selected/assessed counts describe different populations and must not be collapsed.

## Presentation and deferred work

The intended view is **Import snapshot: records written by this import**. Unchanged reimported rows remain in their original writing batch, so this is not a complete file/job or current-property report. Label the x-axis **Submitted row**, preserve gaps and historical/rollback annotations, and retain an accessible evidence table. Source rows/import times do not establish analytical order. Do not draw a connected process trend, apply consecutive rules, label band excursions failures, or show an overall approval badge.

Analytical method and typed uncertainty basis are absent; supplied source text does not independently validate them. Blank thresholds need reliable detection-limit metadata for uncensored results, which the current schema lacks. No blank threshold, new review policy, PNG/PDF export or migration is part of this module.

Focused tests use synthetic controls and cover historical/identical reimport pins, multielement array order, property/revision/unit isolation, zero and censored results, raw numeric bounds, disjoint denominators, decimal boundaries across scales, overflow/collapsed bands, incomplete loads and input immutability.
