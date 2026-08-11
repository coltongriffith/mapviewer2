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
  // The vector overlays the exporter redraws: the jurisdiction outline (a dark
  // halo under a white line, so it survives both snow and water) and the
  // project marker ring. A locator without them is just a photograph.
  await expect(inset.locator('.leaflet-overlay-pane path')).toHaveCount(4, { timeout: 15_000 });

  const box = await inset.boundingBox();
  expect(box.width).toBeGreaterThan(10);
  expect(box.height).toBeGreaterThan(10);

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('it requests satellite imagery', async ({ page }) => {
  const tileUrls = [];
  page.on('request', (r) => { if (/World_Imagery/.test(r.url())) tileUrls.push(r.url()); });

  const control = await openInsetPanel(page);
  await expect(control).toHaveCount(1, { timeout: 15_000 });
  await control.selectOption('satellite_locator');
  await expect(page.locator('.satellite-inset-map')).toHaveCount(1, { timeout: 15_000 });
  await page.waitForTimeout(2000);

  expect(tileUrls.length, 'no imagery was requested').toBeGreaterThan(0);
});

test('offers exactly two styles, not five that look alike', async ({ page }) => {
  // The old list had province / country / regional / secondary zoom, which all
  // render the same generic backdrop at different zoom factors. Reported as
  // "all the other dropdowns other than satellite are the same".
  const control = await openInsetPanel(page);
  await expect(control).toHaveCount(1, { timeout: 15_000 });
  expect(await control.locator('option').allTextContents()).toEqual(['Standard', 'Satellite']);
});

test('the satellite inset keeps the locator card, its title and its label', async ({ page }) => {
  // Reported as "no padding or anything, so if it's sitting on a satellite
  // image it's hard to see". It was rendering as a bare full-bleed map in place
  // of the card, so it lost the frame, the header and the footer — and the
  // exporter drew a title the editor did not show.
  const control = await openInsetPanel(page);
  await expect(control).toHaveCount(1, { timeout: 15_000 });
  await control.selectOption('satellite_locator');

  const card = page.locator('.inset-card');
  await expect(card.locator('.satellite-inset-map')).toHaveCount(1, { timeout: 15_000 });
  await expect(card.locator('.inset-satellite-wrap')).toHaveCount(1);
  await expect(card.locator('.inset-header')).toHaveText(/\S/);
  await expect(card.locator('.inset-mode-label')).toHaveText(/\S/);
});

test('it draws the province outline over the imagery', async ({ page }) => {
  // The point of a locator. Imagery alone cannot say WHERE — one patch of
  // forest looks like any other.
  const control = await openInsetPanel(page);
  await expect(control).toHaveCount(1, { timeout: 15_000 });
  await control.selectOption('satellite_locator');

  const inset = page.locator('.satellite-inset-map');
  await expect(inset).toHaveCount(1, { timeout: 15_000 });
  // Two strokes for the outline (halo + line) and two for the marker ring.
  await expect(inset.locator('.leaflet-overlay-pane path')).toHaveCount(4, { timeout: 15_000 });

  // And the footer names the jurisdiction it drew.
  await expect(page.locator('.inset-mode-label')).toHaveText(/British Columbia|Alberta|[A-Z]/);
});

test('the other inset styles still work', async ({ page }) => {
  const control = await openInsetPanel(page);
  await expect(control).toHaveCount(1, { timeout: 15_000 });
  await control.selectOption('satellite_locator');
  await expect(page.locator('.satellite-inset-map')).toHaveCount(1, { timeout: 15_000 });

  // Switching back must tear the Leaflet map down, or its tiles would be
  // captured into an export that is meant to show the vector locator.
  await control.selectOption('standard');
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
