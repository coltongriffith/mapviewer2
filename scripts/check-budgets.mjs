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
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));

const KB = 1024;

const BUDGETS = {
  // Largest single JS chunk, gzipped. Today ~176 kB.
  maxJsChunkGzipKb: 190,
  // All JS shipped, gzipped, across every chunk. Measured at 690 kB today.
  // Route-splitting means only a subset loads on first paint, but the total is
  // what grows unnoticed, so that is what is capped. The audit's P1-22 work
  // (splitting landing/account/admin/editor) should bring this down; lower the
  // budget as it does.
  totalJsGzipKb: 725,
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

const gzipKb = async (file) => Math.round(gzipSync(await readFile(file)).length / KB);
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
report.push(`js: ${jsFiles.length} chunks, ${totalJs} kB gzip total, largest ${biggestJs.kb} kB (${biggestJs.file})`);
if (biggestJs.kb > BUDGETS.maxJsChunkGzipKb) {
  failures.push(`largest JS chunk ${biggestJs.kb} kB gzip exceeds ${BUDGETS.maxJsChunkGzipKb} kB (${biggestJs.file})`);
}
if (totalJs > BUDGETS.totalJsGzipKb) {
  failures.push(`total JS ${totalJs} kB gzip exceeds ${BUDGETS.totalJsGzipKb} kB`);
}

// ── CSS ──
const cssFiles = distFiles.filter((f) => extname(f) === '.css');
let biggestCss = { file: '', kb: 0 };
for (const f of cssFiles) {
  const kb = await gzipKb(f);
  if (kb > biggestCss.kb) biggestCss = { file: f.replace(DIST, ''), kb };
}
report.push(`css: largest ${biggestCss.kb} kB gzip (${biggestCss.file})`);
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
