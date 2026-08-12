import { test, expect } from '@playwright/test';

// The legend is derived from the layers on the map, so editing is a layer of
// overrides on top of that derivation. These drive the real controls: a unit
// test can prove applyLegendCustomization is correct and still leave a panel
// that never reaches the state it computes.

async function openLegendItems(page) {
  await page.goto('/?demo=1');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  // The panel lives in a <details>, so its markup is in the DOM either way —
  // open it, or every interaction below silently targets a hidden control.
  const summary = page.getByText('Legend Items', { exact: true });
  await summary.click();
  const editor = page.locator('.legend-editor');
  await expect(editor.locator('.legend-editor-add')).toBeVisible({ timeout: 15_000 });
  return editor;
}

test('the legend editor lists the entries the map derived', async ({ page }) => {
  const editor = await openLegendItems(page);
  await expect(editor).toHaveCount(1, { timeout: 15_000 });
  await expect(editor.locator('.legend-editor-row').first()).toBeVisible();
});

test('renaming an entry changes the legend on the map', async ({ page }) => {
  const editor = await openLegendItems(page);
  await expect(editor).toHaveCount(1, { timeout: 15_000 });

  const before = await page.locator('.legend-item').first().innerText();
  await editor.locator('.legend-editor-label').first().fill('Renamed On Purpose');
  await page.waitForTimeout(500);

  const legendText = await page.locator('.legend-list').first().innerText();
  expect(legendText, `legend still reads "${before}"`).toContain('Renamed On Purpose');
});

test('removing an entry takes it off the legend but leaves the layer drawn', async ({ page }) => {
  const editor = await openLegendItems(page);
  await expect(editor).toHaveCount(1, { timeout: 15_000 });

  const rowsBefore = await page.locator('.legend-item').count();
  const pathsBefore = await page.locator('.leaflet-overlay-pane path, .leaflet-pane canvas').count();

  await editor.locator('.legend-editor-btn').first().click();
  await page.waitForTimeout(500);

  expect(await page.locator('.legend-item').count()).toBe(rowsBefore - 1);
  // The promise the panel makes: the shape stays on the map.
  expect(await page.locator('.leaflet-overlay-pane path, .leaflet-pane canvas').count()).toBe(pathsBefore);

  // And it can be put back.
  await editor.locator('.legend-editor-btn').first().click();
  await page.waitForTimeout(500);
  expect(await page.locator('.legend-item').count()).toBe(rowsBefore);
});

test('an added item appears on the legend with its symbol and colour', async ({ page }) => {
  const editor = await openLegendItems(page);
  await expect(editor).toHaveCount(1, { timeout: 15_000 });

  const rowsBefore = await page.locator('.legend-item').count();
  await editor.locator('.legend-editor-add').click();
  await page.waitForTimeout(300);

  const customRow = editor.locator('.legend-editor-row.is-custom').last();
  await customRow.locator('.legend-editor-label').fill('Mill Site');
  await customRow.locator('.legend-editor-symbol').selectOption('square');
  await page.waitForTimeout(500);

  expect(await page.locator('.legend-item').count()).toBe(rowsBefore + 1);
  await expect(page.locator('.legend-list').first()).toContainText('Mill Site');

  // Deleting it removes the row again.
  await customRow.locator('.legend-editor-btn').click();
  await page.waitForTimeout(500);
  expect(await page.locator('.legend-item').count()).toBe(rowsBefore);
});

test('the legend swatch shows the marker shape, not always a circle', async ({ page }) => {
  // The editor legend drew a circle for every point layer while both exporters
  // drew the real shape, so a triangle layer read as a circle on screen and a
  // triangle in the client's PDF.
  const editor = await openLegendItems(page);
  await expect(editor).toHaveCount(1, { timeout: 15_000 });
  await editor.locator('.legend-editor-add').click();
  await page.waitForTimeout(300);
  const customRow = editor.locator('.legend-editor-row.is-custom').last();
  await customRow.locator('.legend-editor-label').fill('Adit');
  await customRow.locator('.legend-editor-symbol').selectOption('triangle');
  await page.waitForTimeout(500);

  const shapes = await page.locator('.legend-symbol-marker svg polygon').count();
  expect(shapes, 'the legend swatch is not drawing the chosen shape').toBeGreaterThan(0);
});
