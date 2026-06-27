// Capture real app screenshots for the blog image placeholders.
//
// Drives the editor (which runs fully offline via built-in sample data) with
// Playwright and writes focused PNGs to public/blog-img/. Registry shots show
// the panel state only (province selected + a name typed) — live results need a
// deployed backend that isn't available under local preview.
//
// Usage:
//   npm run build           # build first (preview serves dist/)
//   node scripts/capture-blog-shots.mjs
//
// Output: public/blog-img/*.png  (+ a summary of which shots succeeded)

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'blog-img');
const CSV = path.join(ROOT, 'scripts', 'blog-data', 'sample-collars.csv');
const PORT = 4188;
const BASE = `http://localhost:${PORT}/`;

fs.mkdirSync(OUT, { recursive: true });

const results = [];
async function shot(page, name, locatorOrFn) {
  try {
    const target = typeof locatorOrFn === 'function' ? await locatorOrFn() : locatorOrFn;
    await target.screenshot({ path: path.join(OUT, `${name}.png`) });
    const size = fs.statSync(path.join(OUT, `${name}.png`)).size;
    results.push({ name, ok: size > 4000, size });
    console.log(`  ${size > 4000 ? '✓' : '⚠'} ${name}.png (${Math.round(size / 1024)} KB)`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ✗ ${name}.png — ${err.message}`);
  }
}

async function closeModal(page) {
  // Dismiss any open overlay/modal so the next interaction is clean. These
  // modals don't close on Escape, so click the ✕ button when present.
  const x = page.locator('.export-hd-close');
  if (await x.count()) { try { await x.first().click({ timeout: 2000 }); } catch { /* noop */ } }
  try { await page.keyboard.press('Escape'); } catch { /* noop */ }
  await page.waitForTimeout(250);
}

// ── start vite preview ────────────────────────────────────────────────────────
console.log(`Starting vite preview on ${PORT}…`);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: 'ignore', detached: false,
});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('vite preview did not come up');
}

let browser;
try {
  await waitForServer();
  console.log('Preview is up. Launching browser…');
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(15000);

  // ── Phase A: sample-data editor session (map + styling shots) ───────────────
  console.log('Phase A: editor + sample data');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // Landing → editor
  const tryBtn = page.getByRole('button', { name: /try for free/i }).first();
  try { await tryBtn.click({ timeout: 5000 }); }
  catch { await page.locator('.landing-nav-actions .btn.primary, .btn.primary').first().click(); }
  // Editor (empty) → load sample mining data
  await page.locator('.sample-data-link').click();
  await page.waitForSelector('.map-stage .leaflet-container', { timeout: 20000 });
  await page.waitForTimeout(3500); // tiles + auto-fit settle

  await shot(page, 'map-claims', page.locator('.map-stage'));
  await shot(page, 'title-block', page.locator('.map-stage'));

  // The layer styling panel uses the generic `.control-grid` class (many on the
  // page), so scope to the always-open "Layers" section.
  const layersSection = page.locator('.control-section', { has: page.locator('h2', { hasText: 'Layers' }) }).first();

  // Claims layer → role/styling panel
  try {
    await page.locator('.layer-item', { hasText: /claim/i }).first().click();
    await layersSection.locator('.control-grid select').first().waitFor({ timeout: 5000 });
    await layersSection.locator('.control-grid select').first().selectOption('claims').catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, 'layer-claims-role', layersSection.locator('.control-grid').first());
  } catch (e) { results.push({ name: 'layer-claims-role', ok: false, err: e.message }); console.log('  ✗ layer-claims-role —', e.message); }

  // Drillholes layer → role/styling panel
  try {
    await page.locator('.layer-item', { hasText: /drill/i }).first().click();
    await layersSection.locator('.control-grid select').first().waitFor({ timeout: 5000 });
    await layersSection.locator('.control-grid select').first().selectOption('drillholes').catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, 'layer-drillholes-role', layersSection.locator('.control-grid').first());
  } catch (e) { results.push({ name: 'layer-drillholes-role', ok: false, err: e.message }); console.log('  ✗ layer-drillholes-role —', e.message); }

  // Ratio switcher (Landscape 16:9). The Export section is collapsed by default,
  // so expand it first.
  try {
    await page.locator('h2.section-toggle-btn', { hasText: 'Export' }).click();
    await page.waitForSelector('.ratio-switcher', { timeout: 5000 });
    await page.locator('.ratio-btn', { hasText: /landscape/i }).first().click();
    await page.waitForTimeout(500);
    await shot(page, 'ratio-169', page.locator('.ratio-switcher').first());
    await page.locator('.ratio-btn', { hasText: /landscape/i }).first().click(); // clear constraint
    await page.waitForTimeout(400);
  } catch (e) { results.push({ name: 'ratio-169', ok: false, err: e.message }); console.log('  ✗ ratio-169 —', e.message); }

  // Badge inline editor: grid-click the map to hit a drillhole, then set Badge
  try {
    const box = await page.locator('.map-stage').boundingBox();
    let opened = false;
    // Scan a central band (avoid the title block at the very top).
    outer:
    for (let dy = 0; dy <= box.height * 0.30 && !opened; dy += 14) {
      for (const sign of [1, -1]) {
        const y = box.y + box.height * 0.52 + sign * dy;
        for (let x = box.x + box.width * 0.30; x <= box.x + box.width * 0.70; x += 14) {
          await page.mouse.click(x, y);
          if (await page.locator('.drillhole-inline-editor').count()) { opened = true; break outer; }
        }
      }
    }
    if (!opened) throw new Error('could not hit a drillhole to open the feature editor');
    // Set callout type to Badge Label and add a chip value.
    const typeSelect = page.locator('.drillhole-inline-editor select').first();
    await typeSelect.selectOption('badge').catch(() => {});
    await page.waitForTimeout(300);
    const chip = page.locator('.drillhole-inline-editor input[placeholder*=">"], .drillhole-inline-editor input').nth(2);
    await chip.fill('32m @ 6.1 g/t Au').catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, 'badge-editor', page.locator('.drillhole-inline-editor'));
    await closeModal(page);
  } catch (e) { results.push({ name: 'badge-editor', ok: false, err: e.message }); console.log('  ✗ badge-editor —', e.message); }

  // ── Phase B: registry panels (UI only) ──────────────────────────────────────
  console.log('Phase B: registry panels');
  const provinces = [
    { code: 'bc', name: 'Teck Resources', file: 'registry-bc' },
    { code: 'on', name: 'Agnico Eagle', file: 'registry-on' },
    { code: 'qc', name: 'Osisko', file: 'registry-qc' },
    { code: 'nl', name: 'New Found Gold', file: 'registry-nl' },
  ];
  for (const p of provinces) {
    try {
      await closeModal(page);
      await page.locator('.add-claims-sidebar-btn').click();
      await page.locator('.claims-path-btn', { hasText: /search claims registry/i }).click();
      await page.waitForSelector('select.claims-province-select', { timeout: 5000 });
      await page.locator('select.claims-province-select').selectOption(p.code);
      await page.waitForTimeout(300);
      await page.locator('input.claims-search-input').fill(p.name).catch(() => {});
      await page.waitForTimeout(300);
      await shot(page, p.file, page.locator('.claims-modal-card'));
      await closeModal(page);
    } catch (e) { results.push({ name: p.file, ok: false, err: e.message }); console.log(`  ✗ ${p.file} —`, e.message); }
  }
  await closeModal(page);

  // ── Phase C: CSV Column Mapper ───────────────────────────────────────────────
  console.log('Phase C: column mapper');
  try {
    const fileInput = page.locator('input[type="file"][accept*="csv"]').first();
    await fileInput.setInputFiles(CSV);
    await page.waitForSelector('.export-hd-card', { timeout: 8000 });
    await page.waitForTimeout(500);
    await shot(page, 'column-mapper', page.locator('.export-hd-card').first());
    await closeModal(page);
  } catch (e) { results.push({ name: 'column-mapper', ok: false, err: e.message }); console.log('  ✗ column-mapper —', e.message); }

  await browser.close();
} catch (err) {
  console.error('FATAL:', err.message);
  if (browser) await browser.close().catch(() => {});
  process.exitCode = 1;
} finally {
  try { server.kill('SIGTERM'); } catch { /* noop */ }
}

// ── summary ──────────────────────────────────────────────────────────────────
const ok = results.filter(r => r.ok).length;
console.log(`\n${ok}/${results.length} shots captured.`);
const failed = results.filter(r => !r.ok);
if (failed.length) console.log('Incomplete:', failed.map(f => f.name).join(', '));
