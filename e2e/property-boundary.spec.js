import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { createInitialProjectState } from '../shared/projectState.js';

// Synthetic QA polygons, never a claim/ownership assertion: A and B share an
// edge, A contains a hole, and C is separated by a positive geographic gap.
// Declare exact six-decimal fixture positions, avoiding JS arithmetic tails
// that the existing draft coordinate serializer deliberately normalizes.
const ring = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
  .map((position) => position.map((v) => Number(v.toFixed(6))));
const source = { type: 'FeatureCollection', features: [
  ['A', [ring(-120, 50, .02, .04), ring(-119.996, 50.012, .006, .008)]],
  ['B', [ring(-119.98, 50, .02, .04)]],
  ['C', [ring(-119.954, 50, .016, .04)]],
].map(([id, coordinates], i) => ({ type: 'Feature', id: `qa-${id}`, properties: {
  TENURE_NUMBER_ID: `QA-${id}`, PROJECT_NAME: 'Synthetic boundary QA', Cu_ppm: (i + 1) * 10,
}, geometry: { type: 'Polygon', coordinates } })) };

async function draft(page) {
  const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
  return JSON.parse(raw?.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw)?.payload;
}

const boundary = (page) => page.locator('.property-boundary-controls');
const outline = (page) => page.locator('.leaflet-emFxboundary-pane canvas');

// Inspect the actual painted overlay, not only its status message. Its opaque
// extent must shrink when the disconnected C polygon is hidden, then recover.
async function paintedBounds(page) {
  return outline(page).evaluate((canvas) => {
    const { width, height } = canvas;
    const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let pixels = 0, minX = width, maxX = -1, minY = height, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!rgba[(y * width + x) * 4 + 3]) continue;
      pixels++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { pixels, minX, maxX, minY, maxY };
  });
}

async function settledBounds(page) {
  let last, stable = 0;
  await expect.poll(async () => {
    const next = await paintedBounds(page);
    stable = JSON.stringify(next) === JSON.stringify(last) ? stable + 1 : 0;
    last = next;
    return next.pixels > 0 && stable >= 2;
  }).toBe(true);
  return last;
}

async function selectLayer(page) {
  await page.getByRole('tab', { name: 'Customize', exact: true }).click();
  const layers = page.locator('.ins-acc-heading button', { hasText: /^Layers/ });
  if (await layers.getAttribute('aria-expanded') !== 'true') await layers.click();
  await page.locator('.layer-item').click();
  await expect(boundary(page)).toBeVisible();
}

