// Render the landing-page example maps from the app itself.
//
// Each gallery card is a real demo project (assets/galleryDemos.js). The
// picture on the card should be that project as the app draws it today, not
// a screenshot taken before the last dozen features landed. This loads each
// demo in the built app, waits for the basemap tiles, and screenshots the
// stage in preview mode (no editing chrome). 1x at an 1800px viewport: the
// WebP variants optimize-images cuts are at most 1740px wide, and a 2x PNG
// is 9 MB in the repo for nothing.
//
//   node scripts/render-gallery.mjs            # all cards + the hero
//   node scripts/render-gallery.mjs target     # one card
//
// Needs `npm run build` first and a Chromium (PLAYWRIGHT_CHROMIUM_PATH).
// Follow with `node scripts/optimize-images.mjs` for the WebP variants.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;

// name → demo id and the aspect the card draws it at.
const CARDS = {
  target: { demo: 'target', ratio: 1.6 },
  geology: { demo: 'geology', ratio: 1.6 },
  regional: { demo: 'regional', ratio: 1.6 },
  // The hero is drawn at 870px, 1740 at 2x; satellite imagery compresses
  // badly as PNG, so it is rendered narrower to stay under the image budget.
  'ba-after': { demo: 'aurora_demo', ratio: 870 / 653, width: 1600 },
};
const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(CARDS);

const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve-like-vercel.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

// Behind an HTTPS proxy Chromium needs telling (it ignores HTTPS_PROXY), and
// the tile hosts only complete the handshake through it at TLS 1.2 — the
// certificate check itself stays on.
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', ...(proxy ? ['--ssl-version-max=tls1.2'] : [])],
  ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}),
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});

async function tilesSettled(page) {
  // Every tile in the pane loaded, and the count unchanged for a moment.
  let last = -1;
  for (let i = 0; i < 60; i += 1) {
    const { total, loaded } = await page.evaluate(() => ({
      total: document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile').length,
      loaded: document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile-loaded').length,
    }));
    if (total > 0 && loaded === total && total === last) return true;
    last = total;
    await page.waitForTimeout(500);
  }
  return false;
}

try {
  for (const name of names) {
    const card = CARDS[name];
    if (!card) { console.log(`unknown card ${name}`); continue; }
    const context = await browser.newContext({ viewport: { width: card.width || 1800, height: 1100 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${BASE}/?demo=${card.demo}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForSelector('.map-stage', { timeout: 60_000 });
    // Preview mode hides the delete buttons, resize handles and drag affordances.
    await page.evaluate(() => {
      document.querySelector('.app-shell')?.setAttribute('data-preview', 'true');
      const style = document.createElement('style');
      style.textContent = '.panel-delete-btn,.resize-handle,.callout-resize-handle,.drillhole-inline-editor,.resize-guide,.canvas-drag-guide-v,.canvas-drag-guide-h{display:none!important}';
      document.head.appendChild(style);
    });
    // Size the viewport so the stage has the card's aspect: the stage fills
    // the map viewport, whose height follows the window.
    for (let pass = 0; pass < 3; pass += 1) {
      const box = await page.locator('.map-stage').boundingBox();
      const wantH = Math.round(box.width / card.ratio);
      if (Math.abs(box.height - wantH) < 2) break;
      const vp = page.viewportSize();
      await page.setViewportSize({ width: vp.width, height: Math.max(600, vp.height + (wantH - box.height)) });
      await page.waitForTimeout(400);
    }
    await tilesSettled(page);
    await page.waitForTimeout(1500);
    const png = await page.locator('.map-stage').screenshot({ type: 'png' });
    const out = path.join(ROOT, 'public/gallery', `${name}.png`);
    writeFileSync(out, png);
    const box = await page.locator('.map-stage').boundingBox();
    console.log(`${name}: ${Math.round(box.width)}x${Math.round(box.height)} → ${path.relative(ROOT, out)} (${(png.length / 1024).toFixed(0)} kB)`);
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
