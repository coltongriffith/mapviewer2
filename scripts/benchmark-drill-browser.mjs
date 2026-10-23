// Opt-in local browser measurement; not part of routine CI. Start a configured
// placeholder-client build on localhost first (see docs/drill-scale-benchmark.md).
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { scaleCounts, scaleRow } from './fixtures/drill-scale-data.mjs';

const args = process.argv.slice(2);
assert(args.every((a) => a === '--smoke' || a.startsWith('--profile=') || a.startsWith('--out=') || a.startsWith('--base-url=')), 'Only --smoke, --profile=, --out= and --base-url= are supported.');
const base = new URL(args.find((a) => a.startsWith('--base-url='))?.slice(11) || 'http://127.0.0.1:4197');
assert(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && !base.username && !base.password, 'The browser benchmark only accepts a local HTTP server.');
const out = args.find((a) => a.startsWith('--out='))?.slice(6);
const profilePath = args.find((a) => a.startsWith('--profile='))?.slice(10);
const holes = args.includes('--smoke') ? 20 : 2000, expected = scaleCounts(holes);
const uid = '00000000-0000-4000-8000-000000000001', org = '00000000-0000-4000-8000-000000000002', property = '00000000-0000-4000-8000-000000000003';
const user = { id: uid, email: 'synthetic@scale.test', role: 'authenticated', aud: 'authenticated', email_confirmed_at: '2026-10-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const session = { user, access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic`, refresh_token: 'synthetic', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer' };
const tables = Object.fromEntries(Object.entries(expected).map(([kind, count]) => [`drill_${kind}`, Array.from({ length: count }, (_, i) => ({ ...scaleRow[kind](i), property_id: property, org_id: org, superseded_by_batch: null }))]));
tables.drill_lithology = [];
const pages = [], errors = [], blocked = [];
const report = { schemaVersion: 1, synthetic: true, startedAt: new Date().toISOString(), expected, pages, errors, blocked,
  renderer: 'Chromium headless, SwiftShader, 1400x900 desktop',
  limitations: ['Database reads are mocked without latency; SQL timings are measured separately.', 'Software WebGL timings are specific to this machine, not a field-device or hosted performance guarantee.'] };
