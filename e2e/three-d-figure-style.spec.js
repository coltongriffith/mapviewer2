import { test, expect } from '@playwright/test';

// A shared figure style on a 3D figure (F4): EM3D.setFigureStyle sets the brand colours and, once its
// faces have loaded, the text family, and records the style with the figure. A figure without one keeps
// Source Sans 3, and opening it after a styled one does not inherit the style.
// The brand family's stylesheet is served locally (a system face under the family's name), so the test
// does not depend on Google Fonts.

test.skip(({ isMobile }) => isMobile, 'Desktop only');

test('a figure style applies to /3d and stays with its figure only', async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://fonts.googleapis.com/css2?family=Poppins*', (route) => route.fulfill({
    status: 200, contentType: 'text/css',
    body: '@font-face{font-family:"Poppins";font-weight:400;src:local("DejaVu Sans"),local("Liberation Sans"),local("Arial")}@font-face{font-family:"Poppins";font-weight:700;src:local("DejaVu Sans Bold"),local("Liberation Sans Bold"),local("Arial Bold")}',
  }));
  await page.goto('/3d/');
  await page.waitForFunction(() => window.EM3D?.getState().ready, null, { timeout: 30_000 });

  const plain = await page.evaluate(() => window.EM3D.getProject());
  expect(plain.settings.brandStyle).toBeNull();
  expect(await page.evaluate(() => [...document.querySelectorAll('link[id^="em3d-font-"]')].length)).toBe(0); // nothing fetched for it

  // Geology on two faces, so unit names are painted on the block (in Source Sans 3 for now). Every off-screen canvas
  // font set from here on is recorded.
  const before = await page.evaluate(async () => {
    const E = window.EM3D, ids = E.getState().project.holeIds;
    const lith = ['HoleID,From,To,Lith', ...ids.flatMap((id) => [`${id},0,40,COV`, `${id},40,400,POR`])].join('\n');
    E.addFiles([...E.getProject().files.map(({ name, text }) => ({ name, text })), { name: 'lithology.csv', text: lith }]);
    const fonts = []; window.__fonts = fonts;
    const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', { configurable: true, get: d.get, set(v) { if (!this.canvas.isConnected) fonts.push(v); d.set.call(this, v); } });
    await E.setGeology({ enabled: true, faces: ['N', 'E'], legend: [{ code: 'POR', name: 'Porphyry' }, { code: 'COV', name: 'Cover' }] });
    await new Promise((r) => { setTimeout(r, 500); });
    return fonts.splice(0);
  });
  // Fonts set on off-screen canvases only (the painted faces, wall labels); wall labels are drawn at 96 px.
  const unitNames = (list, family) => list.filter((f) => /^600 [\d.]+px /.test(f) && !f.startsWith('600 96px') && f.includes(`"${family}"`));
  expect(unitNames(before, 'Source Sans 3').length).toBeGreaterThan(0);

  const state = await page.evaluate(() => window.EM3D.setFigureStyle(
    { version: 1, colours: { primary: '#0a4268', accent: '#ae4b0a' }, type: { label: { family: 'Poppins' } }, sourceNote: { italic: true } },
    { brandKitId: 'kit-1', brandRevision: '2026-10-20T09:30:00Z' },
  ));
  // The painted unit names are redrawn in the brand family, not reused from the Source Sans cache.
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__fonts.splice(0));
  expect(unitNames(after, 'Poppins').length).toBeGreaterThan(0);
  expect(state.brand).toMatchObject({ primary: '#0a4268', accent: '#ae4b0a' });
  const styled = await page.evaluate(() => window.EM3D.getProject().settings.brandStyle);
  expect(styled).toMatchObject({ brandKitId: 'kit-1', brandRevision: '2026-10-20T09:30:00Z', mode: 'style', fonts: { sans: 'Poppins' } });
  expect(styled.style.sourceNote.italic).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('700 16px "Poppins"'))).toBe(true);
  expect(await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' }).startsWith('data:image/png'))).toBe(true);
  await expect(page.locator('#status')).not.toContainText('could not be loaded');

  // An invalid style is refused whole, and changes nothing.
  await expect(page.evaluate(() => window.EM3D.setFigureStyle({ colours: { primary: 'navy' } }))).rejects.toThrow(/colours\.primary/);
  expect((await page.evaluate(() => window.EM3D.getState())).brand.primary).toBe('#0a4268');

  // Reopening the earlier figure: its own colours and no brand style.
  await page.evaluate((p) => window.EM3D.loadProject(p), plain);
  const reopened = await page.evaluate(() => window.EM3D.getProject().settings);
  expect(reopened.brandStyle).toBeNull();
  expect(reopened.primary).toBe(plain.settings.primary);
});
