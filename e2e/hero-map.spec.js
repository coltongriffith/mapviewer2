import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { auroraDrillholes } from '../src/assets/auroraDemo.js';

test('hero opens the pictured, editable exploration map and exports a PNG', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open this map as a live demo', exact: true }).click();
  await expect(page.locator('.map-stage')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cedar Ridge Project', exact: true })).toBeVisible();
  await expect(page.locator('.map-stage')).toContainText('Geology, Soil Geochemistry & Drill Targets');
  await expect(page.locator('.map-stage img[alt="Logo"]')).toBeVisible();

  for (const name of ['Bedrock Geology', 'Claim Boundary', 'Access / power corridor', 'Soil Samples (Cu ppm)', 'Target Areas', 'Drill Collars']) {
    await expect(page.getByRole('button', { name: `${name} visibility`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  // The displayed intercepts must describe the actual drill collars, not
  // independently typed marketing labels that drift away from the data.
  for (const holeId of ['CR-24-01', 'CR-24-05', 'CR-24-12']) {
    const hole = auroraDrillholes.features.find((feature) => feature.properties.HoleID === holeId);
    await expect(page.locator('.map-stage')).toContainText(holeId);
    await expect(page.locator('.map-stage')).toContainText(hole.properties.result);
  }
  const composition = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    const title = box('.title-card'), legend = box('.legend-card');
    const overlaps = title.left < legend.right && title.right > legend.left && title.top < legend.bottom && title.bottom > legend.top;
    const card = document.querySelector('.legend-card');
    const stage = box('.map-stage');
    const calloutsInside = [...document.querySelectorAll('.map-callout')].every((node) => {
      const r = node.getBoundingClientRect();
      return r.left >= stage.left + 28 && r.top >= stage.top + 28 && r.right <= stage.right - 28 && r.bottom <= stage.bottom - 28;
    });
    return { overlaps, clippedLegend: card.scrollHeight > card.clientHeight + 1, calloutsInside };
  });
  expect(composition).toEqual({ overlaps: false, clippedLegend: false, calloutsInside: true });

  const points = page.locator('.leaflet-overlay-pane path');
  await expect.poll(() => points.count()).toBeGreaterThan(500);
  const fullCount = await points.count();
  const soils = page.getByRole('button', { name: 'Soil Samples (Cu ppm) visibility', exact: true });
  await soils.click();
  await expect(soils).toHaveAttribute('aria-pressed', 'false');
  await expect(points).toHaveCount(14);
  await soils.click();
  await expect(points).toHaveCount(fullCount);
  // Layer names can be edited: this is the working editor, not a static view.
  await page.getByRole('textbox', { name: 'Display Label', exact: true }).fill('2024 drill collars');
  await expect(page.getByRole('button', { name: '2024 drill collars visibility', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Export PNG', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Export PNG — remove the watermark' })).toBeVisible();
  const downloadReady = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Download with watermark', exact: true }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toMatch(/cedar-ridge-exploration-map.*\.png$/);
  const file = testInfo.outputPath('hero-map-export.png');
  await download.saveAs(file);
  const png = await readFile(file);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBeGreaterThan(500);
  expect(png.readUInt32BE(20)).toBeGreaterThan(400);
  expect(png.length).toBeGreaterThan(50_000);
  expect(errors).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`hero stays intact at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const image = page.locator('.lm-mock-img');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await image.evaluate((img) => img.currentSrc)).toContain('hero-exploration');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`hero-${width}.png`), fullPage: true });
  });
}