let browser, deadline, activePage, profiler;
async function measure() {
  report.phase = 'browser-start';
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, q = url.searchParams;
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin === base.origin) {
      if (path.startsWith('/api/')) return json({});
      return route.continue();
    }
    if (url.origin !== 'https://example.supabase.co') { blocked.push(url.origin); return route.abort(); }
    if (path.startsWith('/auth/v1/')) return json(path.endsWith('/user') ? user : path.endsWith('/token') ? session : {});
    if (path.endsWith('/rpc/get_my_workspaces')) return json([{ id: org, name: 'SYNTHETIC company', slug: 'synthetic', role: 'owner' }]);
    if (path.endsWith('/properties')) return json([{ id: property, org_id: org, name: 'SYNTHETIC scale', slug: 'synthetic', role: 'owner' }]);
    if (path.endsWith('/rpc/drill_property_recipes')) return json([]);
    if (path.endsWith('/drill_import_batches')) return json([{ id: 'synthetic-batch', kind: 'assays', created_at: '2026-10-22T00:00:00Z', rolled_back_at: null, summary: { new: expected.assays } }]);
    const rows = tables[path.slice('/rest/v1/'.length)];
    if (rows) {
      assert.equal(q.get('property_id'), `eq.${property}`); assert.equal(q.get('superseded_by_batch'), 'is.null');
      const offset = +(q.get('offset') || 0), limit = Math.min(+(q.get('limit') || 1000), 1000);
      const data = rows.slice(offset, offset + limit);
      pages.push({ table: path.split('/').pop(), offset, rows: data.length });
      return json(data);
    }
    return json((req.headers().accept || '').includes('vnd.pgrst.object') ? null : []);
  });
  await context.addInitScript((s) => localStorage.setItem('sb-example-auth-token', JSON.stringify(s)), session);
  await page.goto(`${base.origin}/3d`);
  await page.waitForFunction(() => window.EM3D?.getState().ready);
  console.log('Sample scene ready; loading synthetic property.');
  report.phase = 'property-picker';
  await page.getByRole('button', { name: 'From property drill database' }).click();
  await page.locator('#drill-prop').selectOption(property);
  // Also supports the saved-recipe picker when this harness is run on P2-8.
  if (await page.locator('#drill-recipe').count()) await page.locator('#drill-recipe').selectOption('raw');
  await page.evaluate(() => {
    window.__scaleTasks = [];
    new PerformanceObserver((list) => window.__scaleTasks.push(...list.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: false });
  });
  const start = performance.now();
  if (profilePath) {
    profiler = await context.newCDPSession(page);
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 1000 });
    await profiler.send('Profiler.start');
    report.cpuProfile = profilePath;
  }
  report.phase = 'property-load';
  await page.locator('#drill-load').click();
  // Completion is the import button leaving its busy state. Terrain/layer
  // messages may overwrite the transient global "Loaded" status afterward.
  await page.waitForFunction(() => document.querySelector('#drill-load')?.disabled === false);
  report.loadMessage = await page.locator('#status').textContent();
  report.loadError = await page.locator('#drill-progress').textContent();
  assert.equal(report.loadError, '', `Property load failed: ${report.loadError}`);
  report.phase = 'layers-and-paint';
  await page.evaluate(async () => { await window.EM3D.layersReady(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
  report.loadAndSettleMs = Math.round(performance.now() - start);
  console.log(`Property settled in ${report.loadAndSettleMs} ms.`);
  const state = await page.evaluate(() => window.EM3D.getState());
  assert.equal(state.project.holes, holes); assert.equal(state.project.intervals, expected.assays);
  assert.equal(state.drillSource.holes, holes); assert.equal(state.drillSource.assays, expected.assays);
  report.project = state.project; report.source = state.drillSource;
  for (const [kind, count] of Object.entries(expected)) assert.equal(pages.filter((p) => p.table === `drill_${kind}`).reduce((n, p) => n + p.rows, 0), count);
  report.phase = 'camera-and-paint';
  report.cameraAndPaintMs = await page.evaluate(async () => {
    const t = performance.now(); window.EM3D.setCamera({ azimuth: 120, plunge: 35 });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t);
  });
  report.longTasksMs = await page.evaluate(() => window.__scaleTasks);
  report.maxLongTaskMs = Math.max(0, ...report.longTasksMs);
  if (out) await page.screenshot({ path: `${out}.png` });
  assert.deepEqual(errors, []);
  report.phase = 'complete';
  report.status = 'browser-counts-and-camera-passed';
}
try {
  await Promise.race([measure(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Browser scale measurement exceeded 180 seconds.')), 180000); })]);
} catch (e) {
  report.status = 'failed'; report.error = e.stack; process.exitCode = 1;
  let diagnosticDeadline;
  try {
    report.failureState = await Promise.race([
      activePage?.evaluate(() => ({ status: document.querySelector('#status')?.textContent, progress: document.querySelector('#drill-progress')?.textContent, loading: document.querySelector('#drill-load')?.disabled, longTasksMs: window.__scaleTasks })),
      new Promise((resolve) => { diagnosticDeadline = setTimeout(() => resolve({ unresponsive: true }), 2000); }),
    ]);
  } catch { /* The browser may already have exited. */ }
  finally { clearTimeout(diagnosticDeadline); }
}
finally {
  clearTimeout(deadline);
  if (profiler) {
    let profileDeadline;
    try {
      const { profile } = await Promise.race([
        profiler.send('Profiler.stop'),
        new Promise((_, reject) => { profileDeadline = setTimeout(() => reject(new Error('CPU profile capture exceeded 5 seconds.')), 5000); }),
      ]);
      await writeFile(profilePath, JSON.stringify(profile));
    } catch (e) { report.cpuProfileError = e.message; }
    finally { clearTimeout(profileDeadline); }
  }
  await browser?.close(); report.finishedAt = new Date().toISOString();
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, loadAndSettleMs: report.loadAndSettleMs, cameraAndPaintMs: report.cameraAndPaintMs, maxLongTaskMs: report.maxLongTaskMs, error: report.error, out }));
}