for (const mobile of [false, true]) {
  test(`property exterior remains opt-in, editable, exportable and restorable (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 });
    const initial = createInitialProjectState();
    await page.addInitScript((payload) => {
      if (sessionStorage.getItem('boundary-fixture')) return;
      localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload, projectId: null, projectName: '' }));
      sessionStorage.setItem('boundary-fixture', '1');
    }, initial);
    await page.addInitScript(() => {
      // Repeated pixel inspection can move Chrome from GPU to software Canvas
      // rasterization halfway through a test, changing one-pixel antialias
      // fringes despite identical paths/transforms. Choose its readback backend
      // up front for this isolated fixture; no product state is changed.
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, options) {
        return getContext.call(this, type, type === '2d' ? { ...options, willReadFrequently: true } : options);
      };
    });
    await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
    await page.goto('/?intent=resume');
    if (mobile) await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('tab', { name: 'Data', exact: true }).click();
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload shapefile, GeoJSON, KML, CSV or georeferenced image', exact: true }).click();
    await (await choosing).setFiles({ name: 'property-claims.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(source)) });
    // The first successful upload advances the ordinary editor to Style, so
    // the Data panel's layer row is no longer mounted. Confirm the imported
    // project through its real autosave instead of expecting a hidden panel.
    await expect.poll(async () => (await draft(page))?.layers?.length).toBe(1);
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    await page.getByRole('radio', { name: /Property & Neighbours/ }).check();
    await selectLayer(page);
    const checkbox = boundary(page).getByRole('checkbox', { name: 'Emphasize property boundary', exact: true });
    await expect(checkbox).not.toBeChecked();
    await expect(outline(page)).toHaveCount(0);
    await checkbox.check();
    await expect(boundary(page).getByRole('status')).toContainText('Property boundary emphasized');
    await expect.poll(async () => (await paintedBounds(page)).pixels).toBeGreaterThan(0);
    await expect(outline(page)).toHaveCSS('pointer-events', 'none');
    const full = await settledBounds(page);
    await expect.poll(async () => (await draft(page))?.layout?.propertyBoundaryOutline).toBe(true);
    const selected = await draft(page);
    expect(selected.layers[0].geojson).toEqual(source);
    expect(selected.layout.primaryLayerId).toBe(selected.layers[0].id);

    // Existing selection modes temporarily remove the overlay; they do not
    // clear the saved choice or replace the original selectable features.
    const style = page.getByRole('group', { name: 'Style individual shapes', exact: true });
    await style.getByRole('button', { name: 'Select on map', exact: true }).click();
    await expect(boundary(page).getByRole('status')).toContainText('pauses while individual claims');
    await expect.poll(async () => (await paintedBounds(page)).pixels).toBe(0);
    await expect(checkbox).toBeChecked();
    if (!mobile) {
      // Ordinary polygons use Leaflet Canvas, not SVG DOM hit targets. Locate
      // B's known interior within the full painted geographic extent, then
      // send a real pointer click to the canvas-backed source geometry.
      const hit = await outline(page).evaluate((canvas, bounds) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + (bounds.minX + (bounds.maxX - bounds.minX) * 30 / 62) * rect.width / canvas.width,
          y: rect.top + (bounds.minY + bounds.maxY) / 2 * rect.height / canvas.height,
        };
      }, full);
      await page.mouse.click(hit.x, hit.y);
      await expect(page.getByText('Claim QA-B', { exact: true })).toBeVisible();
    }
    await style.getByRole('button', { name: 'Done styling', exact: true }).click();
    await expect(boundary(page).getByRole('status')).toContainText('Property boundary emphasized');
    await expect.poll(() => paintedBounds(page)).toEqual(full);
    const trim = page.getByRole('group', { name: 'Remove individual shapes', exact: true });
    await trim.getByRole('button', { name: 'Select on map', exact: true }).click();
    await expect(boundary(page).getByRole('status')).toContainText('pauses while individual claims');
    await expect.poll(async () => (await paintedBounds(page)).pixels).toBe(0);
    await trim.getByRole('button', { name: 'Done removing', exact: true }).click();
    await trim.getByRole('button', { name: 'List (3)', exact: true }).click();
    const claimC = page.locator('.ftl-row').filter({ hasText: 'Claim QA-C' }).getByRole('checkbox');
    await claimC.uncheck();
    await expect.poll(async () => (await paintedBounds(page)).maxX).toBeLessThan(full.maxX);
    await expect.poll(async () => (await draft(page))?.layers?.[0]?.featureOverrides?.['qa-C']?.hidden).toBe(true);
    expect((await draft(page)).layers[0].geojson).toEqual(source);
    await claimC.check();
    await expect.poll(() => paintedBounds(page)).toEqual(full);
    await expect.poll(async () => (await draft(page))?.layers?.[0]?.featureOverrides?.['qa-C']?.hidden === true).toBe(false);

    // History must restore the choice as well as its painted result.
    await checkbox.uncheck();
    await expect(outline(page)).toHaveCount(0);
    if (mobile) await page.getByRole('complementary', { name: 'Map inspector', exact: true }).getByRole('button', { name: 'Done', exact: true }).click();
    if (mobile) await page.keyboard.press('Control+z');
    else await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await paintedBounds(page)).pixels).toBeGreaterThan(0);
    await expect.poll(async () => (await draft(page))?.layout?.propertyBoundaryOutline).toBe(true);

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Image for slides and web PNG', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download with watermark', exact: true }).click();
    const pngPath = testInfo.outputPath(`property-boundary-${mobile ? 'mobile' : 'desktop'}.png`);
    await (await downloading).saveAs(pngPath);
    const png = await readFile(pngPath);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBeGreaterThan(1000);
    await testInfo.attach(`property-boundary-${mobile ? 'mobile' : 'desktop'}.png`, { path: pngPath, contentType: 'image/png' });
    const saved = await draft(page);
    expect(saved.layers[0].geojson).toEqual(source);
    await page.goto('/?intent=resume');
    await expect.poll(async () => (await draft(page))?.layout?.propertyBoundaryOutline).toBe(true);
    await expect.poll(async () => (await paintedBounds(page)).pixels).toBeGreaterThan(0);
    expect((await draft(page)).layers[0].geojson).toEqual(source);
    if (mobile) await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await selectLayer(page);
    await expect(boundary(page).getByRole('checkbox', { name: 'Emphasize property boundary', exact: true })).toBeChecked();
    await expect(boundary(page).getByRole('status')).toContainText('Property boundary emphasized');
  });
}
