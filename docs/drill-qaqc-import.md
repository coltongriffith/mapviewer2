# QA/QC table mapper

`src/utils/drillQaqcImport.js` is a separate, pure adapter for the QA/QC sample/CRM register. It accepts the existing CSV/Excel string-table shape `{header, rows, lines?}`. It does not change the ordinary assay parser, upload a file, write records or infer laboratory conventions.

Exports:

- `QAQC_FIELDS`: sample/CRM field descriptions (`key`, `label`, `required`).
- `QAQC_SAMPLE_TYPES`: explicit supported type choices (`value`, `label`).
- `autoQaqcMapping(kind, header)`: reviewable header suggestions only. All measurement columns start deselected, with no inferred unit or sample type.
- `buildQaqcImport(kind, table, mapping)`: `{rows, lines, errors, errorCount, warnings}`. Errors contain physical `line` and `message`; configuration errors use `line: null`. Up to 50 error details are retained, with the full count. **Any nonzero errorCount must prevent server preview/commit**, even though individually valid rows are also returned.
- `parseQaqcValue(raw, {decimalComma})`: strict single-measurement parsing; primarily useful for tests or a cell preview.
- `qaqcJsonBytes(value)`: UTF-8 serialized JSONB byte count, including structural separator spaces; use it to check provenance as well as row requests.
- Limits: `MAX_QAQC_ROWS = 5000`, `MAX_QAQC_BYTES = 4000000`.

Mapping uses `columns: {field: header}`, optional explicit `constants: {lab_id, lab_batch_id, sample_type}`, `elements: [{column, element, unit, skip}]`, and `decimalComma: true|false`. A mapped column takes precedence over a constant, including when a row's cell is blank. This prevents quietly filling incomplete lab identity/type data. Element names and units are required and exact. A source column cannot supply two mapped fields or measurements.

Identifiers, units, row order and raw measurement strings retain their source spelling, including leading zeroes and surrounding whitespace. A plain value must be finite, nonnegative and below 1e12. Decimal comma is opt-in; thousands separators are not interpreted. `<0.005` becomes `values.Au = null`, `bdl.Au = 0.005`; recognized `BDL`, `ND`, `<DL` and `<LOD` tokens use `bdl.Au = true`. No limit substitution is made. Negative codes, over-range `>` values, empty cells and missing/insufficient-sample tokens are refused rather than coerced into measurements or BDL flags. Deselect an unavailable element or resolve the source data before importing.

Samples require an explicit type. Duplicate parent and standard CRM references are validated structurally; existence and exact-version checks remain authoritative on the server. Parents present in the same submitted file are refused so routine parents can be imported first. Optional intervals require a real hole ID and `0 ≤ From < To`; blanks and standards require no invented interval. CRM expected/SD are supplied numbers, with SD strictly positive; no value is derived from sample results.

Client request size accounts for UTF-8 text and PostgreSQL JSONB separator spaces. The UI must independently bound its batch provenance to 16 KiB and keep `lines` client-side; a 5,000-entry physical-line array does not belong in provenance. Missing physical lines fall back to a conventional one-header-row CSV count. This adapter does not claim permanent source-file attachment or original CRM numeric formatting retention: preserve source files/certificate references separately.

Focused tests cover censoring, missing values, unsupported numeric forms, decimal conventions, exact identifiers/raw text/order, physical CSV lines, explicit mappings/types/units, duplicate identities, parent prerequisites, CRM definitions, interval rules, safe dictionary keys and request limits. All example records are synthetic.
