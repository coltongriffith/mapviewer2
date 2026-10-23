import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1600, height: 1000 } });
test('editor controls have useful accessible names across steps and inspector groups', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/api/track', r => r.fulfill({ status: 204 }));
  await page.goto('/?demo=1');
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  const inspector = page.locator('[data-em="inspector"]');
  async function audit(scope) {
    const controls = scope.locator('button:visible, input:not([type="hidden"]):visible, select:visible, textarea:visible');
    for (const c of await controls.all()) {
      const html = await c.evaluate(el => el.outerHTML.slice(0, 350));
      await expect.soft(c, html).toHaveAccessibleName(/[a-zA-Z0-9]/, { timeout: 500 });
    }
  }
  await audit(page.locator('[data-em="toolbar"]'));
  for (const step of ['data', 'style', 'customize', 'annotate', 'export']) {
    await page.locator(`[data-em="step-${step}"]`).click();
    await audit(inspector);
    // Inspect disclosures one at a time, including mutually exclusive groups.
    const toggles = inspector.locator('.section-toggle-btn');
    for (let i = 0; i < await toggles.count(); i++) {
      const toggle = toggles.nth(i);
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      await audit(inspector);
    }
  }
  await page.locator('[data-em="step-data"]').click();
  const nearby = inspector.getByRole('button', { name: 'Nearby Claims', exact: true });
  if (await nearby.getAttribute('aria-expanded') === 'false') await nearby.click();
  await expect(page.locator('[data-em="nearby-claims-jurisdiction"]')).toHaveAccessibleName(/Province|Jurisdiction/);
});
