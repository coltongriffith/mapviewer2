import { test, expect } from '@playwright/test';

// The inspector is five steps in the order a map is made: Data, Style,
// Customize, Annotate, Export. These walk the path a new visitor takes and the
// canvas shortcut into Customize — the two things the regrouping was for.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
});

test('a new map walks from data to export one step at a time', async ({ page }) => {
  const tab = (name) => page.getByRole('tab', { name, exact: true });
  await expect(tab('Data')).toHaveAttribute('aria-selected', 'true');

  // The first data lands on Style, not on the new layer's settings.
  await page.getByRole('button', { name: 'Try sample data' }).click();
  await expect(tab('Style')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });

  const claims = page.getByRole('radio', { name: /Claims & tenure/ });
  await claims.click();
  await expect(claims).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('button', { name: /Next: Customize/ }).click();
  await expect(tab('Customize')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /Next: Annotate/ }).click();
  await page.getByRole('button', { name: /Next: Export/ }).click();
  await expect(tab('Export')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /export png/i }).first()).toBeVisible();
  // Export is the last step: no Next button.
  await expect(page.getByRole('button', { name: /^Next:/ })).toHaveCount(0);
});

test('clicking the legend on the map opens its controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Try sample data' }).click();
  await expect(page.getByRole('tab', { name: 'Style', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });

  const legend = page.locator('.template-zone').filter({ has: page.locator('.legend-list') }).first();
  await expect(legend).toBeVisible();
  const box = await legend.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 16);

  await expect(page.getByRole('tab', { name: 'Customize', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#group-legend')).toBeVisible();
});

test('clicking the selected layer in Data still opens its settings', async ({ page }) => {
  const tab = (name) => page.getByRole('tab', { name, exact: true });
  await page.getByRole('button', { name: 'Try sample data' }).click();
  await expect(tab('Style')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });

  // First click selects the layer; the second clicks it while it is already
  // selected, which changes no state.
  for (let i = 0; i < 2; i += 1) {
    await tab('Data').click();
    await page.locator('#ins-panel-data .layer-item').first().click();
    await expect(tab('Customize')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#group-layers')).toBeVisible();
  }
});
