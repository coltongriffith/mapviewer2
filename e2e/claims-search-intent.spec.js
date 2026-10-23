import { test, expect } from '@playwright/test';

// The Quebec and Ontario guides lead with a search box that GETs the editor's
// deep link (/?intent=claims&region=…&mode=…&q=…). These follow a searcher from
// the guide into the registry search, with the registry mocked.

const square = (x, y) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y + 0.01], [x, y]]] });
const qcClaim = (tag, i) => ({
  type: 'Feature',
  properties: { TAG_NUMBER: tag, OWNER_NAME: 'Example Holder inc.', STATUS: 'Active', GOOD_TO_DATE: '2028-06-17', AREA_IN_HECTARES: 52.4, TITLE_TYPE_DESCRIPTION: 'CDC' },
  geometry: square(-74.4 + i * 0.011, 49.9),
});

function mockRegistry(page, answer) {
  const requests = [];
  page.route('**/api/claims?*', (route) => {
    const url = new URL(route.request().url());
    requests.push(Object.fromEntries(url.searchParams));
    return route.fulfill({ json: answer(url.searchParams) });
  });
  return requests;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
});

test('the Quebec guide\'s search box runs a pasted list of claim numbers in the editor', async ({ page }) => {
  const requests = mockRegistry(page, (p) => {
    const asked = p.get('q').split(' ');
    const held = asked.filter((n) => n !== '2351790');
    return {
      type: 'FeatureCollection',
      features: held.map(qcClaim),
      meta: { numberList: { requested: asked.length, total: asked.length, truncated: false, max: 100, found: held, missing: asked.filter((n) => !held.includes(n)) } },
    };
  });
  await page.goto('/blog/how-to-search-quebec-mining-claims/');
  const form = page.getByRole('search', { name: /Search Quebec mining claims/ });
  await form.getByRole('combobox', { name: 'Search by' }).selectOption('number');
  await form.getByRole('searchbox').fill('#2351771, 2351772 2351790');
  await form.getByRole('button', { name: 'Search claims' }).click();

  await expect(page.getByRole('button', { name: 'Claim #' })).toHaveClass(/active/);
  await expect(page.getByText('Found 2 of 3 claim numbers.')).toBeVisible();
  await expect(page.getByText(/Not in our Quebec data: 2351790/)).toBeVisible();
  await expect(page.getByRole('link', { name: /GESTIM/ })).toHaveAttribute('href', 'https://gestim.mines.gouv.qc.ca/');
  expect(requests).toEqual([{ q: '2351771 2351772 2351790', type: 'number', province: 'qc' }]);
  // The query string was dropped once read, so a reload does not search again.
  await expect(page).toHaveURL(/\/$/);
});

test('a company name typed into Claim # is searched as a company, and says so', async ({ page }) => {
  const requests = mockRegistry(page, () => ({ type: 'FeatureCollection', features: [qcClaim('2535433', 0)], meta: {} }));
  await page.goto('/?intent=claims&region=quebec');
  await page.getByRole('button', { name: 'Claim #' }).click();
  await page.getByRole('textbox', { name: 'Claim number' }).fill('big ridge gold corp');
  await page.getByRole('textbox', { name: 'Claim number' }).press('Enter');
  await expect(page.getByText(/isn't a claim number, so we searched it as a company name/)).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Company', exact: true })).toHaveClass(/active/);
  expect(requests[0]).toMatchObject({ q: 'big ridge gold corp', type: 'company', province: 'qc' });
});

