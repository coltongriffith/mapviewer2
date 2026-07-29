import { test, expect } from '@playwright/test';

// P1-20: form labels were not associated with their controls, so clicking a
// label did nothing and screen readers announced unlabelled fields.

test('every htmlFor points at a control that actually exists', async ({ page }) => {
  await page.goto('/?intent=drill-results');
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });

  const orphans = await page.evaluate(() => {
    const bad = [];
    for (const l of document.querySelectorAll('label[for]')) {
      const target = document.getElementById(l.htmlFor);
      if (!target) bad.push(`${l.htmlFor} (${l.textContent.trim().slice(0, 30)})`);
    }
    return bad;
  });
  expect(orphans, `labels pointing at nothing:\n${orphans.join('\n')}`).toEqual([]);
});

test('ids are unique — a duplicate silently breaks association', async ({ page }) => {
  await page.goto('/?intent=drill-results');
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });

  const dupes = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('[id]')) {
      seen.set(el.id, (seen.get(el.id) || 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
  });
  expect(dupes, `duplicate ids:\n${dupes.join('\n')}`).toEqual([]);
});

test('clicking a label focuses its control', async ({ page }) => {
  await page.goto('/?intent=drill-results');
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });

  // Find a label whose target is a text input — the case a user notices.
  const pair = await page.evaluate(() => {
    for (const l of document.querySelectorAll('label[for]')) {
      const t = document.getElementById(l.htmlFor);
      if (t && t.tagName === 'INPUT' && ['text', 'number', ''].includes(t.type) && t.offsetParent) {
        return { forId: l.htmlFor };
      }
    }
    return null;
  });
  test.skip(!pair, 'no visible text input with an associated label on this screen');

  await page.locator(`label[for="${pair.forId}"]`).click();
  await expect(page.locator(`#${pair.forId}`)).toBeFocused();
});
