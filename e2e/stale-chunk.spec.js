import { test, expect } from '@playwright/test';

// A tab opened before a deploy asks for a hashed chunk the deploy removed: the largest group in
// error_events ("Failed to fetch dynamically imported module: …/assets/App-….js", MapStyleGallery,
// LegendEditor, …). It must never show the crash screen or lose work (src/utils/preloadGuard.js).

function watch(page) {
  const seen = { documents: [], reports: [], errors: [] };
  page.on('request', (r) => { if (r.resourceType() === 'document' && r.frame() === page.mainFrame()) seen.documents.push(r.url()); });
  page.on('pageerror', (e) => seen.errors.push(e.message));
  return seen;
}

async function stubTelemetry(page, seen) {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/client-error', (route) => { seen.reports.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }); });
}

// The chunk 404s, as a removed one does, until `gone()` says the deploy has been picked up.
async function removeChunk(page, pattern, gone) {
  await page.route(pattern, (route) => (gone() ? route.fulfill({ status: 404, body: 'Not found' }) : route.continue()));
}

test('a stale editor chunk reloads once for the new build, keeping the URL, with no crash screen', async ({ page }) => {
  const seen = watch(page);
  await stubTelemetry(page, seen);
  // Gone for the page that was open across the deploy; there after its reload.
  await removeChunk(page, '**/assets/App-*.js', () => seen.documents.length < 2);

  await page.goto('/?demo=1');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  expect(seen.documents).toHaveLength(2);
  expect(new URL(seen.documents[1]).search).toBe('?demo=1');
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  expect(seen.errors).toEqual([]);
  // Logged, as an update reload rather than a crash.
  await expect.poll(() => seen.reports.map((r) => r.kind)).toContain('stale_chunk');
  expect(seen.reports.filter((r) => r.kind === 'react' || r.kind === 'unhandledrejection')).toEqual([]);
});

test('a chunk still missing after the reload offers "Reload to update", never the crash screen', async ({ page }) => {
  const seen = watch(page);
  await stubTelemetry(page, seen);
  await removeChunk(page, '**/assets/App-*.js', () => true);

  await page.goto('/?demo=1');
  await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible({ timeout: 30_000 });
  expect(seen.documents).toHaveLength(2); // one reload, then no loop
  await page.waitForTimeout(1500);
  expect(seen.documents).toHaveLength(2);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('with unsaved work a stale part does not reload: the work stays and the reload is the user\'s', async ({ page }) => {
  const seen = watch(page);
  await stubTelemetry(page, seen);
  let gone = false;
  await removeChunk(page, '**/assets/LegendEditor-*.js', () => gone);

  await page.goto('/?demo=1');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  const layers = await page.locator('.leaflet-overlay-pane path, .leaflet-pane canvas').count();
  expect(layers).toBeGreaterThan(0);
  // Unsaved work, as App.jsx marks it for a signed-in user with unsaved cloud changes: a beforeunload
  // guard that prevents leaving.
  await page.evaluate(() => addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; }));

  // The deploy lands; the legend editor's chunk is now gone.
  gone = true;
  await page.getByRole('tab', { name: /^customize$/i }).first().click();
  await page.locator('.ins-acc-heading button', { hasText: /^Legend/ }).first().click();

  await expect(page.getByText('This part was updated — save your work, then reload.')).toBeVisible({ timeout: 15_000 });
  const notice = page.locator('.update-notice');
  await expect(notice).toContainText('A new version is available — save your work, then reload.');
  await expect(notice.getByRole('button', { name: 'Reload' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(seen.documents).toHaveLength(1); // no reload
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  // The editor and its map are still there.
  expect(await page.locator('.leaflet-overlay-pane path, .leaflet-pane canvas').count()).toBe(layers);
  await expect.poll(() => seen.reports.find((r) => r.kind === 'stale_chunk')?.context).toEqual({ outcome: 'notice', unsaved: true });
});

test('a healthy load does not reload or report', async ({ page }) => {
  const seen = watch(page);
  await stubTelemetry(page, seen);
  await page.goto('/?demo=1');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  expect(seen.documents).toHaveLength(1);
  expect(seen.reports.filter((r) => r.kind === 'stale_chunk')).toEqual([]);
});

test('/3d reports uncaught errors and rejections to error_events, like the 2D app', async ({ page }) => {
  const seen = watch(page);
  await stubTelemetry(page, seen);
  await page.goto('/3d');
  await page.waitForFunction(() => typeof window.EM3D === 'object', null, { timeout: 30_000 });
  await page.evaluate(() => {
    setTimeout(() => { throw new Error('3d test: uncaught'); });
    Promise.reject(new Error('3d test: rejected'));
    Promise.reject(new Error('3d test: rejected')); // a repeat within the minute is not sent twice
  });
  await expect.poll(() => seen.reports.map((r) => `${r.kind}: ${r.message}`).sort()).toEqual([
    'error: 3d test: uncaught',
    'unhandledrejection: 3d test: rejected',
  ]);
  expect(seen.reports[0]).toMatchObject({ path: '/3d', release: expect.any(String), sessionId: expect.any(String) });
});

test('/3d reloads once for a stale chunk loaded without Vite\'s preload wrapper', async ({ page }) => {
  const seen = watch(page);
  await stubTelemetry(page, seen);
  await page.goto('/3d');
  await page.waitForFunction(() => typeof window.EM3D === 'object', null, { timeout: 30_000 });
  // A bare import() of a chunk the deploy removed, as Safari words it.
  await page.evaluate(() => { Promise.reject(new TypeError('Importing a module script failed.')); });
  await expect.poll(() => seen.documents.length).toBe(2);
  await expect.poll(() => seen.reports.map((r) => r.kind)).toContain('stale_chunk');
  expect(seen.reports.filter((r) => r.kind === 'unhandledrejection')).toEqual([]);
});
