# Excel results tables (P2-7)

Results → Table format → Excel workbook (XLSX) downloads the current results and recipe notes in one sheet. The header and hole-ID column stay frozen. Saved recipes include their name/version; edits are explicitly unsaved. Current-assay provenance, skipped-interval warnings and capped-load limitations remain visible above the table. Notes follow the table, including cut-offs, dilution, prices/recoveries, detection-limit handling and true widths.

The workbook is a publication snapshot: cells are the calculator's formatted text, including trailing decimal places, leading-zero hole IDs and inclusion-row IDs. It contains no formulas or links and does not recalculate grades or confer approval. The Interval column uses the same wording as published figure callouts. CSV/TSV remains available for downstream analysis; the workbook does not contain a calculation model.

HTML and XLSX share `shared/drillResultsTable.js` for cells, provenance and notes. `write-excel-file` 4.1.1 (MIT) loads only when Excel is downloaded, uses the existing fflate dependency and returns a Blob. Excessively long Excel cells fail explicitly rather than being truncated. Download progress and failures are shown in Results. No database changes, production data access or map renderer changes.

Validation includes a real writer/reader round trip with canonical cells and figure wording; saved/draft provenance; warnings; formula-like IDs and hostile markup staying literal; oversized cells; a 2,000-result synthetic workbook; and actual built-app download checks on desktop and phone. Native Microsoft Excel/LibreOffice visual fidelity has not been manually checked. All fixtures are synthetic, not Tower drill data.

Measured plain/configured bundles: 1022.2/1089.4 KiB total gzip. The lazy writer adds about 16 KiB overall; shared async ZIP support adds about 0.5 KiB to editor/claims startup. Budgets retain about 0.3 KiB headroom. Homepage and 3D startup are unchanged.

PNG/PDF results-table exports remain separate unfinished P2-7 work. Tower artwork remains pending real drill data; the user has confirmed those files are unavailable.
