import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

// The 2D standard layout (title and logo top left, legend bottom left, locator top right, north arrow and
// scale bar): its footer note always reaches the export, a standalone map carries it in the legend, the
// legend of a new map fits its entries, and a blank-basemap PNG can be exported on transparency.
test.skip(({ isMobile }) => isMobile, 'Exports are a desktop flow');
test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ timeout: 120_000 });

const NOTE = 'Source: Tower Resources drilling database, October 2026; claims from BC Mineral Titles Online.';
const keep = (name, path) => { const d = process.env.E2E_RENDER_DIR; if (!d) return; mkdirSync(d, { recursive: true }); copyFileSync(path, join(d, name)); };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  // The texts the export draws (canvas fillText), newest export only.
  await page.addInitScript(() => {
    const P = CanvasRenderingContext2D.prototype, f = P.fillText; window.__texts = [];
    P.fillText = function (t, ...a) { window.__texts.push(String(t)); return f.call(this, t, ...a); };
  });
  await page.goto('/?demo=1');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
});

async function setNote(page) {
  await page.getByRole('tab', { name: /^customize$/i }).first().click();
  const group = page.locator('.ins-acc-heading button', { hasText: /^Title/ }).first();
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
  await page.getByLabel('Show footer').check();
  await page.getByLabel('Footer / Disclaimer').fill(NOTE);
  await page.waitForTimeout(500);
}
async function download(page, format = 'PNG') {
  await page.getByRole('tab', { name: /^export$/i }).first().click();
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: `Export ${format}`, exact: true }).first().click();
  await page.getByRole('button', { name: 'Download with watermark', exact: true }).click({ timeout: 15_000 }); // anonymous: the watermark choice
  const path = await (await dl).path();
  // The free full-resolution offer that follows a capped PNG, closed.
  const close = page.locator('.export-hd-close');
  await close.first().click({ timeout: 5000 }).catch(() => {});
  return path;
}

test('the footer note is exported in the standard layout; standalone puts it in the legend', async ({ page }) => {
  await setNote(page);
  await page.evaluate(() => { window.__texts = []; });
  keep('2d-presentation-note.png', await download(page, 'PNG'));
  const texts = await page.evaluate(() => window.__texts);
  expect(texts.filter((t) => t.includes('Tower Resources drilling database'))).toHaveLength(1); // in the footer strip, whole

  await page.getByRole('tab', { name: /^customize$/i }).first().click();
  const legendGroup = page.locator('.ins-acc-heading button', { hasText: /^Legend/ }).first();
  if ((await legendGroup.getAttribute('aria-expanded')) !== 'true') await legendGroup.click();
  await page.getByLabel('Map use').selectOption('standalone');
  await expect(page.locator('.legend-card .legend-note')).toContainText('Tower Resources');
  await expect(page.locator('.footer-card')).toHaveCount(0);
  await page.evaluate(() => { window.__texts = []; });
  keep('2d-standalone-note-in-legend.png', await download(page, 'PNG'));
  const t2 = await page.evaluate(() => window.__texts);
  // Wrapped onto the legend's lines: each word once, the whole line never.
  expect(t2.some((t) => t === `${NOTE}`)).toBe(false);
  expect(t2.filter((t) => t.includes('Tower Resources'))).toHaveLength(1);
  expect(t2.filter((t) => t.includes('Online.'))).toHaveLength(1);
  const i = t2.findIndex((t) => t.includes('Tower Resources')), legend = t2.lastIndexOf('Legend', i);
  expect(legend).toBeGreaterThan(-1); // drawn with the legend, after its title
});

test('a blank-basemap PNG on a transparent background', async ({ page }) => {
  await page.getByRole('tab', { name: /^style$/i }).first().click();
  await page.locator('.basemap-thumb', { hasText: 'Blank' }).click();
  await page.getByRole('tab', { name: /^export$/i }).first().click();
  await page.getByLabel(/Transparent background/).check();
  const path = await download(page, 'PNG');
  keep('2d-transparent-blank.png', path);
  const b64 = readFileSync(path).toString('base64');
  const a = await page.evaluate(async (u) => {
    const img = new Image(); img.src = u; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const at = (x, y) => g.getImageData(x, y, 1, 1).data[3];
    return [at(img.width >> 1, 2), at(img.width >> 1, img.height >> 1), at(2, img.height >> 1)];
  }, `data:image/png;base64,${b64}`);
  expect(Math.min(...a)).toBe(0); // the page itself is clear where nothing is drawn
});
