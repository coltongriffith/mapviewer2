# Source coordinates during collar import

The source coordinate field now offers searchable presets for WGS84 longitude/latitude and UTM (north and south), NAD83 longitude/latitude and UTM zones 1–23N, and NAD27 longitude/latitude and UTM zones 3–22N. This is a limited catalog, not a search of the entire EPSG registry. Other exact EPSG codes remain accepted as before; their preview is unavailable. NAD83(CSRS), other realizations and local grids are not silently treated as NAD83.

The file CRS is distinct from the property's CRS. A mismatch is explained without blocking previously permitted imports. Existing automatic suggestions remain suggestions: the UI asks the user to confirm them against the source file, because latitude/longitude headers do not establish a datum. Applying a column template retains the current file's source choice, including a blank choice.

An optional preview unprojects the first five valid collar rows to geographic coordinates on the **same source ellipsoid and datum**. NAD27 preview coordinates are labeled NAD27, never WGS84 or shown on a WGS84 map. The projection definitions use the same ellipsoid on both sides and `+datum=none`; no approximate datum shift is requested. The preview identifies implausible axes/ranges but cannot establish whether a plausible CRS is correct or survey-accurate. Standard UTM areas are guidance, not a complete area-of-use check.

X, Y, Z and the source CRS remain the stored collar values. The preview never substitutes its output into the import. On explicit selection, the existing batch mapping retains a small `coordinateSource` object (`version: 1`, source `crs`, `operation: preserve-source`, `axisOrder: xy`). Legacy mappings and the canonical collar row shape are unchanged. The recorded numeric values preserve source coordinates, not original text formatting or missing-value spellings. No new database migration or RPC is needed.

Actual converted imports, source-coordinate columns, local-grid fitting, NTv2/NADCON grid handling and CSRS realization-specific transformations remain future work. The current RPC drops extra collar fields and caps the mapping at 64 KiB; using it to store per-row originals would not be a reliable conversion audit trail.

## Reference and verification

- [Proj4js axis order and projection API](https://proj4js.org/): projected X/Y and geographic longitude/latitude; definitions are passed directly so other modules' registered CRS definitions cannot affect this preview.
- [PROJ UTM specification and published examples](https://proj.org/en/stable/operations/projections/utm.html): tests use the 32N and 59S published control pairs at centimetre rounding. PROJ's default GRS80 and WGS84 differ below that rounding at these examples.
- [EPSG NAD27 / UTM zone 10N](https://epsg.org/crs_26710/NAD27-UTM-zone-10N.html): source datum, easting/northing axes and metre units.
- Tests cover north/south control pairs, NAD27/NAD83/WGS84 same-ellipsoid round trips, axis/range errors, unsupported codes, unchanged legacy import rows and source retention when applying templates. The configured browser flow checks desktop and phone preview plus identical original values in dry-run and commit requests against isolated fixtures.

Fixtures are synthetic; this feature does not supply missing Tower drill positions.
