import { test, expect } from '@playwright/test';

// Exploration Maps 3D drill crew life (crew-life.js): routines, chatter in speech bubbles and noticing a viewer, in the
// live editor and on share links. Never in an export, and none of it for a viewer who prefers reduced motion, unless
// they tap one of the crew.

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.describe.configure({ timeout: 150_000 });

const REACT = ['Oh, hey!', "Didn't see you there.", 'Mind the mud.', 'Howdy!', 'Hard hat zone, friend.', 'Welcome to the pad.', "Careful, it's slippery.", 'Good to see you.'];
const bubble = (page) => page.locator('.em3d-crew-talk p.on');

async function open3d(page) {
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  await page.goto('/3d');
  await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.evaluate(() => window.EM3D.layersReady());
}
// Points at one of the crew (0-2) on the figure.
async function pointAt(page, i) {
  const box = await page.locator('#frame').boundingBox(), [x, y] = (await page.evaluate(() => window.EM3D.getState().crew)).people[i];
  await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 3 });
  return [box.x + x * box.width, box.y + y * box.height];
}

test('exports are unchanged by the crew\'s life: the same fixed pose, no bubbles, every time', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D; await E.setCrew({ on: true, chatter: false, life: false });
    const still = E.exportPNG({ view: '3d' });
    await E.setCrew({ chatter: true, life: true }); const first = E.exportPNG({ view: '3d' });
    await new Promise((ok) => setTimeout(ok, 5000)); // walking, carrying, talking
    const talked = !!document.querySelector('.em3d-crew-talk');
    return { still, first, later: E.exportPNG({ view: '3d' }), talked, crew: E.getState().crew };
  });
  expect(r.crew).toMatchObject({ chatter: true, life: true, shown: true });
  expect(r.talked).toBe(true);
  expect(r.first === r.still).toBe(true);
  expect(r.later === r.still).toBe(true);
});

test('pointing at one of the crew: a pointer, and they notice with a hello', async ({ page }) => {
  await open3d(page);
  await page.evaluate(() => window.EM3D.setCrew({ on: true, scale: 2 }));
  await page.waitForFunction(() => document.querySelector('.em3d-crew-talk'));
  await page.waitForTimeout(500);
  await expect.poll(async () => { await pointAt(page, 1); return bubble(page).count(); }, { timeout: 15_000 }).toBe(1);
  expect(REACT).toContain(await bubble(page).textContent());
  expect(await page.evaluate(() => document.getElementById('gl').style.cursor)).toBe('pointer');
  // The section view takes the bubble away and nothing there is noticed; back in 3D, no stale bubble.
  await page.evaluate(() => window.EM3D.showView('section'));
  await expect(page.locator('.em3d-crew-talk')).toBeHidden();
  await expect(bubble(page)).toHaveCount(0);
  await pointAt(page, 2); await page.waitForTimeout(500);
  await expect(bubble(page)).toHaveCount(0);
  await page.mouse.move(5, 5);
  await page.evaluate(() => window.EM3D.showView('3d'));
  await expect(page.locator('.em3d-crew-talk')).toBeVisible();
  expect(await bubble(page).count()).toBe(0);
  // In the Layout step, "Crew chatter" turns the bubbles off.
  await page.evaluate(() => window.EM3D.showStep('layout'));
  const chat = page.getByRole('checkbox', { name: 'Crew chatter' });
  await expect(chat).toBeChecked();
  await chat.uncheck();
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).crew.chatter).toBe(false);
});

test('reduced motion: no walking and no bubbles of their own; a tap still gets a hello', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open3d(page);
  const pose = () => page.evaluate(() => JSON.stringify(window.EM3D.getState().crew.people.map((p) => p.map((v) => v.toFixed(4)))));
  await page.evaluate(() => window.EM3D.setCrew({ on: true, scale: 2 }));
  await page.waitForFunction(() => document.querySelector('.em3d-crew-talk'));
  const p0 = await pose();
  await page.waitForTimeout(15_000);
  expect(await bubble(page).count()).toBe(0);
  expect(await pose()).toBe(p0); // nobody walked
  const [x, y] = await pointAt(page, 0);
  await page.waitForTimeout(1000);
  expect(await bubble(page).count()).toBe(0); // pointing alone is not noticed
  await page.mouse.click(x, y);
  await expect(bubble(page)).toHaveCount(1);
  expect(REACT).toContain(await bubble(page).textContent());
});

// The shared figure: the read-only viewer shows the crew at work and talking. Needs the configured client build (an
// in-memory share RPC), like the share specs.
test.describe('on a share link', () => {
  test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated RPC fixtures');
  test('a bubble within 15 s', async ({ page, context }) => {
    await open3d(page);
    const state = await page.evaluate(async () => { await window.EM3D.setCrew({ on: true }); return window.EM3D.getProject(); });
    const id = 'd'.repeat(32);
    await context.route('https://example.supabase.co/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/rpc/get_3d_share')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state, thumbnail: null }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: url.pathname.startsWith('/auth/') ? '{}' : 'null' });
    });
    await page.goto(`/3d/share/${id}`);
    await page.waitForFunction(() => document.documentElement.classList.contains('em3d-shown') && window.EM3D?.getState().ready);
    const t0 = Date.now();
    await expect(bubble(page)).toHaveCount(1, { timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect((await page.evaluate(() => window.EM3D.getState())).crew).toMatchObject({ on: true, chatter: true, shown: true });
  });
});
