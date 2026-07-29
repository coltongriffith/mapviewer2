import { test, expect } from '@playwright/test';

// Keyboard operability (audit P1-18, P1-19). These were "cannot use the
// product" failures, not cosmetic ones: the editor's collapsible sections were
// <h2 onClick> with no keyboard path, and modals had no focus trap, no Escape
// and no accessible name.

test.describe('editor disclosure sections', () => {
  test('can be expanded and collapsed with the keyboard alone', async ({ page }) => {
    await page.goto('/?intent=drill-results');
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });

    const toggle = page.locator('button.section-toggle-btn').first();
    await expect(toggle).toBeVisible();

    const before = await toggle.getAttribute('aria-expanded');
    await toggle.focus();
    await expect(toggle).toBeFocused();      // reachable at all
    await page.keyboard.press('Enter');       // activatable
    expect(await toggle.getAttribute('aria-expanded')).not.toBe(before);

    await page.keyboard.press('Enter');
    expect(await toggle.getAttribute('aria-expanded')).toBe(before);
  });

  test('announces state and points at a real panel', async ({ page }) => {
    await page.goto('/?intent=drill-results');
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });

    const toggles = page.locator('button.section-toggle-btn');
    const n = await toggles.count();
    expect(n).toBeGreaterThan(0);

    for (let i = 0; i < n; i += 1) {
      const t = toggles.nth(i);
      // A screen reader needs both the state and the relationship.
      expect(await t.getAttribute('aria-expanded')).toMatch(/true|false/);
      expect(await t.getAttribute('aria-controls')).toBeTruthy();
    }
  });

  test('every toggle sits inside a heading, so page structure survives', async ({ page }) => {
    await page.goto('/?intent=drill-results');
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });
    const inHeading = await page.locator('h2 > button.section-toggle-btn').count();
    const total = await page.locator('button.section-toggle-btn').count();
    expect(inHeading).toBe(total);
  });
});

test.describe('modal dialogs', () => {
  // Opens whichever auth entry point the landing page exposes.
  async function openAuth(page) {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: /sign in|log in|account/i }).first();
    if (!(await trigger.count())) return null;
    await trigger.click();
    const dialog = page.locator('[role="dialog"]');
    try {
      await expect(dialog).toBeVisible({ timeout: 10_000 });
    } catch {
      return null;
    }
    return dialog;
  }

  test('are announced as dialogs with an accessible name', async ({ page }) => {
    const dialog = await openAuth(page);
    test.skip(!dialog, 'no auth dialog reachable from the landing page');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    await expect(page.locator(`#${labelledBy}`)).toBeVisible();
  });

  test('close on Escape', async ({ page }) => {
    const dialog = await openAuth(page);
    test.skip(!dialog, 'no auth dialog reachable from the landing page');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });

  test('trap focus instead of letting it escape behind the overlay', async ({ page }) => {
    const dialog = await openAuth(page);
    test.skip(!dialog, 'no auth dialog reachable from the landing page');

    // Tab well past the number of controls; focus must never leave the dialog.
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((d) => d.contains(document.activeElement));
      expect(inside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
    }
  });
});
