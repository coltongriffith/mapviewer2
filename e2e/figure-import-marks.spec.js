import proj4 from 'proj4';
import { test, expect } from '@playwright/test';
import { deflateSync, inflateRawSync, crc32 } from 'node:zlib';
import { canvas, segment, dashed, polygon, text, star, circle, BLACK, GOLD, WHITE } from '../tests/fixtures/synthFigure.js';

// Import a company figure, lines and points: colours picked by clicking the
// figure, a dashed fault and symbols detected, each find reviewed by clicking
// it, and only the accepted ones added to the map, styled as suggested.

// A 480 × 360 figure, tested north-up and rotated at 2 m per pixel, anchored at
// 663 000 E, 5 608 000 N: a dashed black fault, two gold stars and a gold
// circle, black and gold lettering, and a white line (another colour).
const W = 480, H = 360;
const FAULT = [[40, 300], [440, 180]];
function figurePng() {
  const img = canvas(W, H, 5, [150, 158, 120]);
  dashed(img, FAULT, 4, BLACK, 12, 8);
  polygon(img, star(150, 120, 13), GOLD);
  polygon(img, star(330, 250, 13), GOLD);
  circle(img, 400, 90, 9, GOLD);
  text(img, 'FAULT', 60, 40, 1.5, BLACK);
  text(img, 'TREND', 200, 320, 1.5, GOLD);
  segment(img, [40, 70], [440, 140], 3, WHITE);
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y += 1) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x += 1) for (let k = 0; k < 3; k += 1) raw[y * (W * 3 + 1) + 1 + x * 3 + k] = img.data[(y * W + x) * 4 + k];
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const UTM = '+proj=utm +zone=10 +datum=NAD83 +units=m +no_defs';
for (const rotation of [0, 45]) {
  const angle = rotation * Math.PI / 180;
  const work = (x, y) => [663000 + 2 * (Math.cos(angle) * x + Math.sin(angle) * y), 5608000 + 2 * (Math.sin(angle) * x - Math.cos(angle) * y)];

  test(`lines and points are reviewed and placed correctly with a ${rotation} degree fit`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
    await page.route(/^https:\/\/server\.arcgisonline\.com\//, (route) => route.abort());
    await page.goto('/?intent=resume');
    await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /Import a company figure/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Import a company figure' });
    await dialog.locator('input[type=file]').setInputFiles({ name: 'test-fig-2.png', mimeType: 'image/png', buffer: figurePng() });
    const figure = dialog.locator('.fig-canvas');
    await expect(figure).toBeVisible();
    // The synthetic imagery is flat enough to read as a blank page: kept whole.
    await expect(dialog.getByLabel("Hide the scan's blank margins")).toBeChecked({ timeout: 15_000 });
    await dialog.getByLabel("Hide the scan's blank margins").uncheck();
    await expect(figure.locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
    await dialog.getByLabel('Zone').fill('10');
    // Real clicks on the figure, at figure pixels.
    const clickFigure = async (x, y) => {
      const z = await figure.evaluate((el) => el.getBoundingClientRect().width / el.querySelector('img').naturalWidth);
      await figure.click({ position: { x: x * z, y: y * z } });
    };

    // Placed by two points (a similarity, exact).
    await clickFigure(50, 50);
    await dialog.getByLabel('Point 1 easting').fill(String(work(50, 50)[0]));
    await dialog.getByLabel('Point 1 northing').fill(String(work(50, 50)[1]));
    await clickFigure(430, 330);
    await dialog.getByLabel('Point 2 easting').fill(String(work(430, 330)[0]));
    await dialog.getByLabel('Point 2 northing').fill(String(work(430, 330)[1]));
    await expect(dialog.getByTestId('fig-fit')).toContainText('exact fit');

    // The fault's colour, picked on one of its dashes; the stars' on a star.
    await dialog.getByRole('tab', { name: '3 · Lines & points' }).click();
    await dialog.getByRole('button', { name: '+ Lines of a colour' }).click();
    await clickFigure(45.7, 298.3);
    await dialog.getByLabel('Layer name').first().fill('Fault (inferred)');
    await dialog.getByRole('button', { name: '+ Points of a colour' }).click();
    await clickFigure(150, 120);
    await dialog.getByLabel('Layer name').nth(1).fill('Discovery intersection');
    await expect(dialog.getByTestId('fig-mark')).toHaveCount(2);

    // Detect: one dashed line (the lettering is not a line), three symbols
    // (the lettering is not a symbol), styles suggested from what was found.
    await dialog.getByRole('button', { name: 'Detect', exact: true }).click();
    const lineSet = dialog.getByTestId('fig-mark').nth(0), pointSet = dialog.getByTestId('fig-mark').nth(1);
    await expect(lineSet.getByTestId('fig-review-count')).toHaveText('1 found · 0 accepted · 0 rejected', { timeout: 30_000 });
    await expect(pointSet.getByTestId('fig-review-count')).toHaveText('3 found · 0 accepted · 0 rejected');
    await expect(lineSet.getByLabel('Style')).toHaveValue('dashed');
    await expect(pointSet.getByLabel('Style')).toHaveValue('star');
    await expect(dialog.locator('.fig-footer')).toContainText('4 finds not reviewed (not added)');

    // Review by clicking the finds on the figure: the fault accepted …
    const fault = dialog.getByRole('button', { name: 'Line 1 of Fault (inferred): to review' });
    await fault.click();
    await expect(dialog.getByRole('button', { name: 'Line 1 of Fault (inferred): accepted' })).toBeVisible();
    // … all the symbols accepted, then the circle (not a discovery star) rejected on the figure.
    await pointSet.getByRole('button', { name: 'Accept all' }).click();
    await expect(pointSet.getByTestId('fig-review-count')).toHaveText('3 found · 3 accepted · 0 rejected');
    const finds = dialog.locator('g.fig-find:has(circle)');
    const xs = await finds.evaluateAll((els) => els.map((el) => Number(el.querySelector('circle').getAttribute('cx'))));
    const circleFind = finds.nth(xs.findIndex((x) => Math.abs(x - 400) < 3));
    await circleFind.click();
    await expect(circleFind).toHaveAttribute('data-status', 'rejected');
    await expect(pointSet.getByTestId('fig-review-count')).toHaveText('3 found · 2 accepted · 1 rejected');
    // A chip below toggles a find too: the fault rejected and accepted again.
    await lineSet.getByRole('button', { name: /Line 1$/ }).click();
    await expect(lineSet.getByTestId('fig-review-count')).toHaveText('1 found · 0 accepted · 1 rejected');
    await lineSet.getByRole('button', { name: /Line 1$/ }).click();
    await expect(lineSet.getByTestId('fig-review-count')).toHaveText('1 found · 1 accepted · 0 rejected');
    await expect(dialog.locator('.fig-footer')).toContainText('1 line and 2 points accepted');
    await expect(dialog.locator('.fig-footer')).not.toContainText('not reviewed');

    // Nothing is on the map until Add.
    await expect(page.locator('.legend-item', { hasText: 'Fault (inferred)' })).toHaveCount(0);
    await dialog.getByRole('tab', { name: '4 · Credit' }).click();
    await dialog.getByLabel('Source').fill('Test Fig. 2');
    await dialog.getByLabel('Date').fill('15 Oct 2026');
    await expect(dialog.getByLabel('Credit line')).toHaveValue('Structure (simplified) after Test Fig. 2 (15 Oct 2026)');
    await dialog.getByRole('button', { name: 'Add to map' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('.legend-list').first()).toContainText('Fault (inferred)');
    await expect(page.locator('.legend-list').first()).toContainText('Discovery intersection');
    // As saved: one dashed line, two stars (the rejected circle is not there).
    const saved = async () => {
      const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
      if (!raw) return null;
      const json = raw.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw;
      return (JSON.parse(json).payload?.layers || []).filter((l) => l.figure && l.type !== 'raster').map((l) => ({
        name: l.name, type: l.type, n: l.geojson.features.length, geom: l.geojson.features[0]?.geometry.type, dash: l.style.dashArray || null, shape: l.style.markerShape || null,
      }));
    };
    await expect.poll(saved, { timeout: 15_000 }).toEqual([
      { name: 'Fault (inferred)', type: 'line', n: 1, geom: 'LineString', dash: '8 5', shape: null },
      { name: 'Discovery intersection', type: 'points', n: 2, geom: 'Point', dash: null, shape: 'star' },
    ]);
    // Reproject persisted features to metres, independently of the image-to-map helper.
    // A 45-degree fit must move both the line and symbols, not just the raster preview.
    const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
    const json = raw.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw;
    const layers = JSON.parse(json).payload.layers;
    const stars = layers.find(l => l.name === 'Discovery intersection').geojson.features;
    for (const [x, y] of [[150, 120], [330, 250]]) {
      const expected = work(x, y);
      expect(Math.min(...stars.map(f => {
        const actual = proj4('EPSG:4326', UTM, f.geometry.coordinates);
        return Math.hypot(actual[0] - expected[0], actual[1] - expected[1]);
      }))).toBeLessThan(3);
    }
    const faultCoords = layers.find(l => l.name === 'Fault (inferred)').geojson.features[0].geometry.coordinates;
    for (const [x, y] of FAULT) {
      const expected = work(x, y);
      expect(Math.min(...faultCoords.map(c => {
        const actual = proj4('EPSG:4326', UTM, c);
        return Math.hypot(actual[0] - expected[0], actual[1] - expected[1]);
      }))).toBeLessThan(12); // Endpoint can stop at the final dash rather than its following gap.
    }
  });
}
