// Renders the /3d OG image and the 3D guide figures from the built-in sample
// project (the fictional "Example Ridge"), never from client data.
//
//   npm run build
//   PORT=4391 node scripts/serve-like-vercel.mjs &      # in another shell
//   BASE=http://127.0.0.1:4391 node scripts/render-3d-shots.mjs [figure section shell cueq calc pending solid ui og]
//
// Writes WebP pairs to public/blog-img/3d/ (merging their sizes into
// scripts/blog-data/image-variants.json), the 1200x630 OG image to
// public/og/3d.png, and the raw PNG exports to RAW_DIR. The committed OG PNG
// was additionally re-saved with Pillow's optimize flag (lossless).
// Chromium encodes the WebP; this repo has no sharp or cwebp. Set
// PLAYWRIGHT_CHROMIUM_PATH to use a preinstalled browser.
/* global EM3D -- the /3d page's API, used inside page.evaluate callbacks */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = (process.env.RAW_DIR || path.join(os.tmpdir(), 'render-3d-shots')) + path.sep;
const IMG = path.join(REPO, 'public', 'blog-img', '3d');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(IMG, { recursive: true });
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});
const variants = {};

async function open({ width = 1440, height = 900, dsf = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dsf });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  await page.goto(`${BASE}/3d`);
  await page.waitForFunction(() => window.EM3D && window.EM3D.getState().files?.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return page;
}

// Encode a PNG data URL as WebP at the given widths, in the browser (no sharp in this repo).
async function webp(page, dataUrl, widths, quality = 0.84) {
  return page.evaluate(async ({ src, widths, quality }) => {
    const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = src; });
    return widths.map((w) => {
      const tw = Math.min(w, img.naturalWidth), th = Math.round(img.naturalHeight / img.naturalWidth * tw);
      const c = document.createElement('canvas'); c.width = tw; c.height = th;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, tw, th);
      return { uri: c.toDataURL('image/webp', quality), w: tw, h: th };
    });
  }, { src: dataUrl, widths, quality });
}

