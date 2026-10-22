import { test, expect } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';

// Import a company figure, end to end in the built app: a picture in, placed by
// clicked points (with the fit error), one unit traced by colour, the credit
// line written, added to the map, exported, and still there after a reload.

// A 400 × 300 "figure" at 2 m per pixel, drawn turned 30° anticlockwise, its
// top-left corner at 663 000 E, 5 608 000 N: speckled imagery, a pink unit at x 100–300, y 60–240
// crossed by a white line, and a white title box.
function figurePng() {
  const w = 400, h = 300, raw = Buffer.alloc((w * 3 + 1) * h);
  let s = 11;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x += 1) {
      const n = (rnd() - 0.5) * 40;
      let c = [70 + n, 95 + n, 60 + n];
      if (x >= 100 && x < 300 && y >= 60 && y < 240) c = [214 + n / 4, 150 + n / 4, 176 + n / 4];
      if (y === 150 || y === 151) c = [255, 255, 255];
      if (x < 80 && y < 40) c = [255, 255, 255];
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const C = 2 * Math.cos(Math.PI / 6), S = 2 * Math.sin(Math.PI / 6);
const E = (x, y) => Math.round((663000 + C * x - S * y) * 10) / 10;
const N = (x, y) => Math.round((5608000 - S * x - C * y) * 10) / 10;

test('a company figure is placed by points, traced by colour, credited and kept', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const fillText = proto.fillText, transform = proto.transform;
    window.__drawn = { texts: [], turned: 0 };
    proto.fillText = function (text, ...rest) { window.__drawn.texts.push(String(text)); return fillText.call(this, text, ...rest); };
    proto.transform = function (...m) { if (m.length === 6 && m[1] !== 0) window.__drawn.turned += 1; return transform.apply(this, m); };
  });
  // No basemap tiles needed: the fit, the trace and the export are what is checked.
  await page.route(/^https:\/\/server\.arcgisonline\.com\//, (route) => route.abort());
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Import a company figure/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a company figure' });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'test-fig-1.png', mimeType: 'image/png', buffer: figurePng() });
  const canvas = dialog.locator('.fig-canvas');
  await expect(canvas).toBeVisible();
  await dialog.getByLabel('Zone').fill('10');

  const clickFigure = (x, y) => canvas.evaluate((el, [px, py]) => {
    const r = el.getBoundingClientRect();
    const z = r.width / el.querySelector('img').naturalWidth;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + px * z, clientY: r.top + py * z }));
  }, [x, y]);
  const addPoint = async (i, x, y, dx = 0) => {
    await clickFigure(x, y);
    await dialog.getByLabel(`Point ${i} easting`).fill(String(E(x, y) + dx));
    await dialog.getByLabel(`Point ${i} northing`).fill(String(N(x, y)));
  };

  // Two points: a similarity, exact.
  await addPoint(1, 50, 50);
  await addPoint(2, 350, 260);
  await expect(dialog.getByTestId('fig-fit')).toContainText('Similarity');
  await expect(dialog.getByTestId('fig-fit')).toContainText('exact fit');
  // A third: affine. A fourth typed 12 m off: an RMS error in metres.
  await addPoint(3, 40, 280);
  await expect(dialog.getByTestId('fig-fit')).toContainText('Affine');
  await addPoint(4, 380, 20, 12);
  await expect(dialog.getByTestId('fig-fit')).toContainText(/RMS error \d+(\.\d)? m/);
  await expect(dialog.getByTestId('fig-fit')).toContainText(/drawn turned (29\.\d|30\.\d)° anticlockwise · 2\.0\d m per pixel/);

  // Trace the pink unit by one sample.
  await dialog.getByRole('tab', { name: '2 · Trace colours' }).click();
  await clickFigure(200, 100);
  await dialog.getByLabel('Unit name').fill('Pink diorite');
  // Its fill taken from a "legend swatch" (the white title box here).
  await dialog.getByRole('button', { name: 'Fill from legend' }).click();
  await clickFigure(20, 20);
  await expect(dialog.getByLabel('Fill colour')).toHaveValue('#ffffff');
  await dialog.getByLabel('Fill colour').fill('#d6a0b4');
  await dialog.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(dialog.getByText('1 area', { exact: true })).toBeVisible({ timeout: 30_000 });

  // The credit line follows the source and date.
  await dialog.getByRole('tab', { name: '3 · Credit' }).click();
  await dialog.getByLabel('Source').fill('Test Fig. 1');
  await dialog.getByLabel('Date').fill('15 Oct 2026');
  const credit = 'Geology (simplified) after Test Fig. 1 (15 Oct 2026)';
  await expect(dialog.getByLabel('Credit line')).toHaveValue(credit);
  await dialog.getByRole('button', { name: 'Add to map' }).click();
  await expect(dialog).toBeHidden();

  // The figure is drawn by its corners, and the traced unit is a legend entry.
  await expect(page.locator('.leaflet-container img.leaflet-image-layer').first()).toHaveAttribute('style', /matrix\(/, { timeout: 15_000 });
  await expect(page.locator('.legend-list').first()).toContainText('Pink diorite');

  // The PNG export prints the credit line and draws the picture by its corners
  // (an anonymous map: SVG is a Pro export, so the canvas calls are read).
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Export PNG', exact: true }).first().click();
  await page.getByRole('button', { name: 'Download with watermark', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  const drawn = await page.evaluate(() => window.__drawn);
  expect(drawn.texts).toContain(credit);
  expect(drawn.turned).toBeGreaterThan(0);

  // Saved with the map: still there after a reload.
  await page.waitForTimeout(1500);
  await page.goto('/?intent=resume');
  await expect(page.locator('.legend-list').first()).toContainText('Pink diorite', { timeout: 30_000 });
  await expect(page.locator('.leaflet-container img.leaflet-image-layer').first()).toHaveAttribute('style', /matrix\(/, { timeout: 15_000 });
});
