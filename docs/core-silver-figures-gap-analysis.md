# Gap analysis: reproducing Core Silver's Touleary figures in Exploration Maps

Date: 2026-09-09 · Status update below, same day

Reference set: five news-release figures for the Touleary Property (Yukon) —
(1) property geology map, (2) Target-8, (3) Target-4, (4) Discovery Zone /
Target-1, (5) Touleary target-areas overview. All five share one house style:
a bordered map frame with UTM tick labels on all four edges, a right-hand
panel (logo, figure title, grouped legend, scale bar, `NAD83 - Z07N`), and a
map body built from a hillshade, a geophysics raster, classed geochemistry
points, dashed target polygons, drill collars with traces, and callout boxes.

## Verdict

Exploration Maps cannot reproduce any of the five to the published standard
today. The geology map (figure 1) is closest, at roughly two thirds of the way,
and only with workarounds. The four target maps are blocked by four missing
capabilities, not by polish: raster import, classed symbology, drill traces,
and a coordinate frame that works outside the NI 43-101 template.

Where the app already does better than the figures: consistent panel layout
and typography, logo and brand kit, callout auto de-collision, a locator inset
(none of the five has one), automatic data credits, live registry claims for
the property outline, and PNG/SVG/PDF export up to a 12000px long edge.

## What each figure needs, and what exists

Legend: **Yes** = works as needed · **Partial** = reachable with a workaround ·
**No** = not possible without new code.

| Element in the figures | Status | Evidence |
|---|---|---|
| Greyscale hillshade base | No | Only six Esri basemaps; "Terrain" is `World_Topo_Map`, a labelled topo raster, not a hillshade (`src/utils/basemapConfig.js:30-75`) |
| Geophysics (magnetics) colour raster with partial coverage | No | No GeoTIFF, world-file, or `imageOverlay` path; uploads are vector only (`src/components/UploadPanel.jsx:3`, `src/utils/importers.js:201`) |
| Custom WMS/XYZ layer (e.g. YGS geology or mag service) | No | Overlays are a frozen four-entry config (`src/utils/referenceOverlayConfig.js`); no user URL field |
| Contour lines | No | No contour source; only baked into the topo raster |
| Bedrock geology units (5 colours) | Partial | One fill colour per layer, so each unit must be split into its own layer before import. No unique-value renderer for imported layers |
| Dashed polygon outlines (vent complex, target areas) | Partial | `dashArray` renders everywhere but the only UI path is assigning the Target Areas or Faults role (`src/mapPresets.js:30,50`) |
| Stroke width (bold property outline, bold 2026 targets vs thin others) | No | No control writes `style.strokeWidth` on a layer; per-feature polygon styling is ignored by the editor (`src/components/MapCanvas.jsx:307-314`) though honoured on export |
| Three target-polygon styles in one legend group | Partial | Requires three separate layers |
| Soil geochemistry classed by Cu ppm (4 classes, colour + size) | No | No graduated or class-break symbology anywhere in `src/`. Workaround: pre-split the CSV into one layer per class |
| Hand-pit classes as squares (4 to 6 classes) | No | Same gap; square marker shape exists per layer |
| Crossed-hammers "Discovery Zone" symbol | Partial | Custom icon upload per point layer works on the map (`src/App.jsx:5080-5105`), but the legend swatch ignores it and shows a circle |
| Drill collars | Yes | Point layer with `drillhole` marker shape |
| Drill traces (surface projection from azimuth/dip/length) | No | The column mapper offers azimuth and dip but discards them when it builds the mapping (`src/components/ColumnMapperModal.jsx:47-52`); `loadCSV` guesses only x/y/id/elev; there is no length role; only `Point` geometry is emitted (`src/utils/importers.js:418-437`) |
| Intercept callouts (bold hole ID + 1 to 3 result lines, white rounded box, leader) | Partial | Boxed callout has title + one subtext line, leader without arrowhead (`src/components/CalloutsOverlay.jsx`) |
| Black banner callouts ("Untested Strike-Length >1.5km") | Yes | Boxed callout with custom `background` and `textColor` |
| Strike-length bracket line | Partial | Distance line has endpoint dots and a forced length label; no plain bracket |
| Property outline from Yukon quartz claims | Yes | GeoYukon claims search returns vectors (`api/claims.js:77-81`) |
| Legend section headings (Mineral Tenure, Bedrock Geology, Soil Geochemistry…) | No | Items carry a `group` but every renderer collapses to one unheaded list (`src/App.jsx:494-496`, `src/export/renderScene.js:481-483`) |
| Legend reorder | No | Order fixed by role order; no drag or `legendOrder` |
| Dashed polygon legend swatch | Partial | Dashed in the editor, solid in PNG/SVG export (`src/export/renderScene.js:543,586`) |
| Right-hand panel with logo, title, legend, scale bar | Yes | `side_panel` template |
| Projection/datum text (`NAD83 - Z07N`) in the panel | No | `layout.projectionName` is displayed only by the NI 43-101 title strip (`src/templates/technicalReportTemplate.js:357`); footer text is the workaround |
| UTM coordinate frame with edge ticks and labels | Partial | Exists, but gated to `ni_43101_technical` in the editor and both exporters (`src/App.jsx:6490`, `src/export/renderScene.js:1828,2494`) and cannot be combined with the side panel |
| North arrow | Yes | `NorthArrow.jsx` |
| Scale bar with two labelled steps (2.5 / 5 km) | Partial | `ScaleBar.jsx` draws a single bar with one nice-number label |
| Crisp export of the raster base | Partial | Exporter upscales on-screen 256px tiles rather than fetching at export zoom (`src/export/renderScene.js:99-146,1905-1920`) |
| SVG export of the side panel | Partial | Panel elements export but the rail background does not (`renderScene.js:2494-2527`) |

