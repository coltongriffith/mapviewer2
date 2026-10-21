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
  maxJsChunkGzipKb: 147,
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
  totalAuthJsGzipKb: 878,
  // 805 → 808: placed and callout logos, SVG font embedding (Sept 2026).
  // 808 → 809: shared-map viewer opens at the saved view on the fixed stage.
  // 809 → 810: the lazy /oauth/consent page for MCP account sign-in.
  // 810 → 812: Download PNG on shared maps (the MCP png_download_url).
  totalJsGzipKb: 812,
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
  threeDJsGzipKb: 169,
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
  threeDLazyJsGzipKb: 47,
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
  if (name === '3d') {
    const lazy = new Set();
    for (const key of manifest[entry].dynamicImports || []) if (key.startsWith('src/three-d/') && !appReach.has(manifest[key].file) && !files.has(manifest[key].file)) lazy.add(manifest[key].file);
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
