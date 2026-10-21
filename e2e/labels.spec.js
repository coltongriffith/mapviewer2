import { test, expect } from '@playwright/test';
import { createInitialProjectState } from '../shared/projectState.js';

// P1-20: form labels were not associated with their controls, so clicking a
// label did nothing and screen readers announced unlabelled fields.

test('every htmlFor points at a control that actually exists', async ({ page }) => {
  await page.goto('/?intent=resume');
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
  await page.goto('/?intent=resume');
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
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });

  // Customize is where the labelled text fields live (title, subtitle,
  // metadata); its Title & text group is open by default.
  const customizeTab = page.getByRole('tab', { name: /^customize$/i });
  if (await customizeTab.count()) await customizeTab.first().click();

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

// F2: the callout controls added for leader routing are labelled like the
// rest, and Auto-arrange clears an avoidable overlap in a project saved before
// the scored layout without moving the card the user pinned.
test('Auto-arrange clears callout overlaps and keeps the pinned card', async ({ page }) => {
  const project = createInitialProjectState();
  delete project.layout.layoutAlgorithm; // saved before the scored layout
  project.mapView = { center: { lat: 50, lng: -120 }, zoom: 12 };
  const at = (dLng, dLat) => ({ lat: 50 + dLat, lng: -120 + dLng });
  const callout = (id, anchor, extra = {}) => ({
    id, text: id, subtext: '2.4 g/t Au over 11 m', type: 'leader', priority: 2, anchor,
    offset: { x: 20, y: -18 }, boxWidth: 150, style: { fontSize: 12, paddingX: 10, paddingY: 8 }, ...extra,
  });
  project.callouts = [
    callout('DDH-1', at(0, 0), { priority: 1 }),
    // Pinned over DDH-1's default spot: the legacy layout placed DDH-1 first
    // (higher priority) and left the two overlapping.
    callout('Pinned', at(-0.002, 0.0005), { priority: 3, isManualPosition: true, offset: { x: 30, y: -10 } }),
    callout('DDH-2', at(0.03, -0.015)),
    callout('DDH-3', at(0.035, 0.012)),
    callout('DDH-4', at(-0.03, -0.015), { style: { fontSize: 12, paddingX: 10, paddingY: 8, leaderShape: 'elbow', anchorMark: 'dot' } }),
  ];
  const draft = JSON.stringify({ schemaVersion: 1, payload: project, projectId: null, projectName: 'Callout routing' });
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('f2-seeded')) return;
    localStorage.setItem('mapviewer.draft.v1', value);
    sessionStorage.setItem('f2-seeded', '1');
  }, draft);

  await page.goto('/?intent=resume');
  await expect(page.locator('.map-callout')).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator('.map-callout.collides')).not.toHaveCount(0);
  const pinnedBox = await page.locator('.map-callout', { hasText: 'Pinned' }).boundingBox();

  await page.locator('#ins-tab-annotate').click();
  const conflicts = page.locator('.callout-conflicts');
  await expect(conflicts).toContainText('Still overlapping');
  await conflicts.getByRole('button', { name: 'Focus' }).first().click();
  await expect(page.locator('.map-callout.selected')).toHaveCount(1);
  await expect(page.locator('label[for^="f-leaderShape-"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Auto-arrange' }).click();
  await expect(page.locator('.map-callout.collides')).toHaveCount(0);
  await expect(conflicts).toHaveCount(0);
  expect(await page.locator('.map-callout', { hasText: 'Pinned' }).boundingBox()).toEqual(pinnedBox);
  // DDH-4's elbow leader and its anchor dot.
  await expect(page.locator('.callout-leader-svg path')).toHaveCount(5);
  await expect(page.locator('.callout-leader-svg circle')).toHaveCount(1);

  // The arrangement is saved with the project: reopening shows it again.
  await page.waitForTimeout(1500);
  await page.goto('/?intent=resume');
  await expect(page.locator('.map-callout')).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator('.map-callout.collides')).toHaveCount(0);
  expect(await page.locator('.map-callout', { hasText: 'Pinned' }).boundingBox()).toEqual(pinnedBox);
});
