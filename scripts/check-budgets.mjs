// Performance budgets (audit P1-22, P1-23).
//
// Bundle size and hero imagery regress silently — nobody notices 40 kB at a
// time until the editor takes eight seconds on a field connection. This fails
// the build when a budget is exceeded, so growth is a deliberate decision
// rather than an accident.
//
// Budgets are set slightly above today's measured values: the point is to stop
// regression, not to force an immediate rewrite. Lower them as work lands.

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIST = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../dist', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));

const KB = 1024;

const BUDGETS = {
  // Largest chunk is now the editor (~124 KiB); tighten the old 191.
  // 135 → 136 (Sept 2026 review): the configured editor chunk was 20 bytes
  // under 135 and the data-loss fixes that landed in it — save-conflict
  // revisions surviving a reload, re-pointing the open map after sign-in
  // migration, pans kept out of undo, title/subtitle resync — add ~0.3 KiB.
  // 136 → 139 (Sept 2026 point-size / export-agreement work): the size
  // precedence controls (base size, class/point override notes, scale-all),
  // Zoom to layer, and callout obstacle handling add ~2.1 KiB to the editor
  // chunk; the shared symbol geometry replaced the old icon builder.
  // 139 → 141: placed logo/image markers (upload, width, opacity, backing,
  // replace) and the main logo's opacity control live in the editor chunk.
  // 141 → 143: fixed-size scaled stage, per-ratio view persistence, legend
  // heading rename / move-to-group / drag reorder (Sept 2026).
  // 143 → 144: the free full-resolution export offered when a PNG hits the
  // pixel cap (Oct 2026); its dialog is lazy, the export wiring is not.
  // 144 → 146: company workspaces (Oct 2026). The pages are a lazy chunk; the
  // editor keeps the routes, the property chip and view-only save guard for
  // company maps, and the personal / company switcher in the account menu.
  // 146 → 147: hatch/cross/dot legend swatches (Oct 2026). The shared pattern
  // description (shared/fillPattern.js), the patterned area swatch and the
  // pattern-spacing control land in the editor chunk; ~0.6 KiB.
  // 147 → 148: callout leader routing (Oct 2026). The scorer is a lazy chunk
  // (loaded only for scored-layout projects, Auto-arrange and export); the
  // editor keeps the shared leader geometry the overlay must draw (elbow,
  // curve, anchor mark), the Auto-arrange action, the overlap list and the
  // leader/anchor-mark controls; ~1.0 KiB.
  // 148 → 148.3 (Oct 2026, measured 147.99 configured): hole-ID labels at their collar (#307) pass the layout
  // version and callout font to the lazy scorer and draw a pushed label's leader (~+0.07 kB in App), which left
  // 6 B of the ±20 B chunk-hash churn.
  // 148.3 → 148.6 (Oct 2026, export options, measured 148.32 configured, ~+0.33 kB): legend height and note-in-legend
  // sizing must stay in App because the editor's live legend box uses the same template code as the exporter, plus
  // the lazy ExportBackground hook (owner-requested 2D transparent/standalone).
  // 148.6 → 148.9 (Oct 2026, 2D bugs B1–B4, measured 148.63 configured, +0.31 kB over main's 148.32): the UTM frame
  // ticks solved per edge (coordinateFrame.js, drawn live by the editor's overlay, so not lazy; ~+0.1 kB), and the one
  // map name (utils/mapName.js) in the header, saves and Duplicate, Save As's dialog hook (the dialog is a lazy
  // NameDialog chunk) and the dashboard/home searches that start a new map (~+0.2 kB).
  // 148.9 → 149.1 (review fix, measured 148.82): no UTM ticks on a frame wider than a zone (a world view produced
  // ~140 000 crossings in ~1.6 s), the interval picked from each edge's projected range, and at most 50 crossings per
  // edge (~+0.19 kB; the live overlay needs it, so not lazy).
  // 149.1 → 150.6 (Oct 2026, 2D Studio style merged over B1–B4, measured 150.29 configured, +1.47 kB over 148.82): what the editor
  // must know synchronously to place Studio's cards — their zone sizes (utils/studioLayout.js: the title card's rows,
  // the scale-north card, ~0.55 kB), the Studio theme tokens and picker entry (~0.15 kB), the two new north arrow
  // styles (rose, split; ~0.2 kB, offered in every theme's picker) — and the hand-off to the lazy StudioCard and
  // StudioControls chunks in the stage and inspector (~0.35 kB), the frame ticks' Studio mono font and each
  // callout's colour as a CSS variable for Studio's card opacity (~0.2 kB). The cards' layout and painting are lazy.
  // 150.6 → 150.7 (Oct 2026, 3D figures in the account and maps from property data merged over Studio, measured
  // 150.40 configured, +0.11 kB over main's 150.29): the editor takes a file handed over by a property page ("Start a map from a file", "Use in map")
  // and imports it once the new property map is open. It has to run in App, where the import lives; the
  // property page and the dashboard's 3D section are lazy chunks.
  // 150.7 → 151.4 (Oct 2026, 2D drill plan, measured 151.11 configured, +0.62 kB over main's 150.49): what the editor
  // must hold synchronously for an opt-in drill plan (project.drillPlan) — the Drill plan section in the Annotate tab
  // and its hand-off to the lazy DrillPlanControls, the stage's hand-off to the lazy DrillPlanOverlay, the plan's
  // update/remove setters and the hook that loads its legend rows (utils/useDrillLegend.js). Reading the files,
  // laying out the plan, its legend rows and its painting are all lazy.
  // 151.4 → 151.8 (Oct 2026, import a company figure merged over the 2D drill plan, measured 151.45 configured, +0.33 kB over
  // main's 151.12): the editor's hand-offs only: the Data step's "Import a company figure…" link, the dialog and the
  // inspector's credit row (lazy FigureImport and FigureLayerControls chunks), "georeference it by points instead" from
  // the image placement dialog, and no "Re-place image…" for a figure placed by its corners. The fit, the tracer and
  // the layers are lazy.
  // 151.8 → 152.5 (Oct 2026, claim-search intent, measured 152.13 configured, ~+0.6 kB over main's 151.5): the
  // registry deep link's q= and mode=company|number (the tab to open the lazy search in) and mode=area, which opens
  // Nearby Claims at a lat,lng (or a province view to pick a point from) and runs the 25 km search once the map exists.
  // It has to live in App, where the intent links are read and the nearby search runs; the search itself is lazy.
  // 152.5 → 152.7 (Oct 2026, 2D labels and geology styling merged over claim-search intent, measured 152.42 configured,
  // +0.29 kB over main's 152.13; on its own branch 151.8 → 152.1, measured 151.77, +0.32 kB over 151.45): the
  // editor's hand-offs only: the inspector's "Geology & labels" section and the Style tab's basemap wash (lazy
  // GeoStyleControls and WashControls chunks), the stage's zones and legend rows passed to the map for label
  // placement, and each legend row's style (lazy FxSwatch chunk for a styled row). The styling, its layout and its
  // painting are lazy.
  // 152.7 → 153.1 (Oct 2026, 2D export package, Tower v3 items 38/40/42, measured 152.81 configured, +0.30 kB over
  // main's 152.51): the editor's hand-offs only: the watermark band's default (on for the free plan and sample maps)
  // and its options passed to the exporters, the "layers" export (format gate, pixel cap, lazy exportLayers import)
  // and the lazy ExportExtras chunk in the Export step. The band, the layers and the package are lazy.
  maxJsChunkGzipKb: 153.1,
  initialJsGzipKb: 75,
  initialAuthJsGzipKb: 135,
  // The former configured check omitted VITE_ADMIN_EMAIL, which pruned the
  // live dashboard: real baseline total was 824.8, not 796.8 KiB. Server-side
  // role checks now include all admin code in both builds. Growth reports and
  // split modules add ~12 KiB overall; first-load graphs below shrink sharply.
  // Figure-parity work (Sept 2026): attribute classification, the coordinate
  // frame on every template, legend headings and ordering, per-shape styling,
  // drill traces and raster overlays. All of it lives in the editor chunk and
  // the shared export renderer, so the totals and the editor route carry it;
  // the homepage and admin budgets are unchanged.
  // 870 → 875: the same, plus SVG font embedding and shared export label
  // geometry in the export renderer.
  // 875 → 876: the locator inset detects its province/state when a map arrives
  // without one (MCP connector maps), and the Inset Style control reflects
  // map-tile locators (Oct 2026).
  // 876 → 877: the lazy /oauth/consent page for MCP account sign-in.
  // 877 → 878: Download PNG on shared maps (the MCP png_download_url).
  // 878 → 879: patterned legend swatches (shared/fillPattern.js) and the property data library client.
  // 879 → 884 (measured 883.2): 2D callout leader routing (#291, lazy scored layout + shared leader geometry) and Add Published Results (lazy reader + button).
  // 884 → 891 (measured 890.4): the opt-in publication check (F3 part 1). All of it is lazy and loads only when
  // the check is ticked: export/preflight.js (~4.2 kB), the findings dialog (0.8 kB) and shared/figureDiagnostics.js
  // (0.8 kB); the export renderer gains the per-export context and structured findings (~1 kB). The editor chunk
  // keeps only the toggle and the hand-off (~0.4 kB).
  // 891 → 891.0 (Oct 2026, after the /3d trim; measured 890.7): lowered to what ships, plus 0.3.
  // 891.0 → 894.0 (Oct 2026, measured 893.7): the shared figure style (shared/figureStyle.js: versioned spec and
  // its validation) and the brand kit's style-only / full-template apply with the 2D and 3D adapters
  // (shared/brandKit.js), one 2.5 kB chunk shared by the editor and /3d's lazy typography adapter.
  // 894.0 → 894.1 (Oct 2026, measured 894.06): the stale-chunk guard in the entry (src/utils/preloadGuard.js:
  // reload once after a deploy, or with unsaved work a notice and lazyGuarded parts that render a note
  // instead of unmounting the editor), ~0.35 kB in the main chunk; App itself shrank ~10 B.
  // 894.1 → 904.5 (Oct 2026, drill database 2A, measured 904.14 after merging round 5C): the property page's Drill data tab, one lazy
  // chunk (DrillPanel.jsx + utils/drillDb.js, ~9.8 kB: CSV mapping with saved templates, the import checks, the
  // dry-run diff, commit and the import history with Roll back), fetched only when the tab opens; the
  // workspace chunk gains the tab and its lazy hook (~0.3 kB). App and the homepage are unchanged.
  // 904.5 → 905.2 (Oct 2026, measured 904.87): the drill CSV reader refuses broken files (an unclosed quote, a
  // row that does not match the header) naming the line, keeps each row's file line, and lists every column as
  // an element to tick (~0.7 kB, all in the lazy drill chunk).
  // 905.2 → 914.3 (Oct 2026, drill database 2C, measured 914.00): the Drill data tab's Results section, one lazy chunk
  // (ResultsPanel.jsx with shared/drillResults.js and its own copy of the intercept and metal-equivalent maths,
  // ~8.9 kB: the recipe form, the release table with composites split where dilution would take them below the
  // cut-off, copies, CSV and the published-results export), fetched only when
  // "Show results" is pressed; the drill tab chunk gains the section and its lazy hook (~0.34 kB). App, the homepage
  // and /3d are unchanged (App +7 B and /3d page +0.05 kB of chunk-hash churn and the shared run finder).
  // 914.3 → 914.5 (measured 914.16): components averaged over the equivalent's own samples, the reload on import
  // and roll-back, and the cut-off tolerance (review fixes, all in the lazy results chunk).
  // 914.5 → 915.6 (Oct 2026, measured 915.31 configured / 848.21 plain on top of drill database 2C): 2D hole-ID
  // labels at their own collar (layoutAlgorithm 3, #307). The rules are in the lazy scorer (utils/calloutScorer.js,
  // ~+0.9 kB: ID labels measured in the callout font and sized to it, tried beside their collar, a leader when pushed
  // out, the ambiguity check, the crowded-first retry, and placed labels kept clear of intercept cards); the editor
  // chunk only passes the layout version and font and draws a pushed label's leader (~+0.07 kB).
  // 915.6 → 917.1 (Oct 2026, export options merged over drill database 2B and #307, measured 916.80): /3d's
  // transparent background, drop shadow toggle and Map use (+0.6 kB on the page, mapuse.js lazy; see threeDJsGzipKb)
  // and the 2D export options: the footer note always exported (its wrapping and the free-strip fallback in the lazy
  // renderScene chunk), Standalone's note in the legend, the fitted legend for new maps, the blank-basemap transparent
  // toggle (a lazy ExportBackground chunk) and the Map use and Fit controls (the lazy LegendEditor chunk).
  // 917.1 → 918.3 (Oct 2026, 2D bugs B1–B4, measured 917.98, +1.2 kB): the App code in maxJsChunkGzipKb above, the
  // lazy NameDialog chunk (0.65 kB: Save As and the legend's new heading, in place of window.prompt), and the
  // dashboard's Duplicate naming and opening the copy and the legend editor's dialog hook (~0.07 kB each).
  // 918.3 → 918.5 (measured 918.2): the tick bounds in maxJsChunkGzipKb above.
  // 918.5 → 933.5 (Oct 2026, 2D Studio style merged over B1–B4, measured 933.1, +14.9 kB): utils/studioCards.js (the Studio cards as primitives
  // and their canvas/SVG painters, a 6.5 kB chunk shared by the exporter and the stage), the lazy StudioCard (2.9 kB)
  // and StudioControls (1.9 kB) chunks, the renderer's Studio branches, legend/callout shells, label halo and font
  // weights (+1.5 kB in the lazy renderScene chunk), and App +1.47 kB as maxJsChunkGzipKb above.
  // 933.5 → 938.8 (Oct 2026, 3D figures in the account merged over Studio and round 5E, measured 938.48, +5.4 kB
  // over main's 933.1): all of it lazy. The dashboard's
  // 3D figures section (FiguresSection.jsx, 2.8 kB: tiles, search and sort, rename dialog, duplicate, move to a
  // property, delete) and its client (utils/figures.js, 1.7 kB: list, rename, soft delete, duplicate with the
  // files copied, the editable properties) load with the dashboard, never with the editor; the account page's 3D
  // count (+0.2 kB), the property page's "Start a map from a file" and "Use in map" (+0.2 kB), /3d's dashboard link
  // and ?property= first save (+0.1 kB in the lazy account client) and the editor hand-off in App (+0.16 kB).
  // 938.8 → 943.8 (Oct 2026, admin 3D usage merged over the account's 3D figures and the drill crew, measured 943.46,
  // +4.98 kB over main's 938.48): the admin "3D & sharing" tab (a lazy ThreeDTab chunk, ~3.1 kB), its metric help
  // and helpers in admin/metrics.js (~0.9 kB, read by the Overview too), the 3D block in the Users drawer, and /3d's
  // usage events (track.js, ~0.5 kB, lazy). The app's /api/track sender moved to utils/trackCore.js so /3d shares it
  // without supabase-js; as its own chunk it costs ~0.3 kB of chunk overhead in the homepage and editor routes (see
  // editorAuthJsGzipKb).
  // 943.8 → 945.0 (Oct 2026, production errors merged over admin 3D usage, measured 944.7, 943.5 on main): the stale-chunk
  // recovery (shared/chunkErrors.js, the retry, the update page and the unhandled-rejection path in the entry, +0.9 kB on
  // the homepage), the Leaflet renderer fixes (in vendor-leaflet) and /3d's error reporting (threeDJsGzipKb).
  // 945.0 → 946.4 (Oct 2026, marketing refresh merged over the production-error fixes, measured 946.0, +1.3 kB over main's
  // 944.7): the homepage's "New in Exploration Maps" section (3D figures, Studio, sharing, workspace) in its own lazy
  // LandingNew chunk (~1.2 kB with its alt texts and copy), so the homepage's initial JS and its budget are unchanged
  // (+0.1 kB measured for the section heading and the guarded lazy hand-off); the editor route is unchanged.
  // 946.4 → 969.9 (Oct 2026, 2D drill plan, measured 969.6, +23.6 kB over main's 946.0): all of it lazy but App's
  // +0.6 kB (maxJsChunkGzipKb above). The plan's layout and primitives (utils/drillPlan.js, 7.0 kB, loaded by the
  // stage and the exporter only for a map with a plan), its controls and file reader (DrillPlanControls with
  // utils/drillPlanData.js, 8.9 kB), the stage overlay (1.9 kB), its colours and legend rows (1.5 kB), the
  // exporter's hook (+0.5 kB in renderScene) and the polyline/rotation painters (+0.3 kB in studioCards and
  // StudioCard); drillDb (6.7 kB), desurvey (0.6 kB) and sectionGeometry (1.0 kB) are now chunks shared with the
  // drill panel and /3d's lazy sections and min-curvature rather than copies inside them (-7.3 kB there).
  // 969.9 → 971.5 (Oct 2026, drill plan review: Fit to plan, the panel's hidden list, section ends kept clear of the
  // panels, the larger pad tag, assay tables merged; measured 971.2): all in the lazy drillPlan and controls chunks.
  // 971.5 → 973.0 (Oct 2026, 3D round 5G merged over the 2D drill plan (5a7e0dbf), measured 972.7, 971.2 on main; on its
  // own branch 946.4 → 947.8, measured 947.5 over 946.0): the watermark band (src/export/watermarkBand.js,
  // ~1.5 kB: the Exploration Maps mark, wordmark, review status and "Prepared for" line under an export), shared so the
  // 2D exporter can use it later; /3d imports it only for an export that asks for the band, so it counts here, not in
  // the /3d page. Nothing else moves.
  // 973.0 → 990.8 (Oct 2026, import a company figure merged over the drill plan and round 5G, measured 990.5, +17.8 kB over
  // main's 972.7): all of it lazy. The dialog (FigureImport.jsx with utils/georef.js, utils/figureImport.js and
  // utils/figureMargins.js, 12.6 kB: the image kept as a JPEG, or WebP/PNG with alpha once its blank margins or a crop
  // are hidden; points and grid labels fitted as a similarity or affine with residuals in metres; the satellite map for
  // picking and previewing; colour samples; the credit; a re-fit reconciled with the layers traced before) and the
  // tracer's Web Worker (figureTrace.worker.js, 2.9 kB, fetched on the first Trace) load only when the dialog opens;
  // the turned-image overlay (figureOverlay.js, 0.7 kB) only for a map with a placed figure; the inspector's credit
  // row (0.7 kB) only for a layer made from one. App as maxJsChunkGzipKb above, MapCanvas +0.19 kB (the lazy overlay
  // hook), renderScene +0.17 kB (a figure drawn by its corners in PNG and SVG, its credit line) and
  // RasterPlacementModal +0.1 kB (the link to the points dialog).
  // 990.8 → 992.6 (Oct 2026, claim-search intent, measured 992.3, 990.6 on main): App as maxJsChunkGzipKb above, and
  // in the lazy registry chunk the Claim # box read as people use it (shared/claimNumbers.js: "#", pasted lists,
  // company names typed into the wrong tab), the found/missing summary for a list and the GESTIM/MLAS/MTO links.
  // 992.6 → 1008.7 (Oct 2026, 2D labels and geology styling merged over claim-search intent, measured 1008.4, +16.1 kB over
  // main's 992.3; on its own branch 990.8 → 1006.9, measured 1006.6 over 990.5): all of it lazy and
  // loaded only for a map that uses it. utils/geoStyle.js (9.1 kB: labels along lines and printed into units with the
  // largest-box fit, feathered and plume fills, glow, casing and the line types, the wash, legend swatches, collisions
  // and the canvas and SVG painters), utils/fxLayers.js (1.6 kB: the editor's three Leaflet canvases), the inspector
  // controls (GeoStyleControls 2.6 kB, WashControls 0.7 kB) and the legend swatch (FxSwatch 0.4 kB). App as
  // maxJsChunkGzipKb above, MapCanvas +0.31 kB (unseen paths for a styled layer, the lazy hook), renderScene +0.85 kB (the
  // styled layers, labels, wash and swatches in PNG and SVG, label overlap warnings) and preflight +0.17 kB (panels over
  // one another, label overlaps in the publication check).
  // 992.6 → 993.2 (Oct 2026, measured 992.9): dompurify 3.4.14 → 3.4.17 (jspdf's dependency) for the critical
  // advisories GHSA-p98j-92pf-mc4p and related; the fixed release is ~0.3 kB larger.
  // 993.2 → 1009.4 (measured 1009.1): 2D labels and geology styling (above, measured 1008.4) merged over the dompurify
  // update.
  // 1009.4 → 1016.8 (Oct 2026, 2D export package, measured 1016.5, 1009.1 on main): all lazy. PackageExport (3.3 kB:
  // the dashboard's package dialog, drawing each saved map off screen, the PDF and the ZIP), exportLayers (1.2 kB: the
  // designer layers ZIP), the band as SVG and its font wait in the shared watermarkBand chunk (+1.2 kB), ExportExtras
  // (0.6 kB: the band toggle, "Prepared for" and the layers button), utils/svg split into its own 0.26 kB chunk (now
  // shared by three lazy exporters), renderScene's map / annotations layers (+0.1 kB), exportPNG/SVG/PDF's band hooks
  // and the PDF page helper (+0.27 kB), ReadOnlyMapStage's renderCanvas (+0.1 kB), the dashboard's button (+0.11 kB)
  // and App as maxJsChunkGzipKb above.
  totalAuthJsGzipKb: 1016.8,
  // 805 → 808: placed and callout logos, SVG font embedding (Sept 2026).
  // 808 → 809: shared-map viewer opens at the saved view on the fixed stage.
  // 809 → 810: the lazy /oauth/consent page for MCP account sign-in.
  // 810 → 812: Download PNG on shared maps (the MCP png_download_url).
  // 812 → 813: patterned legend swatches (shared/fillPattern.js) and the property data library client.
  // 813 → 819 (measured 817.8): callout leader routing and "Add Published Results", as totalAuthJsGzipKb above.
  // 819 → 826 (measured 824.8): the publication check, as totalAuthJsGzipKb above.
  // 826 → 825.5 (Oct 2026, after the /3d trim below; measured 825.2): lowered to what ships, plus 0.3.
  // 825.5 → 828.5 (measured 828.2): the figure style and brand kit style apply, as totalAuthJsGzipKb above.
  // 828.5 → 828.8 (measured 828.5 in CI): the stale-chunk reload guard and lazyGuarded wrapper in the main entry
  // (~0.3 kB); chunk-hash churn alone moves this total by about ±20 B, so 828.5 left no room.
  // 828.8 → 838.0 (Oct 2026, measured 837.65 after merging round 5C, plus 0.3): the drill database tab, as totalAuthJsGzipKb above (lazy chunk
  // ~8.8 kB in this build, workspace chunk +0.3 kB); nothing in App or on the homepage.
  // 838.0 → 838.7 (Oct 2026, measured 838.32): the drill CSV reader's structure checks, as totalAuthJsGzipKb above.
  // 838.7 → 847.2 (Oct 2026, measured 846.93): the drill results section, as totalAuthJsGzipKb above.
  // 847.2 → 847.4 (measured 847.05): the results review fixes, as totalAuthJsGzipKb above.
  // 847.4 → 848.5 (measured 848.21): hole-ID labels at their collar, as totalAuthJsGzipKb above.
  // 848.5 → 850.0 (measured 849.70): the export options, as totalAuthJsGzipKb above.
  // 850.0 → 851.1 (measured 850.8): 2D bugs B1–B4, as totalAuthJsGzipKb above.
  // 851.1 → 851.4 (measured 851.1): the tick bounds, as maxJsChunkGzipKb above.
  // 851.4 → 866.3 (measured 865.9): the 2D Studio style, as totalAuthJsGzipKb above.
  // 866.3 → 871.5 (measured 871.22): 3D figures in the account, as totalAuthJsGzipKb above.
  // 871.5 → 876.5 (measured 876.14, +4.92 kB over main's 871.22): the admin 3D usage tab, as totalAuthJsGzipKb above.
  // 876.5 → 877.8 (Oct 2026, production errors, measured 877.5, 876.1 on main): as totalAuthJsGzipKb above.
  // 877.8 → 879.1 (measured 878.8, 877.5 on main): the homepage's lazy LandingNew chunk, as totalAuthJsGzipKb above.
  // 879.1 → 901.7 (measured 901.4, 878.8 on main): the 2D drill plan, as totalAuthJsGzipKb above.
  // 901.7 → 903.4 (measured 903.1): the drill plan review fixes, as totalAuthJsGzipKb above.
  // 903.4 → 904.8 (measured 904.5, 903.1 on main; on its own branch 879.1 → 880.6): the shared watermark band, as
  // totalAuthJsGzipKb above.
  // 904.8 → 922.6 (measured 922.3, 904.5 on main): import a company figure, as totalAuthJsGzipKb above.
  // 922.6 → 924.4 (measured 924.1, 922.3 on main): claim-search intent, as totalAuthJsGzipKb above.
  // 924.4 → 940.3 (measured 940.0, 924.1 on main; on its own branch 922.6 → 938.5, measured 938.2 over 922.3): 2D labels
  // and geology styling, as totalAuthJsGzipKb above.
  // 924.4 → 924.9 (measured 924.6): dompurify 3.4.17 security update, as totalAuthJsGzipKb above.
  // 924.9 → 940.9 (measured 940.6): 2D labels and geology styling (above, measured 940.0) merged over the dompurify
  // update.
  // 940.9 → 948.4 (measured 948.1, 940.6 on main): 2D export package, as totalAuthJsGzipKb above.
  totalJsGzipKb: 948.4,
  // Standalone pages (/3d, /teams) are separate Vite entries that never share
  // the app's chunks, so they are budgeted on their own instead of in the
  // totals above. /3d carries three.js (~109 kB gzip) and its editor.
  // 140 → 160: pro figures (intercept bars, real terrain and satellite drape,
  // solid block, text and wall labels, designer layers, design-desk form) plus
  // account save; proj4 and fflate stay lazy.
  // 160 → 164 (Oct 2026): the grade shell's controls and composites (its estimate and marching cubes
  // run in the lazy worker below), the metal-equivalent builder, the display cut-off and the data
  // checks panel add ~9.6 kB to the page; they are needed as soon as data loads, so stay eager.
  // 164 → 168 (Oct 2026): geology on the block faces, geophysics curtains and hole tags. Their logic is
  // in lazy chunks (geology.js, geophys.js, tags.js, budgeted below); the page keeps the file-role
  // detection for lithology logs and Geosoft XYZ (roles.js, needed the moment a file is added), the
  // hook points, the settings defaults saved with a figure, and the EM3D methods (~4.6 kB).
  // 168 → 169 (Oct 2026, round 4): the click-versus-drag gate and Lock view, the one layout pass, legend
  // cards that dock and drag, the imagery tone, the shell seen through the terrain, and the history hooks
  // (Ctrl/Cmd+Z needs them from the first change). The API notes, the design desk and the logo colour
  // picker moved out of the page to pay for most of it; what remains is under 0.1 kB over.
  // 169 → 170 (Oct 2026): figure design versions (design-version.js: earlier figures keep their look) and
  // gap-aware intercepts (intercepts.js) with the warning on earlier figures, ~0.9 kB. Both run as a figure
  // opens and on every restyle, so they stay in the page.
  // 170 → 172 (Oct 2026, round 5A): the sun's soft terrain shadows (traced into the terrain image), the darker
  // hollows and the light/dark presentation palette are on from the first frame, as are the orthographic
  // projection's hooks and the section markers kept off labels; three.js gains the matcap, edge and fog
  // classes they use (0.6 kB, in the shared vendor chunk). The shells' drawing and checks, the orthographic
  // framing, the haze and the scene checks went to look.js, the leaders and pills to leaders.js, and the
  // metal-equivalent form and the data checks list to panels.js (1.1 kB), to keep the rest out of the page.
  // 172 → 174 (Oct 2026): holes chosen for the section (section-geometry.js: the fitted line, projection
  // and cutting traces at the slab edges) and the cleaner section drawing (IDs in a row on leaders, callouts
  // level with their holes), ~2.1 kB. The section is drawn and exported synchronously, so it stays in the
  // page; the panel list, collar clicks and EM3D.setSection are lazy (section.js, below).
  // 174 → 174.1 (Oct 2026, with published results, measured 174.0): the callout-source hooks that must run as
  // a figure draws (computeCallouts by mode, callouts keyed per result, ribbons sized to the callouts); their
  // logic, the callout editor and groupCallouts are already lazy.
  // 174.1 → 168.5 (Oct 2026, trim; measured 168.2 in both builds): code that never runs as a figure is first
  // drawn left the page, with no change to the figure, its exports or the API. Real terrain (the coordinate
  // systems, proj4 and the DEM and imagery mosaics) is in terrain.js; the designer layers ZIP in desk.js; ZIP
  // reading in unzip.js; the file list, the Layout step's controls, the figure sizes and the label lists in
  // panels.js (fetched with the first data, like the checks); the account API notes in the page's HTML.
  // Collars in latitude/longitude, the credits and everything drawn or exported synchronously stay here.
  // 168.5 kept (Oct 2026, figure style, measured 168.34, configured 168.36): the typography hook fits — the brand style
  // saved with a figure, the wait for its fonts as a figure settles, EM3D.setFigureStyle and the lazy chunk's
  // entry. The adapter and the font loading are lazy (typography.js, below).
  // 168.5 → 169.3 (Oct 2026, round 5B, measured 168.98, configured 169.0): the hooks for map overlays and shapes
  // (~0.64 kB): GeoJSON and KML files taken as overlays when added (and kept beside the sample), the overlay areas
  // painted with the terrain, the draw and section hooks, the legend rows, the saved settings, getState and the six
  // EM3D methods. Their parsing, placing, drawing and panels are lazy (overlays.js, shapes.js, below).
  // 169.3 → 169.7 (Oct 2026, round 5C, measured 169.33, configured 169.36): the hooks for named sections and fences
  // (~0.36 kB): the saved settings (sections, secActive), the section ends lettered B, B′ on the figure and the
  // section, a named section's heading, exportPNG({ section }) (drawn synchronously, so the section is swapped in
  // here), the fence lines painted with the terrain, getState and the four EM3D methods. The tabs, the API, the
  // fences and their letters are lazy (sections.js, below).
  // 169.7 → 170.1 (Oct 2026, drill database 2A on top of round 5C, measured 169.73, configured 169.75): no new code on the page. The
  // column matcher (ALIASES, matchCols, roleOf) moved from studio.js into roles.js so the property drill importer
  // detects columns exactly as /3d does; roles.js is now a chunk the page shares with the app's lazy drill tab,
  // and a separate chunk compresses ~0.4 kB worse than the same code inside the page.
  // 169.7 → 170.1 (Oct 2026, round 5D, measured 169.95, configured 169.98; +0.60 kB over main): the hooks for plan
  // views (the grid setting, the plan.js calls for its grid, bars, IDs and "Plan view", the tubes hidden), section IDs
  // by pad and by grade (section.js), long legend names wrapped, claims outlined in the plan inset, and the version
  // check (version-check.js: an open page offers a newly deployed version; a stale chunk with work on screen says so
  // instead of reloading). The Display checkboxes and terrain selects now use the generic data-ext binding (-0.16 kB).
  // 170.1 → 170.6 (Oct 2026, round 5D merged over drill database 2A, measured 170.33, configured 170.36): the two
  // entries above add up; neither adds the other's code.
  // 170.6 → 170.9 (Oct 2026, drill database 2B, measured 170.56, configured 170.57): the drillSource hooks and the
  // hole-path switch (+0.18 kB); 170.6 left ~30 B, inside chunk-hash churn.
  // 170.9 → 170.95 (Oct 2026, published figure versions 5A merged over 2B, measured 170.62, configured 170.63, + ~0.3):
  // the four EM3D.account version names and the gap note skipped over a published version (+0.03 kB); the rest is lazy.
  // 170.95 → 171.6 (Oct 2026, export options, measured 171.21, configured 171.24, merged over figure versions 5A): a transparent background for exportPNG and the
  // layers ZIP (no scene colour, section paper or footer band; drawn synchronously, so in the page), the drop shadow
  // setting and its export override, the Export step's Background select, exports that wait for the layers they
  // need (pending setMapUse and module loads), and the hooks for Map use (the footer's notes and credits moved out,
  // the details atop the legend card, EM3D.setMapUse, the saved settings). The standalone block is lazy (mapuse.js).
  // 171.6 → 171.7 (Oct 2026, claim map inset merged over export options, measured 171.40, configured 171.42, + ~0.3):
  // the hooks for Find claims (the lazy import, EM3D.findClaims and the panel button), insetStyle "claims" and the
  // claims' registry credit in the footer (+0.12 kB); the rest is lazy (claims.js, tags.js).
  // 171.7 → 172.2 (Oct 2026, round 5E block section merged over the claim map inset, measured 171.92, configured 171.94, + ~0.3; +0.52 kB over the inset's 171.40): the block section's
  // hooks (+0.48 kB on its own branch): the holes shown (holeOn on the traces, tubes, collars, callouts, pending tags and
  // section), the block.js entry in drawOverlay (its traces; the logo, title block, legend cards, scale bar, elevation
  // ticks, compass and footer it takes over on a bare block section), no section letters or line on a block section, the
  // "heading" wall label handed to block.js, the bar palette's legend rows, the settings and the three EM3D methods. A
  // standalone map on a block section keeps its details in a card of their own when the legend is on the side face.
  // 172.2 → 172.8 (Oct 2026, admin 3D usage merged over round 5E and the drill crew, measured 172.44, configured 172.45, +0.33 kB over
  // main): the usage hooks (the lazy import of track.js, three_d_opened a moment after start, data added per kind in
  // addUserFiles and real terrain, exports counted in exportPNG and exportLayers). The sender itself is lazy
  // (track.js, below); the page view comes from /acquisition.js in public/, outside these budgets.
  // 172.8 → 173.3 (Oct 2026, production errors merged over admin 3D usage, measured 173.0, configured 173.0, 172.4 on
  // main): uncaught errors and rejections reported to error_events like the 2D app's, and stale chunks recovered from a
  // bare import() too (studio.js plus its copy of shared/chunkErrors.js).
  // 173.3 → 173.6 (Oct 2026, round 5F merged over main bebbd02b, measured 173.2, configured 173.3, +0.2 kB over main's 173.0, + 0.3): the
  // hooks only: the section view repainted by every geology setter (B5), the callouts left off a drawing and why
  // (getState().layout, kept out of the unsaved-work signature, B6), a callout's domain heading in setCallout, the unit wall label's hook in
  // placeWallLabel and its name from the legend, and setMapUse waiting for the block to be framed again. The rest is lazy.
  // 173.6 → 174.6 (Oct 2026, 3D round 5G merged over round 5F and the 2D drill plan (5a7e0dbf), measured 174.2, configured
  // 174.3, 173.2 and 173.3 on 940ea04e, + 0.3; on its own branch 173.3 → 174.3, measured 173.9 over 173.0): the hooks for the
  // round's opt-in features, all of whose work is lazy: the export's pixel size (width or scale, checked against the
  // browser's graphics limit) and the watermark band's lazy import for exportPNG, exportLayers and the Export step's
  // controls; setLogo's removeBackground and the Brand step's offer (logo-bg.js); setFaceImage's fit and fitFaceImage;
  // the block's side title in place of the title block, and its heading label hidden under it (~0.9 kB in all).
  threeDJsGzipKb: 174.6,
  // /3d's own modules fetched on first use (the geology, geophysics and tag layers, the account
  // client). They never load with the page or the app, so they sit outside the page and app totals.
  // 32 → 34 (Oct 2026, round 4): per-hole tags, grouped pending tags, callouts beside or bracketed on their
  // hole, the lithology legend file, and the design desk moved out of the page into desk.js (1.8 kB) to
  // keep the page inside its budget.
  // 34 → 36 (Oct 2026): company workspaces (#282) add the property picker to the account client.
  // 36 → 39 (Oct 2026, round 4 group C): undo/redo and the History panel (history.js, 1.9 kB), key-hole
  // emphasis and highlighted holes (tags.js), and the logo colour picker moved out of the page
  // (logo-colours.js) to keep the page inside its budget; the save-conflict check in the account client.
  // 39 → 40: the configured (Supabase) build of the account client is ~0.3 kB larger than the plain one.
  // 40 → 47 (Oct 2026): share links (share.js: the Share dialog, EM3D.share and the read-only viewer for
  // /3d/share/<id> and /3d/embed/<id>, ~6.5 kB). Loaded on the first click on Share, or at once on a shared
  // figure; the page itself only gains the hook in account.js.
  // 47 → 48 (Oct 2026): the property data library picker and newer-data notice (library.js, ~1.4 kB),
  // fetched by account-core.js only for a figure in a company property. Counted here now that the
  // walk follows lazy imports of lazy modules; before, it would have landed in the app's totals.
  // 48 → 57 (Oct 2026, round 5A): look.js (solid outlined and nested grade shells, their checks, the
  // orthographic framing, haze, the scene checks; ~3.6 kB); leaders.js (arrows routed around cards, labels
  // moved where theirs would detour, and the pill placement moved out of the page's layout.js; ~1.9 kB, now
  // counted here as a chunk shared by lazy modules); contact lines, cleaned faces and unit names placed clear
  // of the holes in geology.js (~1.8 kB); and the metal-equivalent form and the data checks list moved out of
  // the page (panels.js, 1.1 kB).
  // 57 → 64 (measured 62.9, configured 63.1): round 5A's chunks above with published results
  // (published-results.js, ~3.9 kB: release-table records, checks and the callouts drawn from them) and the
  // callout editor moved out of the page (callout-editor.js, ~2 kB, fetched when the Layout step first shows).
  // 64 → 67 (Oct 2026, measured 65.8, configured 66.0): section.js, the "Chosen holes" list, collar clicks
  // and EM3D.setSection (~2.5 kB), fetched when a figure first chooses holes for its section.
  // 67 → 73.3 (Oct 2026, measured 72.7, configured 73.0): the page trim above moved ~5.8 kB here (terrain.js
  // 3.2, panels.js +2.6, desk.js +0.6, unzip.js 0.5; split chunks compress a little less well together).
  // 73.3 → 74.4 (Oct 2026, measured 73.9, configured 74.15): typography.js (~1.2 kB), the brand fonts and
  // EM3D.setFigureStyle, fetched only for a figure with a brand style.
  // 74.4 → 89.7 (Oct 2026, round 5B, measured 89.2, configured 89.4): map overlays (overlays.js, ~7.8 kB: GeoJSON,
  // KML and CSV points read, placed with the figure's coordinate system, areas painted on the terrain, lines and
  // points draped and hidden behind ridges, legend rows and the Layout list), shapes (shapes.js, ~4.9 kB: ellipses,
  // dimension lines and arrows on the figure and section, and their list), the draping maths both share
  // (drape.js, 0.9 kB) and zipped shapefiles read in unzip.js (shp.js, +1.1 kB). Fetched only for a figure with
  // an overlay or a shape, or a ZIP.
  // 89.7 → 94.4 (Oct 2026, round 5C, measured 93.9, configured 94.1): named sections and fences (sections.js with
  // shared/sectionGeometry.js, ~4.6 kB: addSection / updateSection / removeSection / setActiveSection, the section
  // tabs, the old single section kept as A–A′, each section swapped in for its export, and the fences built as
  // painted slabs with their letters). Fetched only for a figure with named sections.
  // 94.4 → 100.45 (Oct 2026, F3 part 2, measured 99.92, configured 100.15): editable annotations for the layers ZIP
  // (annotations-svg.js with drawlist.js, one ~5.7 kB chunk: the Canvas draw-command recorder, the SVG writer with
  // live text, and the font embedding), plus ~0.4 kB in desk.js. Fetched only when "Include editable annotations
  // (SVG)" is ticked or EM3D.exportLayers({ svg: true }) is called. The page gains only the recorder's hand-off in
  // figureCanvas and the checkbox (+0.015 kB, inside its budget).
  // 100.45 → 104.5 (Oct 2026, round 5D, measured 103.94, configured 104.18, + 0.3): plan.js (~2.8 kB: the plan view's
  // interval bars, each on its own stretch of a surveyed trace, grid with its eastings and northings, and hole IDs
  // placed on short leaders; fetched for figures of
  // design version 5 or with the grid on), section.js +0.55 (pad-merged and staggered section IDs, grade-ranked holes),
  // overlays.js +0.3 (claims outlined in the inset), shapes.js +0.2 (views: both, 3D or section), the callout editor's
  // second published line with its own depths and stale-wording note (+0.2) and the location inset's outline hook in tags.js.
  // 104.5 → 109.0 (Oct 2026, drill database 2B on top of round 5D, measured 108.5, configured 108.7): figures that take their holes
  // from a property's drill database (property-data.js, ~3.7 kB: the property picker, the current rows read 1,000 at a
  // time and written as the files an upload would be, the snapshot the figure records, the newer-imports notice and
  // Update) and minimum-curvature paths for their surveyed holes (min-curvature.js with shared/desurvey.js, 0.64 kB);
  // account-core.js gains the button, the hook and the check on open (+0.15 kB). Fetched only on "From property drill
  // database" or for a figure that used it. The page gains the hooks (drillSource, the path switch; +0.18 kB, inside
  // its budget); App and the totals are unchanged.
  // 109.0 → 109.3 (review fixes, measured 108.79, configured 109.02): the newer-data notice is cleared when another figure
  // opens and Update checks it still belongs to the figure on screen; collars in more than one coordinate system are
  // refused with their counts (~0.2 kB in property-data.js, account-core.js +0.02).
  // 109.3 → 114.6 (Oct 2026, published figure versions 5A merged over drill database 2B, measured 114.04, configured
  // 114.27, + 0.3; +5.25 kB over 2B's 109.02): versions.js (~4.7 kB: Publish version with its label and release date, the
  // Versions list, a version opened read-only with its banner, Download PNG, "Start a new figure from this version" and
  // "Back to the current figure" (left out when the live figure is gone or out of reach), the plain-words refusals),
  // fetched only from "Versions…" in My 3D maps, the EM3D.account version methods or a ?version= link that reads the
  // version on its own; and its hooks in account-core.js (~0.55 kB: saveProject refusing while a version is open, the
  // change notices ignored, the lazy loader, the menu button, the ?version= boot, and opening a version clearing 2B's
  // drill notice and pending Update, with no drill check while it is shown). Neither adds the other's code.
  // 114.6 → 115.7 (Oct 2026, export options, measured 115.19, configured 115.42, merged over figure versions 5A): mapuse.js (~1 kB: a standalone map's details, sources
  // and notes as the top section of the legend card), fetched only for a standalone figure; desk.js passes the
  // background to every layer.
  // 115.7 → 121.7 (Oct 2026, claim map inset merged over export options, measured 121.13, configured 121.36, + 0.3;
  // +5.9 kB over export options' 115.42, as on its own branch where it took 104.5 → 110.5): claims.js (~4.45 kB with
  // shared/claimSearch.js: "Find claims" by holder, numbers or name and "Claims around the model" through the 2D
  // app's /api/claims and /api/bc-claims, added as area overlays with role "claims" and the registry's credit;
  // fetched only on the first click on Find claims or EM3D.findClaims), tags.js +1.4 (insetStyle "claims": the claim
  // map fitted to the block and the project's claims, tenure labels where they fit, the north arrow and scale bar
  // shared with the location inset) and overlays.js +0.15 (role, group and credit; the footer credit). The page
  // gains only the hooks (+0.12 kB, inside its budget).
  // 121.7 → 133.7 (Oct 2026, round 5E block section merged over the claim map inset, measured 133.22, configured 133.44, + ~0.3;
  // +12.1 kB over the inset's 121.13, as on its own branch): block.js (~7.6 kB: the preset, holes shown, the furniture drawn in the side face's perspective, the
  // heading, the bare page and the hole picker), softer geology faces and names in capitals on the front face
  // (geology.js +1.6), grade spikes or bars in the face's plane with the orange palette and plain brackets and IDs
  // (tags.js +1.6), the thin arrow with text (shapes.js +0.35), and the plan view's sync keeping the tubes hidden. Fetched
  // only for a figure with holes hidden, a block look or a heading on the block, or on "Block section".
  // 133.7 → 139.7 (Oct 2026, drill crew merged over round 5E, measured 139.18, configured 139.39, + 0.3; +5.96 kB over
  // 5E's 133.22): crew.js (~5.9 kB: a cartoon drill rig and crew of rounded boxes, capsules, balls and domes generated
  // in the module, so three.js gains no classes; an ink outline and contact shadows; a cleared gravel pad ramping to
  // the ground at the collar; "auto" choosing the collar with room on screen; collar rings under the pad giving way;
  // the idle motion and EM3D.setCrew), fetched only for a figure that turns the crew on. The page gains the hooks
  // (+0.18 kB, inside its budget); the totals are unchanged.
  // 139.7 → 143.8 (Oct 2026, drill crew life, measured 143.22, configured 143.44, + 0.3; +3.95 kB over main's 139.27):
  // crew-life.js (~3.4 kB: the crew's routines on the pad with walking legs and arms, the rod and mug, speech bubbles
  // as page elements over the figure, the line pools and noticing a viewer who points or taps), loaded by crew.js only
  // when the crew is on with life or chatter; crew.js +0.5 kB (putting every part back before an export, chatter and
  // life settings, each one's place for the bubbles). The page and the totals are unchanged.
  // 143.8 → 144.8 (Oct 2026, admin 3D usage merged over drill crew life, measured 144.21, configured 144.42, + 0.3; +0.84 kB
  // over main): track.js (the 3D events' allowlist, the stored token, once per tab, nothing but views and copies on a
  // shared figure) with the app's shared /api/track sender (utils/trackCore.js and utils/session.js), fetched a moment
  // after the editor opens, and the calls in account-core.js, share.js and versions.js (Google tag calls kept).
  // 144.8 → 150.2 (Oct 2026, round 5F merged over main bebbd02b, measured 149.7, configured 149.9, with the review fixes; +5.5 kB over main's 144.2, + 0.3): block.js
  // +3.7 kB (wall labels by unit: the band search and its placement; the see-through terrain that keeps its colours,
  // a stencil and a second pass for what lies under it; the fade at the bottom; the standalone framing; the Layout
  // controls), tags.js +1.5 kB (the bracket callout with its heading, chip, leader and alternate sides; brackets kept
  // out of group cards; bracket text kept inside the frame), geology.js +0.15 kB (a face's class grid for block.js;
  // no painted name where the unit has its own wall label), mapuse.js +0.04 kB. All fetched only for a block section.
  // 150.2 → 149.0 (Oct 2026, the 2D drill plan merged over round 5F, measured 148.4, configured 148.7, −1.2 kB from main's
  // 149.9): /3d's lazy sections and min-curvature now share shared/sectionGeometry.js and shared/desurvey.js as chunks with
  // the 2D drill plan instead of each carrying a copy; nothing in /3d changed.
  // 149.0 → 154.9 (Oct 2026, 3D round 5G merged over the 2D drill plan (5a7e0dbf), measured 154.4, configured 154.6,
  // 148.4 and 148.7 on main, + 0.3; over round 5F alone 150.2 → 156.1, on its own branch 144.8 → 150.4): image-fit.js (~2.3 kB,
  // the picker that fits a section image to a face by known points, fetched on its button), logo-bg.js with the shared
  // src/utils/logoBackground.js (~1.5 kB, fetched with the first logo added in the Brand step or a removal asked for),
  // geology.js +1.4 (the fit by known points, the A–A′ plane, getState().layout.imageFits, a fit whose hole has left the
  // data shown stretched), block.js +0.6 (the side title) and tags.js +0.1 (several "incl." results joined with " & ").
  // 154.9 → 156.5 (Oct 2026, drill crew at true scale, measured 155.95, configured 156.17, 154.38 and 154.59 on main
  // 99f75f6d, + 0.3; +1.6 kB): crew.js only, fetched only for a figure with the crew on: the "True scale" size (real
  // dimensions in the scene's metres, heights with the vertical exaggeration, the mast's lean kept on the trace), its
  // leader and label placed clear of the callouts, Zoom to crew and the closer zoom range while the camera looks at the
  // crew. The page grows 0.04 kB (the setCamera, settle, overlay and zoomToCrew hooks) and stays inside threeDJsGzipKb.
  // 154.9 → 159.2 on its own branch (Oct 2026, 3D round 5H merged over the 2D figure import (ca93dfcf), measured 158.7, configured 158.9,
  // 154.4 and 154.6 on main, + 0.3): block.js +3.7 (the block section's opt-in release look: a colour per hole on its
  // trace, a common pad's pill, the release legend card, elevation ticks on the block's edge, A and A′ at the section's
  // ends, the flat scale bar with its note, getState().layout.block, their checks and Layout controls) and tags.js +0.6
  // (thick bars in the release palette, the pad pill and hole colours on the collar IDs and callout chips, incl. lines
  // without "from"). The /3d page gains only the hooks (+0.05 kB, within its limit).
  // 159.2 → 159.6 (review fixes, measured 159.1, configured 159.3): thick bars one per run of assays in one class
  // (tags.js classRuns) at a width set in figure px (hist.width and its slider), and colours for holes no longer in the
  // data dropped rather than refused (+0.4 kB).
  // 156.5 → 161.2 (round 5H merged over the true-scale crew (b55edc19), measured 160.7, configured 160.9, + 0.3):
  // round 5H's +4.7 kB above on top of the crew's +1.6 kB; the two touch different chunks (block.js and tags.js; crew.js).
  threeDLazyJsGzipKb: 161.2,
  // The /3d grade-shell worker (composites estimate and marching cubes) is its own chunk, fetched only
  // when a shell is turned on. Vite emits workers outside the manifest graph, so it is found from the
  // page's chunks (see below) and budgeted here rather than in the page or the app totals.
  threeDWorkerJsGzipKb: 6,
  teamsJsGzipKb: 10,
  adminAuthJsGzipKb: 150,
  adminJsGzipKb: 85,
  // 335 → 335.3 (Oct 2026, measured 334.98): the same ~0.07 kB in App, as maxJsChunkGzipKb above.
  // 335.3 → 335.6 (Oct 2026, export options, measured 335.30): the same App code as maxJsChunkGzipKb above.
  // 335.6 → 335.9 (Oct 2026, 2D bugs B1–B4, measured 335.6): the same App code as maxJsChunkGzipKb above.
  // 335.9 → 336.1 (measured 335.8): the tick bounds, as maxJsChunkGzipKb above.
  // 336.1 → 337.6 (Oct 2026, 2D Studio style merged over B1–B4, measured 337.3): the same App code as maxJsChunkGzipKb above.
  // 337.6 → 337.7 (measured 337.39): the property file hand-off in App, as maxJsChunkGzipKb above.
  // 337.7 → 338.1 (Oct 2026, admin 3D usage, measured 337.75, +0.36 kB over main's 337.39): the app's /api/track sender
  // and tab session id (utils/trackCore.js, utils/session.js) are now one chunk shared with /3d's lazy track.js; the
  // code is unchanged, the extra chunk's overhead is what is new.
  // 338.1 → 339.0 (Oct 2026, production errors, measured 338.7, 337.8 on main): the stale-chunk recovery in the entry and
  // the Canvas redraw fix in vendor-leaflet, as totalAuthJsGzipKb above.
  // 339.0 → 339.7 (Oct 2026, 2D drill plan, measured 339.4, 338.8 on main): the App code as maxJsChunkGzipKb above.
  // 339.7 → 340.2 (Oct 2026, import a company figure merged over the drill plan, measured 339.9, 339.4 on main): App as
  // maxJsChunkGzipKb above and MapCanvas +0.19 kB (the lazy hook for a figure placed by its corners).
  // 340.2 → 340.9 (Oct 2026, claim-search intent, measured 340.6, 339.9 on main): App as maxJsChunkGzipKb above.
  // 340.9 → 341.5 (Oct 2026, 2D labels and geology styling merged over claim-search intent, measured 341.2, 340.6 on main;
  // on its own branch 340.2 → 340.9, measured 340.6 over 339.9): App as maxJsChunkGzipKb above
  // and MapCanvas +0.31 kB (a styled layer's paths kept unseen for clicks, and the lazy hook to its canvases).
  // 341.5 → 341.9 (Oct 2026, 2D export package, measured 341.6, 341.3 on main): App as maxJsChunkGzipKb above.
  editorAuthJsGzipKb: 341.9,
  // 270 → 271.0 (Oct 2026, production errors, measured 270.7, 269.6 on main): the same as editorAuthJsGzipKb above.
  // 271.0 → 271.7 (Oct 2026, 2D drill plan, measured 271.4, 270.8 on main): the same as editorAuthJsGzipKb above.
  // 271.7 → 272.2 (measured 271.9, 271.4 on main): import a company figure, as editorAuthJsGzipKb above.
  // 272.2 → 272.8 (measured 272.5, 271.9 on main): claim-search intent, as editorAuthJsGzipKb above.
  // 272.8 → 273.4 (measured 273.1, 272.5 on main; on its own branch 272.2 → 272.8, measured 272.5 over 271.9): 2D labels
  // and geology styling, as editorAuthJsGzipKb above.
  // 273.4 → 273.8 (measured 273.5, 273.2 on main): 2D export package, as editorAuthJsGzipKb above.
  editorJsGzipKb: 273.8,
  claimsAuthJsGzipKb: 355,
  claimsJsGzipKb: 290,
  // Stylesheet, gzipped. Today ~29 kB.
  maxCssGzipKb: 40,
  // Any single image shipped from public/, including legacy PNG downloads.
  // The homepage serves responsive WebP; browser tests guard its LCP image.
  maxImageKb: 2900,
};

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

