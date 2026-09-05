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
  // Largest single JS chunk, including lazy editor/export code.
  //
  // Raised 188 → 191 in the 2026-09 review. The basemap-tiles change
  // (be0f5b9) had already pushed the entry chunk to 190 kB and left main red
  // on this check; the review's dead-code removal took 1 kB back (189 kB
  // measured), and the same 3 kB of slack sits on top of that.
  maxJsChunkGzipKb: 191,
  // Marketing entry plus its static imports. The September growth release
  // separates the editor: measured ~69 kB; guard the actual first load too.
  initialJsGzipKb: 75,
  // Configured deployments also load Supabase Auth. CI checks this build with
  // placeholder public settings: measured 124.1 kB initial / 796.6 kB total.
  initialAuthJsGzipKb: 135,
  totalAuthJsGzipKb: 798,
  // All JS shipped, gzipped, across every chunk — including the lazy ones a
  // given visit never loads.
  //
  // Raised from 725, deliberately, and worth recording why. Splitting a screen
  // out of the entry chunk moves bytes rather than removing them, and adds a
  // little per-chunk overhead — so lazy-loading the dashboard took 6 kB off
  // first paint and put 1 kB ON this total. This metric penalises the change
  // that made the product faster.
  //
  // So the two are not interchangeable: maxJsChunkGzipKb is the one to hold the
  // line on, and this one exists to catch a dependency quietly arriving. The
  // only way to lower it is to remove code or a package; splitting cannot.
  //
  // September growth release: 737 → 738, measured 737.3 kB with exact
  // byte accounting. The new shared preload chunk keeps the PDF engine off
  // the homepage; the separate 75 kB entry graph budget guards first load.
  totalJsGzipKb: 738,
  // Stylesheet, gzipped. Today ~29 kB.
  maxCssGzipKb: 40,
  // Any single image shipped from public/. The hero is currently 2.76 MB,
  // which is the single biggest LCP cost on the landing page.
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
function collectInitial(key) {
  const chunk = manifest[key];
  if (!chunk || initialFiles.has(chunk.file)) return;
  initialFiles.add(chunk.file);
  for (const imported of chunk.imports || []) collectInitial(imported);
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