test('a Quebec number we do not hold says so and links to GESTIM', async ({ page }) => {
  mockRegistry(page, () => ({ type: 'FeatureCollection', features: [], meta: {} }));
  await page.goto('/?intent=claims&region=quebec&q=4527312&mode=number');
  await expect(page.getByText('No active claims found for "4527312" in Quebec.')).toBeVisible();
  await expect(page.getByText(/refreshed weekly/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Look it up in GESTIM ↗' })).toHaveAttribute('href', 'https://gestim.mines.gouv.qc.ca/');
});

test('the Ontario guide leads with its search box and opens Ontario\'s registry search', async ({ page }) => {
  const requests = mockRegistry(page, () => ({ type: 'FeatureCollection', features: [], meta: {} }));
  await page.setViewportSize({ width: 390, height: 664 });   // iPhone 13 with browser chrome
  await page.goto('/blog/how-to-search-ontario-mining-claims/');
  // On a phone the box is on the first screen, before the guide.
  const form = page.getByRole('search', { name: /Search Ontario mining claims/ });
  await expect(form.getByRole('button', { name: 'Search claims' })).toBeInViewport();
  await expect(form).toContainText('verify in MLAS');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await form.getByRole('searchbox').fill('Agnico Eagle');
  await form.getByRole('button', { name: 'Search claims' }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0]).toMatchObject({ q: 'Agnico Eagle', type: 'company', province: 'on' });
});

test('an area link loads the claims around its point', async ({ page }) => {
  const bboxes = [];
  await page.route('**/api/claims?*', (route) => {
    const p = new URL(route.request().url()).searchParams;
    bboxes.push(Object.fromEntries(p));
    return route.fulfill({ json: { type: 'FeatureCollection', features: [qcClaim('2351771', 0)], meta: {} } });
  });
  await page.goto('/?intent=claims&region=quebec&mode=area&q=49.9,-74.4');
  await expect.poll(() => bboxes.length).toBeGreaterThan(0);
  expect(bboxes[0].province).toBe('qc');
  const [w, s, e, n] = bboxes[0].bbox.split(',').map(Number);
  expect((w + e) / 2).toBeCloseTo(-74.4, 3);
  expect((s + n) / 2).toBeCloseTo(49.9, 3);
  await expect(page.getByText(/1 claims found within 25 km/)).toBeVisible();
});

test('the existing claims link still opens an empty Quebec search', async ({ page }) => {
  const requests = mockRegistry(page, () => ({ type: 'FeatureCollection', features: [], meta: {} }));
  await page.goto('/?intent=claims&region=quebec&utm_source=blog');
  await expect(page.getByRole('combobox').first()).toHaveValue('qc');
  await expect(page.getByRole('textbox', { name: 'Claim search' })).toHaveValue('');
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
});

// Manitoba publishes no holder, so its box offers claim numbers and area only.
test('the Manitoba guide\'s search box runs a claim-number search in Manitoba', async ({ page }) => {
  const requests = mockRegistry(page, () => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { TAG_NUMBER: 'MB16982', CLAIM_NAME: 'SEA16982', AREA_IN_HECTARES: 208 }, geometry: square(-101.88, 55.04) }],
    meta: {},
  }));
  await page.goto('/blog/how-to-search-manitoba-mining-claims/');
  const form = page.getByRole('search', { name: /Search Manitoba mining claims/ });
  const mode = form.getByRole('combobox', { name: 'Search by' });
  await expect(mode.locator('option')).toHaveText(['Claim number(s)', 'Area (latitude, longitude)']);
  await expect(form).toContainText('verify in iMaQs');
  await form.getByRole('searchbox').fill('MB16982');
  await form.getByRole('button', { name: 'Search claims' }).click();
  await expect(page.getByRole('button', { name: 'Claim #' })).toHaveClass(/active/);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0]).toMatchObject({ q: 'MB16982', type: 'number', province: 'mb' });
});

test('the Manitoba guide\'s area search loads the claims around its point', async ({ page }) => {
  const bboxes = mockRegistry(page, () => ({ type: 'FeatureCollection', features: [], meta: {} }));
  await page.goto('/blog/how-to-search-manitoba-mining-claims/');
  const form = page.getByRole('search', { name: /Search Manitoba mining claims/ });
  await form.getByRole('combobox', { name: 'Search by' }).selectOption('area');
  await form.getByRole('searchbox').fill('54.77, -101.88');
  await form.getByRole('button', { name: 'Search claims' }).click();
  await expect.poll(() => bboxes.length).toBeGreaterThan(0);
  expect(bboxes[0].province).toBe('mb');
  const [w, s, e, n] = bboxes[0].bbox.split(',').map(Number);
  expect((w + e) / 2).toBeCloseTo(-101.88, 3);
  expect((s + n) / 2).toBeCloseTo(54.77, 3);
});

for (const [slug, name] of [
  ['how-to-map-bc-mineral-claims-live-registry', /Search BC mineral claims/],
  ['bc-mineral-titles-online-guide', /Look up a BC claim/],
]) test(`the BC guide ${slug} searches BC owners from its search box`, async ({ page }) => {
  const requests = mockRegistry(page, () => ({ type: 'FeatureCollection', features: [], meta: {} }));
  await page.goto(`/blog/${slug}/`);
  const form = page.getByRole('search', { name });
  await expect(form).toContainText('verify in MTO');
  await form.getByRole('searchbox').fill('Teck');
  await form.getByRole('button', { name: 'Search claims' }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0]).toMatchObject({ q: 'Teck', type: 'company', province: 'bc' });
});
