# Source coordinates during collar import

The source coordinate field now offers searchable presets for WGS84 longitude/latitude and UTM (north and south), NAD83 longitude/latitude and UTM zones 1–23N, and NAD27 longitude/latitude and UTM zones 3–22N. This is a limited catalog, not a search of the entire EPSG registry. Other exact EPSG codes remain accepted as before; their preview is unavailable. NAD83(CSRS), other realizations and local grids are not silently treated as NAD83.

The file CRS is distinct from the property's CRS. A mismatch is explained without blocking previously permitted imports. Existing automatic suggestions remain suggestions: the UI asks the user to confirm them against the source file, because latitude/longitude headers do not establish a datum. Applying a column template retains the current file's source choice, including a blank choice.

An optional preview unprojects the first five valid collar rows to geographic coordinates on the **same source ellipsoid and datum**. NAD27 preview coordinates are labeled NAD27, never WGS84 or shown on a WGS84 map. The projection definitions use the same ellipsoid on both sides and `+datum=none`; no approximate datum shift is requested. The preview identifies implausible axes/ranges but cannot establish whether a plausible CRS is correct or survey-accurate. Standard UTM areas are guidance, not a complete area-of-use check.

X, Y, Z and the source CRS remain the stored collar values. The preview never substitutes its output into the import. On explicit selection, the existing batch mapping retains a small `coordinateSource` object (`version: 1`, source `crs`, `operation: preserve-source`, `axisOrder: xy`). Legacy mappings and the canonical collar row shape are unchanged. The recorded numeric values preserve source coordinates, not original text formatting or missing-value spellings.

## Converting to the property CRS (P2-6)

When the file and property CRSs are both in the catalog and differ, the importer offers to convert X/Y to the property CRS (elevation is not changed). Each converted collar carries `x_src`, `y_src`, `crs_src` and a `transform` object (method, grid file and sha256, library, from/to), stored by migration `20261102100000_drill_collar_source_coords.sql`; the batch mapping's `coordinateSource` gains `operation: convert`, `target`, per-method counts and the grids used.

- **NAD27 ↔ NAD83**: NTv2 grid shift chosen by the property's jurisdiction: Canadian provinces/territories use NRCan's national NTV2_0 grid; US states use NOAA NADCON (CONUS, or Alaska for `us-ak`). The grids are served same-origin from `public/grids/` and fetched (and checksum-verified) only when a conversion needs them; no startup bundle or CSP change. No grid is guessed for a property without a jurisdiction.
- **Fallback**: a point outside grid coverage, a grid that cannot be loaded, or no jurisdiction uses the NIMA TR8350.2 regional mean 3-parameter shift (Canada `-10,158,187`, CONUS `-8,160,176`, Alaska `-5,135,172`). Against the grids on a 0.3° lattice it is off by up to 47 m (median 5–12 m), so the importer warns "up to ~50 m" and the check stays disabled until the user acknowledges it. Plain proj4 has no NAD27 shift without grids.
- **NAD83 ↔ WGS84** (and the WGS84 leg of NAD27 ↔ WGS84) is proj4's default null transformation, warned and acknowledged as up to ~2 m. Same-datum changes (zone, geographic ↔ UTM) are projection only.
- If the dry run reply lacks `source_coordinates` (the migration is not applied), the importer switches back to preserve-source with a notice rather than letting the older RPC silently drop the originals.

In the import diff `x_src`, `y_src` and `crs_src` count like X/Y (a different source is a new version); `transform` is ignored, so the same numbers from a newer library stay unchanged.

Accuracy (tests/datum-convert.test.js): proj4js with the shipped `.gsb` files matches PROJ 9.8.1 on the original CDN GeoTIFFs within 0.05 mm on ~42,000 lattice points; NGS datasheet stations (NAD 27 → NAD 83(1986)) agree within 0.07 m in Kansas and Nevada. NGS-published Canadian stations agree within 2.5 m because their NAD 27 values come from the US adjustment, not NRCan's. Provincial grids (for example Ontario's or Quebec's), NAD83(CSRS) realizations and local-grid fitting remain future work.

### Grid files

`scripts/build-datum-grids.mjs` rewrites the PROJ CDN GeoTIFFs as standard NTv2 without changing values, one file per top-level grid: `ca_nrc_ntv2_0.tif` (sha256 `1c719963…`, NRCan, Open Government Licence – Canada; attribution in `public/grids/README.txt`) into west/east/north/arctic, and `us_noaa_conus.tif` (`44611d82…`) and `us_noaa_alaska.tif` (`9d29d595…`), NOAA, public domain. Sizes: 0.5–8.2 MB each, 16 MB in total; a BC property loads the 3.2 MB west grid.

## Reference and verification

- [Proj4js axis order and projection API](https://proj4js.org/): projected X/Y and geographic longitude/latitude; definitions are passed directly so other modules' registered CRS definitions cannot affect this preview.
- [PROJ UTM specification and published examples](https://proj.org/en/stable/operations/projections/utm.html): tests use the 32N and 59S published control pairs at centimetre rounding. PROJ's default GRS80 and WGS84 differ below that rounding at these examples.
- [EPSG NAD27 / UTM zone 10N](https://epsg.org/crs_26710/NAD27-UTM-zone-10N.html): source datum, easting/northing axes and metre units.
- Tests cover north/south control pairs, NAD27/NAD83/WGS84 same-ellipsoid round trips, axis/range errors, unsupported codes, unchanged legacy import rows and source retention when applying templates. The configured browser flow checks desktop and phone preview plus identical original values in dry-run and commit requests against isolated fixtures.

Fixtures are synthetic; this feature does not supply missing Tower drill positions.
