import { test, expect } from '@playwright/test';

// Esri's tiles are unreachable from this environment, so these do not assert
// that imagery appears. They assert the parts that are OURS and that no unit
// test can see: choosing the mode really mounts a Leaflet map, that map carries
// the class and the panes the exporter reaches for, and the extent box exists.
//
// Whether Esri serves a picture is Esri's business. Whether we ask for one, and
// whether the export can find what we asked for, is ours — and "looks right on
// screen, blank in the PDF" is precisely the failure this feature risks.

async function openInsetPanel(page) {
  // ?demo= loads sample layers — without data there is no extent to box,
  // and the box is half of what a locator is for.
  await page.goto('/?demo=1');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  // Open whichever collapsible section holds the inset controls.
  const control = page.locator('#f-inset-mode');
  if (await control.count() === 0) {
    const headings = page.locator('button, summary, .section-header, h3');
    const n = await headings.count();
    for (let i = 0; i < n; i += 1) {
      const text = (await headings.nth(i).innerText().catch(() => '')) || '';
      if (/inset|locator/i.test(text)) {
        await headings.nth(i).click().catch(() => {});
        if (await control.count() > 0) break;
      }
    }
  }
  return control;
}

test('choosing Satellite Locator mounts a map the exporter can find', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const control = await openInsetPanel(page);
  await expect(control, 'the Inset Style control was never reachable').toHaveCount(1, { timeout: 15_000 });

  await expect(control.locator('option[value="satellite_locator"]')).toHaveCount(1);
  await control.selectOption('satellite_locator');

  const inset = page.locator('.satellite-inset-map');
  await expect(inset, 'the satellite inset never mounted').toHaveCount(1, { timeout: 15_000 });

  // A real Leaflet map, with the tile pane getTileImages() queries.
  await expect(inset.locator('.leaflet-tile-pane')).toHaveCount(1, { timeout: 15_000 });
  // The "you are here" box the exporter redraws — a locator without it is
  // just a photograph.
  await expect(inset.locator('.leaflet-overlay-pane path')).toHaveCount(1, { timeout: 15_000 });

  const box = await inset.boundingBox();
  expect(box.width).toBeGreaterThan(10);
  expect(box.height).toBeGreaterThan(10);

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('it requests satellite imagery, and switching imagery changes the request', async ({ page }) => {
  const tileHosts = new Set();
  page.on('request', (r) => {
    const u = r.url();
    if (/World_Imagery|World_Topo_Map|basemaps\.cartocdn/.test(u)) tileHosts.add(u.split('/MapServer')[0].split('/rastertiles')[0]);
  });

  const control = await openInsetPanel(page);
  await expect(control).toHaveCount(1, { timeout: 15_000 });
  await control.selectOption('satellite_locator');
  await expect(page.locator('.satellite-inset-map')).toHaveCount(1, { timeout: 15_000 });
  await page.waitForTimeout(2000);

  // It asked Esri for imagery, even though the request cannot succeed here.
  expect([...tileHosts].some((h) => /World_Imagery/.test(h)), `saw: ${[...tileHosts].join(', ')}`).toBe(true);

  // And the Imagery picker actually changes the source.
  const basemap = page.locator('#f-inset-basemap');
  await expect(basemap, 'the Imagery picker did not appear for this mode').toHaveCount(1);
  await basemap.selectOption('terrain');
  await page.waitForTimeout(2000);
  expect([...tileHosts].some((h) => /World_Topo_Map/.test(h)), `saw: ${[...tileHosts].join(', ')}`).toBe(true);
});

test('the other inset styles still work', async ({ page }) => {
  const control = await openInsetPanel(page);
  await expect(control).toHaveCount(1, { timeout: 15_000 });
  await control.selectOption('satellite_locator');
  await expect(page.locator('.satellite-inset-map')).toHaveCount(1, { timeout: 15_000 });

  // Switching back must tear the Leaflet map down, or its tiles would be
  // captured into an export that is meant to show the vector locator.
  await control.selectOption('province_state');
  await expect(page.locator('.satellite-inset-map')).toHaveCount(0, { timeout: 15_000 });
});

test('the exporter can find and place the inset tiles', async ({ page }) => {
  // The whole risk of this feature: right on screen, blank in the PDF. Esri is
  // unreachable here so the tiles carry no pixels, but the export path's
  // contract is still checkable — it locates the container by class, reads the
  // tile <img> elements out of it, and maps their positions into the panel.
  const control = await openInsetPanel(page);
  await expect(control).toHaveCount(1, { timeout: 15_000 });
  await control.selectOption('satellite_locator');
  await expect(page.locator('.satellite-inset-map')).toHaveCount(1, { timeout: 15_000 });
  await page.waitForTimeout(2500);

  const capture = await page.evaluate(() => {
    // Mirrors getTileImages() in export/renderScene.js.
    const container = document.querySelector('.satellite-inset-map');
    if (!container) return { found: false };
    const root = container.getBoundingClientRect();
    const tiles = [...container.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')].map((img) => {
      const r = img.getBoundingClientRect();
      return { href: img.currentSrc || img.src, x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height };
    }).filter((t) => t.href && t.w > 0 && t.h > 0);
    const box = container.querySelector('.leaflet-overlay-pane path');
    return {
      found: true,
      containerW: root.width,
      containerH: root.height,
      tileCount: tiles.length,
      allFromEsri: tiles.every((t) => /World_Imagery/.test(t.href)),
      hasBox: !!box,
    };
  });

  expect(capture.found, 'the exporter could not locate the inset container').toBe(true);
  expect(capture.containerW).toBeGreaterThan(10);
  expect(capture.tileCount, 'no tile elements for the exporter to capture').toBeGreaterThan(0);
  expect(capture.allFromEsri, 'a captured tile came from somewhere unexpected').toBe(true);
  expect(capture.hasBox, 'the extent box the exporter redraws was missing').toBe(true);
});
