# Inspect a numeric column

Select a layer in the editor's **Data** controls, open **Inspect numeric
columns**, then choose a column. This view does not create classifications,
change styles, edit values or save anything. Closing it or changing layers
clears the choice. Replacing the layer's source also clears the choice.

The inspector counts each GeoJSON Point feature record once, including hidden
records and repeated IDs. It omits derived `_trace` records, MultiPoint records
and other geometries, with separate counts. It does not expand geometry into
samples or claim that records are validated or unique samples. Column discovery
reads all eligible Point records, including columns that first appear after
the first 500 records. Blank-only and empty-name columns remain inspectable.

The included values use the same strict plain-number parser as newly built
numeric classes: finite numbers and decimal/exponent strings. Missing or blank
values, text starting with `<`, `>`, `≤` or `≥`, and all other nonnumeric values
have separate, disjoint exclusion counts. No units, lab codes, sentinels or
detection-limit substitutions are inferred. For example, `-999` remains a
number while `<0.005` is excluded. The summary describes included column
values, not an estimate of the complete geochemical population.

Minimum and maximum are observed values. P10, P50 and P90 use nearest rank:
sort the included numbers ascending, then take one-based rank `ceil(p × n)`
for p = 0.1, 0.5 or 0.9. Ties remain; values are not rounded into nice legend
breaks. P50 for an even number of records is an observed value, not the average
of the middle pair. No numbers means no statistics table. The UI displays the
JavaScript numeric values without fixed decimal rounding, including tiny values
and large finite exponents.

The data reader loads and scans only when the section opens. It discovers
columns once per source object and computes/sorts once per source and column
selection, not on unrelated style/name renders. It unmounts on close. Inspection
uses the importer's shared 200,000-feature ceiling; more than 1,000 distinct
Point-record columns also produces an explicit refusal rather than silent
truncation. No source object is mutated. Existing classification policies,
renderers, exports and stored project schemas are unchanged.

Tests cover exact populations/ranks, extremes and limits, late/unusual keys,
exclusions, legacy classification preservation, closed-panel costs and stale
scope resets. Built desktop/mobile workflows cover keyboard opening, lazy
loading, long names, exact displayed values and unchanged project data through
a reload. This feature adds no database, dependencies or interpolation model.