async function save(page, name, dataUrl, widths = [800, 1600]) {
  fs.writeFileSync(path.join(RAW, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  const out = await webp(page, dataUrl, widths);
  const list = [];
  out.forEach((o, i) => {
    const file = i === 0 ? `${name}.webp` : `${name}@2x.webp`;
    const buf = Buffer.from(o.uri.split(',')[1], 'base64');
    fs.writeFileSync(path.join(IMG, file), buf);
    list.push({ src: `/blog-img/3d/${file}`, width: o.w, height: o.h });
    console.log(`  ${file} ${o.w}x${o.h} ${Math.round(buf.length / 1024)} KB`);
  });
  variants[`/blog-img/3d/${name}.webp`] = list;
}

const exp = (page, view = '3d') => page.evaluate((v) => window.EM3D.exportPNG({ view: v }), view);

// 1. Default sample, news-release size: the how-to hero.
if (want('figure')) {
  const page = await open();
  await page.evaluate(() => { EM3D.setFigureSize('release'); EM3D.setCamera({ view: 'a' }); });
  await save(page, 'example-ridge-3d-figure', await exp(page));
  await page.close();
}

// 2. Section A-A'.
if (want('section')) {
  const page = await open();
  await page.evaluate(() => { EM3D.setFigureSize('release'); });
  await save(page, 'example-ridge-section', await exp(page, 'section'));
  await page.close();
}

// 3. Grade shell from assays (the sample's own OBJ hidden so only the interpolated shell shows).
if (want('shell')) {
  const page = await open();
  await page.evaluate(async () => {
    EM3D.setFigureSize('release');
    EM3D.setStyle({ meshes: { 'sample_shell_0.2pct.obj': { show: false } }, coCount: 3 });
    await EM3D.setShell({ enabled: true, cutoff: 0.2, opacity: 0.35 });
    EM3D.setCamera({ view: 'a' });
  });
  await page.waitForTimeout(500);
  await save(page, 'example-ridge-grade-shell', await exp(page));
  await page.close();
}

// 4. Copper equivalent column, coloured by CuEq; the formula goes to the footnote.
if (want('cueq')) {
  const page = await open();
  const st = await page.evaluate(() => {
    EM3D.setFigureSize('release');
    const s = EM3D.setEquivalent({ base: 'Cu', basePrice: 4.5, baseRecovery: 90, metals: { Au: { price: 3000, recovery: 80 } } });
    EM3D.setStyle({ autoBins: true, coCount: 4, meshes: { 'sample_shell_0.2pct.obj': { show: false } } });
    EM3D.setCamera({ view: 'a' });
    return { grade: s.grade, callouts: EM3D.getState().callouts.shown };
  });
  console.log(JSON.stringify(st));
  await save(page, 'example-ridge-cueq', await exp(page));
  await page.close();
}

if (want('calc')) {
  const page = await open({ dsf: 2 });
  await page.evaluate(() => { EM3D.setEquivalent({ base: 'Cu', basePrice: 4.5, baseRecovery: 90, metals: { Au: { price: 3000, recovery: 80 } } }); EM3D.showStep('layout'); });
  const det = page.locator('details:has(#eq-body)');
  await det.evaluate((d) => { d.open = true; d.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(300);
  const shot = await det.screenshot();
  await save(page, 'metal-equivalent-calculator', `data:image/png;base64,${shot.toString('base64')}`, [380, 760]);
  await page.close();
}

// 5. Assays pending and a provisional collar: two holes flagged in a Status column, their assays removed.
if (want('pending')) {
  const page = await open();
  const info = await page.evaluate(async () => {
    const proj = EM3D.getProject();
    const PENDING = new Set(['EX-019', 'EX-026']);
    const files = proj.files.map((f) => {
      if (f.role === 'collar') {
        const lines = f.text.split('\n');
        return { name: 'collars.csv', text: [lines[0] + ',Status', ...lines.slice(1).map((l) => `${l},${PENDING.has(l.split(',')[0]) ? 'Drilled, assays pending' : 'Assays received'}`)].join('\n') };
      }
      if (f.role === 'assay') {
        const lines = f.text.split('\n');
        return { name: 'assays.csv', text: [lines[0], ...lines.slice(1).filter((l) => !PENDING.has(l.split(',')[0]))].join('\n') };
      }
      return { name: f.name.replace(/^sample_/, ''), text: f.text };
    });
    EM3D.clearFiles();
    EM3D.addFiles(files);
    EM3D.setBrand({ company: 'Example Resources', title: 'EXAMPLE RIDGE · MAIN ZONE', subtitle: '3D drilling model · illustrative data', footnote: 'Intervals are core lengths; true widths are not known. Illustrative data.' });
    EM3D.setFigureSize('release');
    EM3D.setStyle({ coCount: 3, pendingLabels: true, meshes: { 'shell_0.2pct.obj': { show: false } } });
    EM3D.setProvisional('EX-034', true);
    EM3D.setCamera({ view: 'a' });
    return EM3D.getState().project.pendingHoles;
  });
  console.log('pending', info);
  await save(page, 'example-ridge-assays-pending', await exp(page));
  await page.close();
}

// 6. Solid block, shaded relief, labels painted on the block, slide size.
if (want('solid')) {
  const page = await open();
  await page.evaluate(() => {
    EM3D.setFigureSize('slide');
    EM3D.setStyle({ blockStyle: 'solid', terrain: 'relief', coCount: 3 });
    EM3D.addWallLabel({ text: 'MAIN ZONE', face: 'front', u: 0.5, v: 0.55, size: 'title' });
    EM3D.setCamera({ view: 'a' });
  });
  await page.waitForTimeout(400);
  await save(page, 'example-ridge-solid-block', await exp(page));
  await page.close();
}

// 8. Editor screenshots: the whole app, and the Export step.
if (want('ui')) {
  const page = await open({ width: 1440, height: 900 });
  await page.waitForTimeout(800);
  const app = await page.screenshot();
  await save(page, 'editor-data-step', `data:image/png;base64,${app.toString('base64')}`, [800, 1440]);
  await page.evaluate(() => EM3D.showStep('export'));
  await page.waitForTimeout(500);
  const app2 = await page.screenshot();
  await save(page, 'editor-export-step', `data:image/png;base64,${app2.toString('base64')}`, [800, 1440]);
  await page.close();
}

// 9. OG image: the slide-size figure fitted into 1200x630 on the figure's own white.
if (want('og')) {
  const page = await open();
  await page.evaluate(() => { EM3D.setFigureSize('slide'); EM3D.setStyle({ coCount: 4 }); EM3D.setCamera({ view: 'a' }); });
  const src = await exp(page);
  fs.writeFileSync(path.join(RAW, 'og-src.png'), Buffer.from(src.split(',')[1], 'base64'));
  const og = await page.evaluate(async (s) => {
    const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = s; });
    const c = document.createElement('canvas'); c.width = 1200; c.height = 630;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1200, 630);
    const h = 630, w = Math.round(img.naturalWidth * h / img.naturalHeight);
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, Math.round((1200 - w) / 2), 0, w, h);
    return { png: c.toDataURL('image/png'), webp: c.toDataURL('image/webp', 0.88), jpg: c.toDataURL('image/jpeg', 0.9) };
  }, src);
  for (const [k, v] of Object.entries(og)) fs.writeFileSync(path.join(RAW, `og.${k}`), Buffer.from(v.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(REPO, 'public', 'og', '3d.png'), Buffer.from(og.png.split(',')[1], 'base64'));
  await page.close();
}

const variantsFile = path.join(REPO, 'scripts', 'blog-data', 'image-variants.json');
const all = JSON.parse(fs.readFileSync(variantsFile, 'utf8'));
fs.writeFileSync(variantsFile, `${JSON.stringify({ ...all, ...variants }, null, 2)}\n`);
await browser.close();
