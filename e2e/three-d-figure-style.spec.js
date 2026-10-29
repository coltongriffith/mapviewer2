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
  // Real image decoding exercises the prepared-logo host boundary, then the
  // legacy upload/remove API must still operate on the same figure.
  await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=c.height=8;const ctx=c.getContext('2d');ctx.fillStyle='#123456';ctx.fillRect(0,0,8,8);
    const src=c.toDataURL('image/png'),E=window.EM3D;await E.setFigureStyle({logo:{assetRef:src}},{brandKitId:'logo-kit'});
  });
  expect(await page.evaluate(()=>window.EM3D.getProject().settings.logo.$image)).toMatch(/^data:image\/png/);
  await page.evaluate(()=>window.EM3D.setLogo(null));expect(await page.evaluate(()=>window.EM3D.getProject().settings.logo)).toBeNull();
  await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=8;await window.EM3D.setLogo(c.toDataURL('image/png'),{autoColor:false});});
  expect(await page.evaluate(()=>window.EM3D.exportPNG({view:'3d'}))).toMatch(/^data:image\/png/);
});

test('a style requested before its lazy module loads cannot brand a replacement figure', async ({page}) => {
  test.setTimeout(120000);
  await page.route('**/api/track',r=>r.fulfill({status:204}));
  let release,notify;const requested=new Promise(resolve=>{notify=resolve;});
  await page.route('**/assets/typography-*.js',async route=>{await new Promise(r=>{release=r;notify();});await route.continue();});
  await page.goto('/3d/');await page.waitForFunction(()=>window.EM3D?.getState().ready);
  const original=await page.evaluate(()=>window.EM3D.getProject());
  await page.evaluate(()=>{window.__pendingStyle=window.EM3D.setFigureStyle({colours:{primary:'#123456'}},{brandKitId:'stale-kit'});});
  await requested;
  await page.evaluate(async p=>{p.settings.title='Replacement figure';await window.EM3D.loadProject(p);},original);
  release();await page.evaluate(()=>window.__pendingStyle);
  const after=await page.evaluate(()=>window.EM3D.getProject());
  expect(after.settings.title).toBe('Replacement figure');expect(after.settings.brandStyle).toBeNull();
  expect(after.settings.primary).toBe(original.settings.primary);expect(after.files).toEqual(original.files);
});
