import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';

// The designer layers ZIP with editable annotations (F3 part 2): off by default, the ZIP keeps its five files;
// with "Include editable annotations (SVG)" ticked it also carries annotations.svg, the annotation layer with
// live text, which rasterizes back onto annotations.png. Google Fonts is served locally (one stand-in face
// under the figure's two family names), so the page, the embedding and the comparison do not depend on it.

test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.describe.configure({ timeout: 150_000 }); // each test draws the figure's layers at full size, two or three times

const STAND_IN = readFileSync(new URL('../node_modules/three/examples/fonts/open-sans/open-sans-v15-cyrillic-ext_greek_greek-ext_cyrillic_latin_latin-ext_vietnamese-regular.woff2', import.meta.url));
const FONT_URL = 'https://fonts.gstatic.com/e2e/stand-in.woff2', RANGE = 'unicode-range: U+0000-00FF, U+2000-206F, U+2190-2193';
const FONT_CSS = `/* latin */
@font-face { font-family: 'Source Sans 3'; font-style: normal; font-weight: 400 700; src: url(${FONT_URL}) format('woff2'); ${RANGE}; }
/* latin */
@font-face { font-family: 'Source Sans 3'; font-style: italic; font-weight: 400; src: url(${FONT_URL}) format('woff2'); ${RANGE}; }
/* latin */
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400 600; src: url(${FONT_URL}) format('woff2'); ${RANGE}; }`;
const pngSize = (b) => { const v = new DataView(b.buffer, b.byteOffset); return [v.getUint32(16), v.getUint32(20)]; };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://fonts.googleapis.com/css2**', (route) => route.fulfill({ status: 200, contentType: 'text/css', headers: { 'access-control-allow-origin': '*' }, body: FONT_CSS }));
  await page.route(FONT_URL, (route) => route.fulfill({ status: 200, contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: STAND_IN }));
  await page.goto('/3d/');
  await page.waitForFunction(() => window.EM3D?.getState().ready, null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
});

const unzipDataURL = (url) => unzipSync(Buffer.from(url.split(',')[1], 'base64'));

test('the layers ZIP is unchanged unless the SVG is asked for', async ({ page }) => {
  await page.evaluate(() => window.EM3D.showStep('export'));
  await expect(page.locator('#export-svg')).not.toBeChecked();
  const plain = unzipDataURL(await page.evaluate(() => window.EM3D.exportLayers()));
  expect(Object.keys(plain)).toEqual(['figure.png', 'scene.png', 'annotations.png', 'section.png', 'figure-settings.json']);
  const settings = JSON.parse(new TextDecoder().decode(plain['figure-settings.json']));
  expect(Object.keys(settings.layers)).toEqual(['figure', 'scene', 'annotations', 'section', 'settings', 'note']);
  // Asking for the SVG adds the file and leaves the PNGs as they were.
  const withSvg = unzipDataURL(await page.evaluate(() => window.EM3D.exportLayers({ svg: true })));
  expect(Object.keys(withSvg)).toEqual([...Object.keys(plain), 'annotations.svg']);
  for (const name of ['figure.png', 'scene.png', 'annotations.png', 'section.png']) expect(Buffer.compare(Buffer.from(withSvg[name]), Buffer.from(plain[name])), name).toBe(0);
});

