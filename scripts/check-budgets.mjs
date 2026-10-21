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
  maxJsChunkGzipKb: 148,
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
  totalAuthJsGzipKb: 894.1,
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
  totalJsGzipKb: 828.8,
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
  threeDJsGzipKb: 169.7,
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
  threeDLazyJsGzipKb: 100.45,
  // The /3d grade-shell worker (composites estimate and marching cubes) is its own chunk, fetched only
  // when a shell is turned on. Vite emits workers outside the manifest graph, so it is found from the
  // page's chunks (see below) and budgeted here rather than in the page or the app totals.
  threeDWorkerJsGzipKb: 6,
  teamsJsGzipKb: 10,
  adminAuthJsGzipKb: 150,
  adminJsGzipKb: 85,
  editorAuthJsGzipKb: 335,
  editorJsGzipKb: 270,
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