## Why the four target maps fail

1. **No raster layer type.** The magnetics image is the visual backbone of
   figures 2 to 5. The app's own docs recommend digitising anomalies as
   polygons in QGIS instead. That loses the texture that makes the target
   maps persuasive.
2. **No classed symbology.** Every geochemistry map in the set is a graduated
   point map. Splitting a CSV into four layers per element is possible but
   the legend then shows four unrelated rows, and no size ramp is available
   per class without editing each layer.
3. **No drill traces.** Figures 3 and 4 show collars with trace lines.
   Collar-only maps read as untested ground.
4. **Coordinate frame is template-locked.** The UTM tick frame is the
   NI 43-101 template's feature; the side-panel layout the figures use has
   no frame and no projection text.

## What needs to be done, in priority order

1. **Georeferenced raster import** (large). Accept GeoTIFF (geotiff.js) and
   PNG/JPG + world file; decode to a canvas, reproject bounds to WGS84 via
   proj4 (already a dependency), render as `L.imageOverlay` with an opacity
   slider, and draw it in `renderScene.js` for PNG and SVG. Add a
   user-supplied WMS/XYZ URL field on top of the existing overlay config
   (`MapCanvas.jsx:157-159` already branches WMS vs XYZ). Also bring the
   export path to fetch tiles at export zoom so the base is not upscaled.
2. **Hillshade basemap** (small). Add Esri `Elevation/World_Hillshade` as a
   `BASEMAPS` entry; same host, CORS-enabled, so export works unchanged.
   Optionally offer it as a blend layer under any basemap.
3. **Classed and categorical symbology** (medium-large). Per-layer
   `classification: { field, mode: 'graduated' | 'categorical', classes:
   [{ max | value, color, size, shape, label }] }`. Render in `MapCanvas.jsx`
   and `renderScene.js`; emit one legend row per class by extending the
   existing per-shape split (`layer.id::shape` ids in
   `technicalResultsTemplate.js:310-321`). Categorical mode covers geology
   units in one layer; the nearby-claims-by-owner code is the pattern to lift.
4. **Style controls and editor parity** (small). Stroke width slider, dashed
   toggle, and opacity for point layers. Make the editor honour per-feature
   overrides for polygons and lines the way export already does.
5. **Legend groups and swatches** (small). Un-stub `renderLegendGroups` and
   `groupLegendItems` (the `group` field is already populated), restore the
   heading height allowance in the three templates, draw dashed polygon
   swatches in both exporters, show custom icons in the legend, and add
   drag reorder.
6. **Coordinate frame and projection text for all templates** (medium).
   Move the tick frame behind a `layout.showCoordinateFrame` flag, add a
   projection/datum text element to the side panel, and replace the three
   duplicated hand-rolled Transverse Mercator implementations with proj4 so
   NAD83 zones label correctly and cross-zone maps do not drift.
7. **Drill traces** (medium). Add azimuth, dip, and length roles end to end:
   `loadCSV` detection, the column mapper (which currently drops its
   azimuth/dip picks), and normalised `_azimuth`/`_dip`/`_length` properties
   from `csvToGeoJSON`. Then build a `LineString` surface projection from
   collar, azimuth, dip, and length, render collar plus trace as one layer,
   and allow multi-line intercept subtext in callouts.
8. **Annotation polish** (small). Multi-line callout body, a "banner" callout
   preset (black box, white bold text), a bracket line with end ticks and no
   label, and optional arrowheads on leaders.
9. **Two-step scale bar** (small). Draw a half-step division with both labels.
10. **SVG side-panel background** (small). Port `drawSidebarPanelCanvas` to
    the SVG path.

Items 2, 4, 5, 9, and 10 are each a day or less and would lift figure 1 to
parity. Items 1, 3, 6, and 7 are what make figures 2 to 5 reproducible.


## Status (2026-09-09, end of day)

Everything in the priority list except two deferred sub-items landed on
`main` the same day, one pull request per item:

| # | Item | PR |
|---|------|----|
| 2 | Hillshade basemap | #206 |
| 4 | Outline width, dashed toggle, point opacity, per-shape styling, editor/export parity | #207 |
| 5 | Legend headings, reorder, dashed and icon swatches | #208 |
| 6 | Coordinate frame and projection text on every template; one UTM tick computation | #209 |
| 3 | Colour by attribute: numeric ranges and unique values, one legend row per class | #210 |
| 7 | Drill traces from azimuth, dip and length; orientation columns kept end to end | #211 |
| 8, 9, 10 | Multi-line callouts, banner preset, arrowheads, bracket lines, two-step scale bar, SVG rail background | #212 |
| 1 | Georeferenced images (world file or typed edges, lat/long or UTM) and custom tile/WMS layers | #213 |

Still open:

- **GeoTIFF decoding.** A `.tif` must be exported to PNG/JPG with a world
  file first (QGIS: Export → Save As, with "Create world file"). geotiff.js
  would add roughly 90 kB gzip to the total bundle budget.
- **Basemap tiles at export resolution.** The exporter still upscales the
  on-screen tiles. Vectors, rasters, legends and frames are crisp at any
  size; the basemap softens above 2× on services capped at zoom 16.
- **Contour lines** as a separate layer. Import them as vectors (generated
  from a DEM in QGIS) or use the Terrain basemap.

With these in, figure 1 (geology map) is reproducible as published, and
figures 2 to 5 are reproducible once the magnetics grid is exported from
the geophysics package as an image with a world file.