// Sum exact sizes before rounding; per-chunk rounding penalises code splitting.
const gzipKb = async (file) => gzipSync(await readFile(file)).length / KB;
const rawKb = async (file) => Math.round((await stat(file)).size / KB);

const failures = [];
const report = [];

const distFiles = await walk(DIST);
if (distFiles.length === 0) {
  console.error('check-budgets: dist/ is empty — run `npm run build` first.');
  process.exit(1);
}

// ── JavaScript ──
const manifest = JSON.parse(await readFile(join(DIST, '.vite/manifest.json'), 'utf8'));
function reachable(key, files = new Set()) {
  const chunk = manifest[key];
  if (!chunk || files.has(chunk.file)) return files;
  files.add(chunk.file);
  for (const imported of chunk.imports || []) reachable(imported, files);
  return files;
}
const appReach = reachable('index.html');
const STANDALONE = [['3d', '3d/index.html', BUDGETS.threeDJsGzipKb], ['teams', 'teams/index.html', BUDGETS.teamsJsGzipKb]];
const standaloneOnly = new Set();
for (const [name, entry, limit] of STANDALONE) {
  if (!manifest[entry]) throw new Error(`Missing standalone entry: ${entry}`);
  const files = reachable(entry);
  if ([...files].some((file) => /\/(App-|vendor-leaflet-|vendor-export-)/.test(`/${file}`))) failures.push(`${name} page loads the editor`);
  let size = 0;
  for (const file of files) {
    size += await gzipKb(join(DIST, file));
    if (!appReach.has(file)) standaloneOnly.add(join(DIST, file));
  }
  report.push(`${name} page JS: ${size.toFixed(1)} kB gzip across ${files.size} chunks`);
  if (size > limit) failures.push(`${name} page JS ${size.toFixed(1)} kB exceeds ${limit} kB`);
  // Workers: new Worker(new URL("/assets/x.js", import.meta.url)) in a page chunk, absent from the manifest.
  for (const file of files) {
    for (const [, w] of (await readFile(join(DIST, file), 'utf8')).matchAll(/new Worker\(new URL\("\/?(assets\/[\w.-]+\.js)"/g)) {
      const kb = await gzipKb(join(DIST, w)); standaloneOnly.add(join(DIST, w));
      report.push(`${name} worker ${w}: ${kb.toFixed(1)} kB gzip (lazy)`);
      if (kb > BUDGETS.threeDWorkerJsGzipKb) failures.push(`${name} worker ${w} ${kb.toFixed(1)} kB exceeds ${BUDGETS.threeDWorkerJsGzipKb} kB`);
    }
  }
  // Lazy chunks: the page's own modules (src/three-d/) it imports on first use. Shared vendors it
  // imports lazily (proj4, fflate, Supabase) stay in the app totals, as before.
  // Followed through those modules' own lazy imports (account-core.js fetches library.js) and the chunks
  // they share among themselves (leaders.js, imported by tags.js and look.js).
  if (name === '3d') {
    const lazy = new Set(), seen = new Set();
    const walkLazy = (from, statics = false) => {
      for (const key of [...(manifest[from].dynamicImports || []), ...(statics ? manifest[from].imports || [] : [])]) {
        const ours = key.startsWith('src/three-d/') || (key.startsWith('_') && existsSync(fileURLToPath(new URL(`../src/three-d/${manifest[key].name}.js`, import.meta.url))));
        if (!ours || seen.has(key)) continue;
        seen.add(key);
        if (!appReach.has(manifest[key].file) && !files.has(manifest[key].file)) lazy.add(manifest[key].file);
        walkLazy(key, true);
      }
    };
    walkLazy(entry);
    let lz = 0; for (const file of lazy) { lz += await gzipKb(join(DIST, file)); standaloneOnly.add(join(DIST, file)); }
    report.push(`${name} lazy JS: ${lz.toFixed(1)} kB gzip across ${lazy.size} chunks (loaded on first use)`);
    if (lz > BUDGETS.threeDLazyJsGzipKb) failures.push(`${name} lazy JS ${lz.toFixed(1)} kB exceeds ${BUDGETS.threeDLazyJsGzipKb} kB`);
  }
}

// The app's totals leave out chunks only a standalone page loads.
const jsFiles = distFiles.filter((f) => extname(f) === '.js' && !standaloneOnly.has(f));
let totalJs = 0;
let biggestJs = { file: '', kb: 0 };
for (const f of jsFiles) {
  const kb = await gzipKb(f);
  totalJs += kb;
  if (kb > biggestJs.kb) biggestJs = { file: f.replace(DIST, ''), kb };
}
report.push(`js: ${jsFiles.length} chunks, ${totalJs.toFixed(1)} kB gzip total, largest ${biggestJs.kb.toFixed(1)} kB (${biggestJs.file})`);
if (biggestJs.kb > BUDGETS.maxJsChunkGzipKb) {
  failures.push(`largest JS chunk ${biggestJs.kb} kB gzip exceeds ${BUDGETS.maxJsChunkGzipKb} kB (${biggestJs.file})`);
}

const initialFiles = new Set();
function collectInitial(key, files = initialFiles) {
  const chunk = manifest[key];
  if (!chunk || files.has(chunk.file)) return;
  files.add(chunk.file);
  for (const imported of chunk.imports || []) collectInitial(imported, files);
}
if (!manifest['index.html']) throw new Error('Missing homepage entry in build manifest');
collectInitial('index.html');
const authConfigured = [...initialFiles].some((file) => file.includes('vendor-supabase-'));
const totalBudget = authConfigured ? BUDGETS.totalAuthJsGzipKb : BUDGETS.totalJsGzipKb;
const initialBudget = authConfigured ? BUDGETS.initialAuthJsGzipKb : BUDGETS.initialJsGzipKb;
if (totalJs > totalBudget) failures.push(`total JS ${totalJs.toFixed(1)} kB gzip exceeds ${totalBudget} kB`);
let initialJs = 0;
for (const file of initialFiles) initialJs += await gzipKb(join(DIST, file));
report.push(`homepage JS: ${initialJs.toFixed(1)} kB gzip across ${initialFiles.size} initial chunks`);
if (initialJs > initialBudget) {
  failures.push(`homepage JS ${initialJs.toFixed(1)} kB gzip exceeds ${initialBudget} kB`);
}

// Route budgets include the common entry and every static dependency needed
// for the first usable screen. Total bytes alone hide accidental eager loads.
const appKey = Object.keys(manifest).find(key => manifest[key].name === 'App');
if (!appKey) throw new Error('Missing editor chunk in build manifest');
for (const [name, entries, limit, forbidden] of [
  ['admin', ['index.html', 'src/components/AdminPage.jsx', 'src/components/admin/SummaryTab.jsx'],
    authConfigured ? BUDGETS.adminAuthJsGzipKb : BUDGETS.adminJsGzipKb, /\/(App-|MapCanvas-|vendor-leaflet-|vendor-export-|regionsNA-)/],
  ['editor', ['index.html', appKey, 'src/components/MapCanvas.jsx'],
    authConfigured ? BUDGETS.editorAuthJsGzipKb : BUDGETS.editorJsGzipKb, /\/vendor-export-/],
  ['claims', ['index.html', appKey, 'src/components/MapCanvas.jsx', 'src/components/AddClaimsModal.jsx'],
    authConfigured ? BUDGETS.claimsAuthJsGzipKb : BUDGETS.claimsJsGzipKb, /\/(vendor-export-|vendor-geo-|vendor-zip-)/],
]) {
  const files = new Set();
  for (const entry of entries) {
    if (!manifest[entry]) throw new Error(`Missing ${name} entry: ${entry}`);
    collectInitial(entry, files);
  }
  let size = 0;
  for (const file of files) size += await gzipKb(join(DIST, file));
  report.push(`${name} initial JS: ${size.toFixed(1)} kB gzip across ${files.size} chunks`);
  if (size > limit) failures.push(`${name} initial JS ${size.toFixed(1)} kB exceeds ${limit} kB`);
  if ([...files].some(file => forbidden.test(file))) failures.push(`${name} eagerly loads an unrelated engine`);
}

// ── CSS ──
const cssFiles = distFiles.filter((f) => extname(f) === '.css');
let biggestCss = { file: '', kb: 0 };
for (const f of cssFiles) {
  const kb = await gzipKb(f);
  if (kb > biggestCss.kb) biggestCss = { file: f.replace(DIST, ''), kb };
}
report.push(`css: largest ${biggestCss.kb.toFixed(1)} kB gzip (${biggestCss.file})`);
if (biggestCss.kb > BUDGETS.maxCssGzipKb) {
  failures.push(`largest CSS ${biggestCss.kb} kB gzip exceeds ${BUDGETS.maxCssGzipKb} kB (${biggestCss.file})`);
}

// ── Images ──
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
const images = (await walk(PUBLIC)).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()));
const oversized = [];
for (const f of images) {
  const kb = await rawKb(f);
  if (kb > BUDGETS.maxImageKb) oversized.push(`${f.replace(PUBLIC, '')} ${kb} kB`);
}
report.push(`images: ${images.length} in public/, ${oversized.length} over ${BUDGETS.maxImageKb} kB`);
for (const o of oversized) failures.push(`image over budget: ${o}`);

console.log('Performance budgets');
for (const line of report) console.log(`  ${line}`);

if (failures.length) {
  console.error('\nBudget exceeded:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('\nEither optimise, or raise the budget in scripts/check-budgets.mjs with a reason.');
  process.exit(1);
}
console.log('\nAll budgets within limits.');