test('annotations.svg has live text and lies on annotations.png', async ({ page }) => {
  await page.evaluate(() => window.EM3D.showStep('export'));
  await page.locator('#export-svg').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-layers').click()]);
  const files = unzipSync(readFileSync(await download.path()));
  expect(Object.keys(files)).toContain('annotations.svg');
  await expect(page.locator('#status')).toContainText('annotations.svg: fonts embedded');
  const svg = new TextDecoder().decode(files['annotations.svg']), png = Buffer.from(files['annotations.png']), [W, H] = pngSize(png);
  const state = await page.evaluate(() => { const s = window.EM3D.getState(); return { brand: s.brand, grade: s.grade, callouts: s.callouts.shown }; });

  const doc = await page.evaluate((text) => {
    const d = new DOMParser().parseFromString(text, 'image/svg+xml'), r = d.documentElement;
    return { error: d.querySelector('parsererror')?.textContent || null, size: [r.getAttribute('width'), r.getAttribute('height'), r.getAttribute('viewBox')], faces: (d.querySelector('style')?.textContent.match(/data:font\/woff2;base64,/g) || []).length,
      texts: [...d.querySelectorAll('text')].map((t) => ({ text: t.textContent, family: t.getAttribute('font-family'), weight: t.getAttribute('font-weight'), fill: t.getAttribute('fill') })) };
  }, svg);
  expect(doc.error).toBeNull();
  expect(doc.size).toEqual([String(W), String(H), `0 0 ${W} ${H}`]);
  expect(doc.faces).toBeGreaterThan(0); // the fonts travel with the file
  const texts = doc.texts.map((t) => t.text);
  // The title, in the figure's family and weight; a callout's "m @" line and its "incl." line; the legend rows.
  const title = doc.texts.find((t) => t.text === state.brand.title);
  expect(title).toMatchObject({ weight: '700', fill: state.brand.primary.toLowerCase() });
  expect(title.family).toContain('Source Sans 3');
  const co = state.callouts[0];
  expect(texts.some((t) => / m @ /.test(t) && co.line1.startsWith(t))).toBe(true);
  if (co.line2) expect(texts).toContain(co.line2);
  expect(texts).toContain(co.holeId);
  const b = state.grade.bins;
  expect(texts).toEqual(expect.arrayContaining([`Assay · ${state.grade.label}`, `≥ ${b.at(-1)}`, `${b[0]} – ${b[1]}`, `< ${b[0]}`]));

  // Rasterized in the browser at the same size, the SVG matches the PNG up to antialiasing and hinting.
  const m = await page.evaluate(async ({ text, data }) => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('image did not load')); i.src = src; });
    const a = await load(`data:image/png;base64,${data}`), W = a.naturalWidth, H = a.naturalHeight, b = await load(URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })));
    const pix = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
    const A = pix(a), B = pix(b), S = 8, box = () => [W, H, 0, 0], ba = box(), bb = box();
    let sum = 0, over64 = 0, block = 0;
    const grow = (r, x, y) => { r[0] = Math.min(r[0], x); r[1] = Math.min(r[1], y); r[2] = Math.max(r[2], x); r[3] = Math.max(r[3], y); };
    for (let i = 0; i < W * H; i++) {
      const j = i * 4; let d = Math.abs(A[j + 3] - B[j + 3]);
      for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A[j + k] * A[j + 3] - B[j + k] * B[j + 3]) / 255);
      sum += d; if (d > 64) over64++;
      if (A[j + 3] > 128) grow(ba, i % W, Math.floor(i / W)); if (B[j + 3] > 128) grow(bb, i % W, Math.floor(i / W));
    }
    for (let y = 0; y + S <= H; y += S) for (let x = 0; x + S <= W; x += S) {
      let da = 0, db = 0; for (let yy = y; yy < y + S; yy++) for (let xx = x; xx < x + S; xx++) { const j = (yy * W + xx) * 4; da += A[j + 3]; db += B[j + 3]; }
      block = Math.max(block, Math.abs(da - db) / (S * S));
    }
    return { mean: sum / (W * H), over64: over64 / (W * H), block, ba, bb };
  }, { text: svg, data: png.toString('base64') });
  console.log(`annotations.svg vs annotations.png: mean ${m.mean.toFixed(3)}/255, ${(m.over64 * 100).toFixed(3)} % of pixels off by more than 64, 8 px block max ${m.block.toFixed(1)}`);
  expect(m.mean).toBeLessThan(1.5);
  expect(m.over64).toBeLessThan(0.005);
  expect(m.block).toBeLessThan(48);
  m.ba.forEach((v, i) => expect(Math.abs(v - m.bb[i]), 'ink bounds').toBeLessThanOrEqual(2)); // same place, same extent
});
