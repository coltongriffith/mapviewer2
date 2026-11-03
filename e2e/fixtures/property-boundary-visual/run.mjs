// Run against the separately scheduled Vite DEV server, never production.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.BOUNDARY_VISUAL_BASE || 'http://127.0.0.1:4197';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Local fixture origin required');
const out = path.resolve(process.env.BOUNDARY_VISUAL_OUT || 'test-results/property-boundary-visual');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) });
const results = [];
try {
  for (const [name, viewport] of [['desktop', { width:1280, height:800 }], ['mobile', { width:390, height:844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor:1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.abort());
    await page.goto(`${base}/e2e/fixtures/property-boundary-visual/index.html`);
    await page.waitForFunction(() => window.boundaryQa?.ready && window.boundaryQaMap?.emFxReport?.propertyBoundary?.ok, null, { timeout:30000 });
    await page.locator('.map-stage').waitFor();
    await page.screenshot({ path:path.join(out, `${name}-readonly.png`), fullPage:true });
    const svg = await page.evaluate(() => window.boundaryQa.svg());
    if (!svg.includes('id="em-property-boundary"')) throw new Error(`${name}: boundary SVG group missing`);
    for (const id of ['QA-A','QA-B','QA-C']) if (!svg.includes(id)) throw new Error(`${name}: source label missing: ${id}`);
    await writeFile(path.join(out, `${name}-boundary.svg`), svg, 'utf8');
    const svgPage = await browser.newPage({ viewport, deviceScaleFactor:1 });
    await svgPage.setContent(`<html><head><style>html,body{margin:0;width:100%;height:100%;background:#e9eef0}svg{width:100%;height:100%;object-fit:contain}</style></head><body>${svg}</body></html>`);
    await svgPage.screenshot({ path:path.join(out, `${name}-svg-pixels.png`), fullPage:true });
    if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
    results.push({ name, viewport, svgBytes:Buffer.byteLength(svg), boundaryGroup:true, labels:['QA-A','QA-B','QA-C'], pageErrors:errors });
    await svgPage.close(); await page.close();
  }
  await writeFile(path.join(out, 'RESULT.json'), JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({ out, results },null,2));
} finally { await browser.close(); }
