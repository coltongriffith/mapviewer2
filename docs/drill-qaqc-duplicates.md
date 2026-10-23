# Descriptive duplicate comparisons

`shared/qaqcDuplicates.js` is a pure calculation module. It does not fetch or change records, render charts, infer methods, convert units, substitute below-detection values or approve laboratory results. No database migration is needed for this module. All examples in its tests are synthetic.

## Snapshot contract

```js
const analysis = analyzeDuplicateSnapshot({
  scope: { propertyId, batchId, sampleType, labId, labBatchId, element, unit },
  records, // all written sample versions in this exact property/import
  parents, // exact parent_version_id rows, including historical versions
  complete: true,
});
```

The seven scope fields are explicit, nonempty, case-sensitive strings. `sampleType` is one of `field_dup`, `coarse_dup`, or `pulp_dup`. Laboratory/job/type are selected before eligibility is evaluated; missing elements and mismatched units within that group remain visible exclusions. No whitespace, case or unit normalization is applied.

Each database row supplies `id`, `property_id`, `batch_id`, `source_row`, and `record`; a duplicate also supplies `parent_version_id`. The source row is the one-based submitted-array position, not a physical worksheet line or analytical time. Each record array is bounded at 5,000 rows. Duplicate UUIDs, foreign import/property rows, absent source positions and invalid scope throw errors instead of producing an ambiguous report.

The loader must verify complete scoped reads before setting `complete: true`. Failed, truncated or inconsistent reads use `false`: the module then returns empty point arrays, null counts and null summaries. A missing pinned reference after a successful authorized read is instead an explicit `missing_parent` exclusion. The module does not use `missingParentIds` as an alternate source of truth or substitute a current version with a matching sample name.

Parent identity must match the exact pin, property, routine type, sample ID, laboratory and job. A superseded pinned parent remains valid historical evidence. The caller retains the loader's manifest alongside the returned analysis: provenance/hash, submitted versus written counts, batch rollback state and retrieval time must remain visible when presenting or exporting it. This module cannot independently prove loader completeness or authorization.

## Results and denominators

The result includes `scope`, `complete`, `interpretation: 'descriptive'`, `batchRecordCount`, `selectedCount`, `eligibleCount`, `excludedCount`, `excludedByReason`, `points`, `excluded`, `ranked`, and `summaries`.

- `selectedCount = eligibleCount + excludedCount`. `batchRecordCount` counts all written rows; it is neither the analyzed subset nor the original file's submitted count.
- `points` retains source order `(source_row, id)`. Each includes duplicate/parent UUIDs, sample IDs, selected element/unit, writing batch and source position. Its `duplicate` and `original` objects retain each selected raw string, parsed value, unit, censoring presence and numeric detection bound when supplied.
- Eligible points have `x` (original), `y` (duplicate), `hard`, `logEligible`, and `status: 'descriptive'`.
- `excluded` has the same identity/source fields plus one primary `reason`, `message`, and `status: 'unassessed'`. An invalid/foreign parent is not copied into the result. Its raw/identity details remain unavailable to the comparison.
- `ranked` sorts eligible points by increasing unrounded HARD, then duplicate UUID for stable ties. It adds one-based `rank` and `cumulativePercent = 100 * rank / N`.
- `summaries` contains `hardCount`, `logCount`, `logExcludedCount`, and `within10`/`within20`, each with `count`, `total`, `percent`. Cutoffs are inclusive and evaluated before display rounding. Empty denominators produce null percentages.

Exclusion precedence is missing parent, mismatched reference, missing element, exact-unit mismatch, censoring, invalid value, missing original result text, then both-zero undefined HARD. Any own BDL key excludes a result even if another importer supplied a substituted numeric value or malformed false flag. No DL/2, zero or detection-bound substitution occurs.

## Arithmetic and chart meaning

For finite nonnegative original `x` and duplicate `y`, both below the register's `1e12` bound and with positive sum:

`HARD (%) = 100 * abs(x - y) / (x + y)`

This is symmetric and half the absolute relative percent difference based on the pair mean. For example, 90 and 110 give HARD 10%. The definition and paired-chart application are described in [SRK's technical report, Appendix C, pp. 126–127](https://www.sec.gov/Archives/edgar/data/795800/000119312516604500/d200931dex991.htm). That report's project criteria are not universal acceptance rules for this product.

One zero gives HARD 100% and remains in HARD counts but is not eligible for log axes. Two zeros have undefined HARD and are excluded. Never add an epsilon or jitter to make zero values appear on a log plot.

`originalRelativeBand(x, fraction)` returns the two reference values `x*(1-fraction)` and `x*(1+fraction)` for `0 <= fraction < 1`. Label these **±percentage of original**, never percentage HARD: the upper 10%-of-original boundary at x=100, y=110 has HARD about 4.76%. These envelopes and the reported HARD cutoffs describe agreement; they are not pass/fail criteria. Computations use ordinary JavaScript finite-number precision and do not round before comparisons.

## Presentation boundaries

Label the scope **Import snapshot: records written by this import**. An import that leaves rows unchanged does not rewrite those rows into its batch; therefore this is not a complete-file, current-property or complete-laboratory-job report. Show snapshot history/rollback context from the loader manifest. Display HARD and log-scatter denominators separately, retain exclusions in an accessible table, and use the same analysis object for every displayed count.

Analytical method is not recorded, so do not describe these as method-controlled comparisons. Source-row order is useful for audit display but cannot support consecutive-run rules. CRM scores, blanks, configurable approval policies, UI charts and exports remain outside this slice.
