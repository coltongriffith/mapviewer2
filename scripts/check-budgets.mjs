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
  maxJsChunkGzipKb: 135,
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
  totalAuthJsGzipKb: 870,
  totalJsGzipKb: 805,
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
const jsFiles = distFiles.filter((f) => extname(f) === '.js');
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

const manifest = JSON.parse(await readFile(join(DIST, '.vite/manifest.json'), 'utf8'));
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
  ['admin', ['index.html', 'src/components/AdminPage.jsx', 'src/components/admin/GrowthTab.jsx'],
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
