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

test('annotations.svg has live text and lies on annotations.png', async ({ page }, testInfo) => {
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

  // Rasterized in the browser at the same size, the SVG lies on the PNG. One thing is renderer-dependent: where a
  // browser lays text out on whole-pixel glyph advances (Chrome 151's headless shell does, for web fonts), Canvas
  // rounds them at the size the overlay is drawn at, in the on-screen frame before its scale to the export size, while
  // SVG text rounds them at the size it is shown. A long run then starts in the same place and ends a few pixels
  // apart (the title by ~5 px at 1920 wide). So the comparison is made twice. As exported, it is logged and its
  // overall ink bounds asserted. With each glyph placed where Canvas places it, from Canvas measurements of the SVG's
  // own text, family, weight, size, letter spacing and anchor at the frame's scale, it is asserted pixel by pixel:
  // that takes out only the rounding, so a wrong position, anchor, baseline, size, weight, spacing, colour or shape
  // still fails. Every metric is logged, and the rasters and diffs attached, before anything is asserted.
  const k = W / await page.evaluate(() => parseFloat(document.getElementById('frame').style.width)); // export px per frame px
  const m = await page.evaluate(async ({ text, data, k }) => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('image did not load')); i.src = src; });
    const a = await load(`data:image/png;base64,${data}`), W = a.naturalWidth, H = a.naturalHeight;
    const pix = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H); return [c, g.getImageData(0, 0, W, H).data]; };
    const [, A] = pix(a);
    const compare = async (svgText) => {
      const [canvas, B] = pix(await load(URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))));
      const S = 8, box = () => [W, H, 0, 0], inkPng = box(), inkSvg = box(), grow = (r, x, y) => { r[0] = Math.min(r[0], x); r[1] = Math.min(r[1], y); r[2] = Math.max(r[2], x); r[3] = Math.max(r[3], y); };
      const dc = document.createElement('canvas'); dc.width = W; dc.height = H; const dg = dc.getContext('2d'), out = dg.createImageData(W, H);
      let sum = 0, over64 = 0, block = 0;
      for (let i = 0; i < W * H; i++) {
        const j = i * 4; let d = Math.abs(A[j + 3] - B[j + 3]);
        for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A[j + k] * A[j + 3] - B[j + k] * B[j + 3]) / 255);
        sum += d; if (d > 64) over64++;
        if (A[j + 3] > 128) grow(inkPng, i % W, Math.floor(i / W)); if (B[j + 3] > 128) grow(inkSvg, i % W, Math.floor(i / W));
        const bg = 255 - A[j + 3] * 0.25, red = Math.min(255, d * 3); out.data[j] = Math.max(bg, red); out.data[j + 1] = out.data[j + 2] = bg * (1 - red / 255); out.data[j + 3] = 255; // the PNG faded, differences in red
      }
      for (let y = 0; y + S <= H; y += S) for (let x = 0; x + S <= W; x += S) {
        let da = 0, db = 0; for (let yy = y; yy < y + S; yy++) for (let xx = x; xx < x + S; xx++) { const j = (yy * W + xx) * 4; da += A[j + 3]; db += B[j + 3]; }
        block = Math.max(block, Math.abs(da - db) / (S * S));
      }
      dg.putImageData(out, 0, 0);
      return { mean: sum / (W * H), over64: over64 / (W * H), block, inkPng, inkSvg, raster: canvas.toDataURL('image/png'), diff: dc.toDataURL('image/png') };
    };
    const d = new DOMParser().parseFromString(text, 'image/svg+xml'), g = document.createElement('canvas').getContext('2d');
    let runs = 0;
    d.querySelectorAll('text:not([textLength])').forEach((t) => {
      if (/matrix/.test(t.getAttribute('transform') || '')) return;
      g.setTransform(k, 0, 0, k, 0, 0);
      g.font = `${t.getAttribute('font-style') || 'normal'} ${t.getAttribute('font-weight') || 400} ${t.getAttribute('font-size') / k}px ${t.getAttribute('font-family')}`;
      g.letterSpacing = `${(t.getAttribute('letter-spacing') || 0) / k}px`;
      const w = (s) => g.measureText(s).width * k, chars = [...t.textContent], all = w(t.textContent), anchor = t.getAttribute('text-anchor'), x = +t.getAttribute('x');
      const start = anchor === 'middle' ? x - all / 2 : anchor === 'end' ? x - all : x;
      // Glyph i starts where the run up to and including it ends, less its own advance (so kerning before it counts).
      t.setAttribute('x', chars.map((c, i) => (start + w(chars.slice(0, i + 1).join('')) - w(c)).toFixed(2)).join(' ')); t.removeAttribute('text-anchor'); runs++;
    });
    return { fonts: d.querySelector('desc')?.textContent, k, runs, exported: await compare(text), matched: await compare(new XMLSerializer().serializeToString(d)) };
  }, { text: svg, data: png.toString('base64'), k });
  const fmt = (r) => `mean ${r.mean.toFixed(3)}/255, ${(r.over64 * 100).toFixed(3)} % of pixels off by more than 64, 8 px block max ${r.block.toFixed(1)}, ink bounds PNG [${r.inkPng}] SVG [${r.inkSvg}]`;
  console.log(`annotations.svg vs annotations.png (${m.fonts} Frame scale ${m.k.toFixed(3)}.)\n  as exported:   ${fmt(m.exported)}\n  glyphs at Canvas positions (${m.runs} runs): ${fmt(m.matched)}`);
  for (const [name, r] of [['as-exported', m.exported], ['canvas-positions', m.matched]]) {
    await testInfo.attach(`svg-raster-${name}.png`, { body: Buffer.from(r.raster.split(',')[1], 'base64'), contentType: 'image/png' });
    await testInfo.attach(`svg-diff-${name}.png`, { body: Buffer.from(r.diff.split(',')[1], 'base64'), contentType: 'image/png' });
    delete r.raster; delete r.diff;
  }
  await testInfo.attach('annotations.svg', { body: svg, contentType: 'image/svg+xml' });
  await testInfo.attach('svg-metrics.json', { body: JSON.stringify(m, null, 2), contentType: 'application/json' });
  // Both families embedded, none left to a system fallback on either side.
  expect(m.fonts).toMatch(/Fonts embedded: [^;]*Source Sans 3/); expect(m.fonts).toMatch(/Fonts embedded: [^;]*IBM Plex Mono/); expect(m.fonts).toContain('named only: none');
  m.exported.inkPng.forEach((v, i) => expect(Math.abs(v - m.exported.inkSvg[i]), 'ink bounds as exported').toBeLessThanOrEqual(2));
  expect(m.matched.mean).toBeLessThan(0.5);
  expect(m.matched.over64).toBeLessThan(0.002);
  expect(m.matched.block).toBeLessThan(24);
  m.matched.inkPng.forEach((v, i) => expect(Math.abs(v - m.matched.inkSvg[i]), 'ink bounds').toBeLessThanOrEqual(2)); // same place, same extent
});
