import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const files = [
  { name: 'synthetic-collars.csv', text: 'HoleID,X,Y,Z,Length\r\nQA-A,500000,5500000,100,100\r\nQA-B,500100,5500100,100,100' },
  { name: 'synthetic-ip.csv', text: 'X,Y,Z,Chargeability\n500000,5500000,100,10\n500010,5500010,90,12tail\n500020,5500020,80,"1,000"\n500030,5500030,70,<0.05\n500040,5500040,60,2e1' },
];
async function downloadBackupBytes(page) {
  if (!(await page.locator('#backup-download').isVisible())) await page.getByRole('button', { name: 'My 3D maps', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download project backup', exact: true }).click();
  const download = await downloading;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}
// Two exports of the same figure, from two tabs, are not byte-identical in
// headless Chromium: its software renderer anti-aliases text and edges slightly
// differently per tab (measured: up to 0.44% of pixels differ, under 0.1% by more
// than 8 of 255, with the same project, state and loaded fonts). Byte equality
// made these restores fail about one run in ten. The image check is for the
// figure as a whole (a lost layer, logo, colour or a font swap changes far more
// pixels than the noise); exact text and values are covered by the project and
// settings equality each test asserts alongside it.
async function expectSameFigure(page, actual, expected) {
  if (actual === expected) return;
  const { size, differing } = await page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const pixels = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: false, differing: 1 };
    const pa = pixels(ia), pb = pixels(ib);
    let n = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]), Math.abs(pa[i + 3] - pb[i + 3])) > 16) n++;
    }
    return { size: true, differing: n / (pa.length / 4) };
  }, [actual, expected]);
  expect(size, 'exported figures have the same dimensions').toBe(true);
  expect(differing, 'share of pixels that differ by more than anti-aliasing noise').toBeLessThanOrEqual(0.0025);
}
async function scientificPreview(page) {
  return page.evaluate(async () => {
    await document.fonts.ready; await window.EM3D.layersReady();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const state = window.EM3D.getState();
    const { mode, coMin, coCut, coIncl } = state.callouts;
    return { project: window.EM3D.getProject(), equivalent: state.equivalent, grade: state.grade, candidates: state.callouts.candidates, calloutSettings: { mode, coMin, coCut, coIncl }, png: await window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }) };
  });
}
for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  test(`local 3D file backup opens privately in a new figure and preserves its source tab (${label})`, async ({ page, context }) => {
    test.setTimeout(180000); await page.setViewportSize(viewport);
    await context.route('**/api/track', (route) => route.fulfill({ status: 204 }));
    await page.goto('/3d/'); await page.waitForFunction(() => window.EM3D?.getState().ready);
    await page.evaluate(async (sources) => {
      const E = window.EM3D; E.clearFiles(); E.addFiles(sources);
      await E.setGeophys({ mode: 'curtain', lines: 'section' }); await E.layersReady();
      E.setBrand({ company: 'Synthetic backup QA', title: 'Backup <QA> & figures', primary: '#164e63', accent: '#b45309' });
      E.setCamera({ azimuth: 40, plunge: 25, zoom: 90 }); await E.layersReady();
    }, files);
    const before = await page.evaluate(async () => {
      await document.fonts.ready; await window.EM3D.layersReady();
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      return { project: window.EM3D.getProject(), diagnostics: window.EM3D.getState().geophys.diagnostics, png: await window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }) };
    });
    await page.getByRole('button', { name: 'My 3D maps', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download project backup', exact: true }).click();
    const download = await downloadPromise, bytes = await readFile(await download.path());
    expect(bytes.length).toBeGreaterThan(100);
    await page.locator('#backup-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
    await expect(page.getByRole('dialog', { name: 'Open project backup' })).toBeVisible();
    await expect(page.locator('#backup-name')).toHaveText('Backup <QA> & figures');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.evaluate(() => window.EM3D.getProject())).toEqual(before.project);
    await page.locator('#backup-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Open as new figure', exact: true }).click();
    const restored = await popupPromise; await restored.setViewportSize(viewport);
    await expect(restored.locator('#status')).toHaveText('Backup opened as a new unsaved figure.');
    const after = await restored.evaluate(() => ({ project: window.EM3D.getProject(), diagnostics: window.EM3D.getState().geophys.diagnostics, opener: window.opener, hash: location.hash, inert: document.getElementById('stage').closest('.app')?.inert }));
    expect(after.project.files).toEqual(before.project.files);
    expect(after.project.settings).toEqual(before.project.settings);
    expect(after.project.camera).toEqual(before.project.camera);
    expect(after.diagnostics).toEqual(before.diagnostics);
    expect(after.opener).toBeNull(); expect(after.hash).toBe('');
    expect(after.project.files.find((f) => f.name === files[1].name).geophysNumericPolicy).toBe('finite-decimal-v1');
    await expectSameFigure(page, await restored.evaluate(async () => {
      await document.fonts.ready; await window.EM3D.layersReady();
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      return window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' });
    }), before.png);
    expect(await page.evaluate(() => window.EM3D.getProject())).toEqual(before.project);
    await expect(page.locator('#status')).toContainText('This figure is unchanged');
    await expect(restored.locator('#camera-fit')).toBeEnabled();
    await restored.locator('#stage').screenshot({ path: test.info().outputPath(`local-backup-${label}.png`) });
    await restored.close();
  });
}

test('invalid restore boot stays isolated and malformed file preflight leaves the current figure intact', async ({ page, context }) => {
  await context.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/3d/'); await page.waitForFunction(() => window.EM3D?.getState().ready);
  const before = await page.evaluate(() => window.EM3D.getProject());
  await page.locator('#backup-file').setInputFiles({ name: 'invalid.emap-project.json', mimeType: 'application/json', buffer: Buffer.from('{"format": "unknown"}') });
  await expect(page.locator('#status')).toContainText('not a supported project backup');
  expect(await page.evaluate(() => window.EM3D.getProject())).toEqual(before);
  const isolated = await context.newPage();
  await isolated.goto('/3d/#local-restore=invalid');
  await expect(isolated.locator('#status')).toContainText('could not be opened');
  await expect(isolated.locator('#stage').locator('xpath=ancestor::*[@inert][1]')).toHaveCount(1);
  await isolated.close();
});

test('the actual bundled sample and a 102-hole synthetic source project are accepted without losing their settings', async ({ page, context }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await context.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/3d/'); await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.evaluate(() => window.EM3D.layersReady());
  const sample = await page.evaluate(() => window.EM3D.getProject());
  await page.getByRole('button', { name: 'My 3D maps', exact: true }).click();
  const sampleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project backup', exact: true }).click();
  const sampleBytes = await readFile(await (await sampleDownload).path());
  expect(JSON.parse(sampleBytes.toString('utf8')).project).toEqual(sample);
  await page.evaluate(async () => {
    const E = window.EM3D, project = E.getProject(); project.settings.title = 'Synthetic 102-hole backup QA'; project.usingSample = false;
    project.files = project.files.map((file) => {
      if (!['collar', 'survey', 'assay'].includes(file.role)) return file;
      const [header, ...rows] = file.text.trim().split(/\r?\n/);
      return { ...file, text: [header, ...[1, 2, 3].flatMap((i) => rows.map((row) => `QA${i}-${row}`))].join('\n') };
    });
    await E.loadProject(project); await E.layersReady();
  });
  expect(await page.evaluate(() => window.EM3D.getState().project.holes)).toBe(102);
  const before = await page.evaluate(async () => {
    await document.fonts.ready; await window.EM3D.layersReady();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return { project: window.EM3D.getProject(), png: await window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }) };
  });
  if (!(await page.locator('#backup-download').isVisible())) await page.getByRole('button', { name: 'My 3D maps', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project backup', exact: true }).click();
  const download = await downloadPromise, bytes = await readFile(await download.path());
  expect(JSON.parse(bytes.toString('utf8')).project).toEqual(before.project);
  await page.locator('#backup-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
  const popupPromise = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open as new figure', exact: true }).click();
  const restored = await popupPromise; await restored.setViewportSize({ width: 1280, height: 900 });
  await expect(restored.locator('#status')).toHaveText('Backup opened as a new unsaved figure.');
  expect(await restored.evaluate(() => window.EM3D.getState().project.holes)).toBe(102);
  const after = await restored.evaluate(async () => {
    await document.fonts.ready; await window.EM3D.layersReady();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return { project: window.EM3D.getProject(), png: await window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }) };
  });
  await test.info().attach('backup-camera-roundtrip', { body: JSON.stringify({ before: before.project.camera, after: after.project.camera }), contentType: 'application/json' });
  expect(after.project.files).toEqual(before.project.files); expect(after.project.settings).toEqual(before.project.settings); expect(after.project.camera).toEqual(before.project.camera); await expectSameFigure(page, after.png, before.png);
  expect(await page.evaluate(() => window.EM3D.getProject())).toEqual(before.project);
  await restored.locator('#stage').screenshot({ path: test.info().outputPath('local-backup-102-holes.png') });
  await restored.close();
});

test('backup actions disappear when the existing document becomes a published read-only view', async ({ page, context }) => {
  await context.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/3d/'); await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.getByRole('button', { name: 'My 3D maps', exact: true }).click();
  await expect(page.locator('#backup-download')).toBeVisible();
  const before = await page.evaluate(() => window.EM3D.getProject()), pages = context.pages().length;
  await page.evaluate(() => { document.documentElement.classList.add('em3d-version'); });
  await expect(page.locator('#backup-download')).toBeHidden(); await expect(page.locator('#backup-download')).toBeDisabled();
  await expect(page.locator('#backup-restore')).toBeHidden(); await expect(page.locator('#backup-restore')).toBeDisabled();
  const requests = []; page.on('request', (request) => requests.push(request.url()));
  const downloads = []; page.on('download', (download) => downloads.push(download));
  // A programmatic change cannot bypass the native hidden/disabled controls.
  await page.locator('#backup-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  expect(await page.evaluate(() => window.EM3D.getProject())).toEqual(before);
  expect(context.pages()).toHaveLength(pages); expect(downloads).toEqual([]); expect(requests).toEqual([]);
  await expect(page.locator('#backup-dialog')).toBeHidden();
  await page.evaluate(() => { document.documentElement.classList.remove('em3d-version'); });
  await expect(page.locator('#backup-download')).toBeVisible(); await expect(page.locator('#backup-download')).toBeEnabled();
});

test('inline PNG logo and JPEG geology face survive the actual local file and child restore path', async ({ page, context }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 1280, height: 900 });
  await context.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/3d/'); await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#164e63'; ctx.fillRect(0, 0, 32, 24); ctx.fillStyle = '#f59e0b'; ctx.fillRect(8, 6, 16, 12);
    const E = window.EM3D; await E.setLogo(canvas.toDataURL('image/png'), { autoColor: false });
    await E.setFaceImage('S', canvas.toDataURL('image/jpeg')); await E.layersReady();
    E.setBrand({ title: 'Synthetic inline image backup QA' });
  });
  const before = await page.evaluate(async () => {
    await document.fonts.ready; await window.EM3D.layersReady();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return { project: window.EM3D.getProject(), png: await window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }) };
  });
  expect(before.project.settings.logo.$image).toMatch(/^data:image\/png;base64,/);
  expect(before.project.settings.geology.images.S).toMatch(/^data:image\/jpeg;base64,/);
  await page.getByRole('button', { name: 'My 3D maps', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download project backup', exact: true }).click();
  const download = await downloading, bytes = await readFile(await download.path());
  await page.locator('#backup-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
  const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open as new figure', exact: true }).click();
  const child = await opening; await child.setViewportSize({ width: 1280, height: 900 });
  await expect(child.locator('#status')).toHaveText('Backup opened as a new unsaved figure.');
  const after = await child.evaluate(async () => {
    await document.fonts.ready; await window.EM3D.layersReady();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return { project: window.EM3D.getProject(), png: await window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }) };
  });
  expect(after.project.settings).toEqual(before.project.settings); expect(after.project.files).toEqual(before.project.files); expect(after.project.camera).toEqual(before.project.camera); await expectSameFigure(page, after.png, before.png);
  expect(await page.evaluate(() => window.EM3D.getProject())).toEqual(before.project);
  await child.locator('#stage').screenshot({ path: test.info().outputPath('local-backup-inline-images.png') }); await child.close();
});

test('oversize files, excessive source cells and invalid geometry are refused before any figure load', async ({ page, context }) => {
  test.setTimeout(180000); await context.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/3d/'); await page.waitForFunction(() => window.EM3D?.getState().ready);
  const before = await page.evaluate(() => { window.__backupLoads = 0; window.addEventListener('em3d:figure-loading', () => window.__backupLoads++); return window.EM3D.getProject(); });
  const container = (files) => Buffer.from(JSON.stringify({ format: 'exploration-maps-project', version: 1, kind: '3d', producerRevision: 'synthetic-test', createdAt: '2026-11-03T00:00:00.000Z', name: 'Synthetic rejected QA', project: { ...before, files } }));
  const cases = [
    { name: 'too-large.json', bytes: Buffer.alloc(8 * 1024 * 1024 + 1, 32) },
    { name: 'too-many-cells.json', bytes: container([{ name: 'qa.csv', text: 'HoleID,X,Y,Z,Length,A,B,C\n' + 'QA,0,0,100,100,0,0,0\n'.repeat(50001) }]) },
    { name: 'invalid-geometry.json', bytes: container([{ name: 'qa.csv', role: 'collar', text: 'HoleID,X,Y,Z,Length\nQA,0,0,1e200,100' }]) },
  ];
  const initialPages = context.pages().length;
  for (const item of cases) {
    await page.evaluate(() => { document.getElementById('status').textContent = ''; });
    await page.locator('#backup-file').setInputFiles({ name: item.name, mimeType: 'application/json', buffer: item.bytes });
    await expect(page.locator('#status')).toContainText('not a supported project backup');
    expect(await page.evaluate(() => window.__backupLoads)).toBe(0);
    expect(await page.evaluate(() => window.EM3D.getProject())).toEqual(before);
    await expect(page.locator('#backup-dialog')).toBeHidden(); expect(context.pages()).toHaveLength(initialPages);
  }
});

test('a native synthetic CuEq recipe retains its assumptions, derived grades and exact exported figure through a backup', async ({ page, context }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 1280, height: 900 });
  await context.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/3d/'); await page.waitForFunction(() => window.EM3D?.getState().ready);
  const sources = [
    { name: 'synthetic-eq-collars.csv', text: 'HoleID,X,Y,Z,Length\nQA-EQ-A,500000,5500000,100,100\nQA-EQ-B,500100,5500100,100,80' },
    { name: 'synthetic-eq-assays.csv', text: 'HoleID,From,To,Cu_pct,Au_gpt\nQA-EQ-A,0,100,1,0.5\nQA-EQ-B,0,80,0.8,1' },
  ];
  await page.evaluate(async (input) => {
    const E = window.EM3D; E.clearFiles(); E.addFiles(input); await E.layersReady();
    E.setBrand({ title: 'Synthetic CuEq backup QA', company: 'Synthetic QA only' });
    E.setEquivalent({ base: 'Cu', basePrice: 4.5, baseRecovery: 90, metals: { Au: { price: 2500, recovery: 80 } }, use: true });
    // Uploads retain the previous figure's presentation cut-offs; make these
    // synthetic CuEq thresholds explicit instead of inheriting the sample's 3%.
    E.setStyle({ calloutMode: 'calculated', coMin: 20, coCut: 0.2, coIncl: 0.5 });
    E.setCamera({ azimuth: 40, plunge: 25, zoom: 90 }); await E.layersReady();
  }, sources);
  const before = await scientificPreview(page);
  await test.info().attach('native-equivalent-config', { body: JSON.stringify({ equivalent: before.equivalent, callouts: before.calloutSettings, candidates: before.candidates }), contentType: 'application/json' });
  expect(before.calloutSettings).toEqual({ mode: 'calculated', coMin: 20, coCut: 0.2, coIncl: 0.5 });
  const factor = ((2500 / 31.1035) * 80) / (22.0462 * 4.5 * 90);
  expect(before.equivalent).toMatchObject({ column: 'CuEq_calc', base: 'Cu', baseCol: 'Cu_pct', baseUnit: '%', basePrice: 4.5, baseRecovery: 90, metals: { Au: { col: 'Au_gpt', unit: 'g/t', price: 2500, recovery: 80 } } });
  expect(before.equivalent.factors.Au).toBeCloseTo(factor, 5);
  expect(before.grade.column).toBe('CuEq_calc'); expect(before.equivalent.note).toContain('Assumptions are illustrative');
  expect(before.candidates.find((candidate) => candidate.holeId === 'QA-EQ-A').broad).toBe(`100 m @ ${(1 + factor * 0.5).toFixed(2)}% CuEq`);
  expect(before.candidates.find((candidate) => candidate.holeId === 'QA-EQ-B').broad).toBe(`80 m @ ${(0.8 + factor).toFixed(2)}% CuEq`);
  const backup = await downloadBackupBytes(page);
  await page.locator('#backup-file').setInputFiles({ name: backup.name, mimeType: 'application/json', buffer: backup.bytes });
  const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open as new figure', exact: true }).click();
  const child = await opening; await child.setViewportSize({ width: 1280, height: 900 });
  await expect(child.locator('#status')).toHaveText('Backup opened as a new unsaved figure.');
  const after = await scientificPreview(child);
  expect(after.project.settings.eq).toEqual(before.project.settings.eq);
  expect(after.project.settings).toEqual(before.project.settings); expect(after.project.camera).toEqual(before.project.camera);
  expect(after.project.files).toEqual(before.project.files); expect(after.equivalent).toEqual(before.equivalent);
  expect(after.grade).toEqual(before.grade); expect(after.calloutSettings).toEqual(before.calloutSettings); expect(after.candidates).toEqual(before.candidates); await expectSameFigure(page, after.png, before.png);
  expect(await page.evaluate(() => window.EM3D.getProject())).toEqual(before.project);
  await child.locator('#stage').screenshot({ path: test.info().outputPath('local-backup-equivalent.png') }); await child.close();
});

test('native custom geology legend colours retain their override flags through the local backup file', async ({ page, context }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 1280, height: 900 });
  await context.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/3d/'); await page.waitForFunction(() => window.EM3D?.getState().ready);
  const sources = [
    { name: 'synthetic-geology-collars.csv', text: 'HoleID,X,Y,Z,Length\nQA-L-A,500000,5500000,100,100\nQA-L-B,500100,5500100,100,80' },
    { name: 'synthetic-lithology.csv', text: 'HoleID,From,To,LithCode\nQA-L-A,0,50,BAS\nQA-L-A,50,100,GRN\nQA-L-B,0,80,BAS' },
    { name: 'synthetic-lithology-legend.csv', text: 'Code,Name,Color\nBAS,Basalt supplied,#aabbcc\nGRN,Granite supplied,#ccddee' },
  ];
  await page.evaluate(async (input) => {
    const E = window.EM3D; E.clearFiles(); E.addFiles(input); await E.layersReady();
    E.setBrand({ title: 'Synthetic custom geology backup QA', company: 'Synthetic QA only' });
    // Native apply creates nameSet/colorSet; the backup fixture never inserts
    // these implementation flags directly into settings.
    await E.setGeology({ enabled: true, faces: 'all', strength: 1, legend: [{ code: 'BAS', name: 'Basalt custom QA', color: '#164e63' }] });
    E.setCamera({ azimuth: 40, plunge: 25, zoom: 90 }); await E.layersReady();
  }, sources);
  const before = await scientificPreview(page), legend = before.project.settings.geology.legend;
  expect(before.project.files.find((file) => file.name === sources[2].name).role).toBe('lithlegend');
  expect(legend.find((entry) => entry.code === 'BAS')).toMatchObject({ name: 'Basalt custom QA', color: '#164e63', nameSet: true, colorSet: true });
  expect(legend.find((entry) => entry.code === 'GRN')).toMatchObject({ name: 'Granite supplied', color: '#ccddee' });
  const backup = await downloadBackupBytes(page);
  await page.locator('#backup-file').setInputFiles({ name: backup.name, mimeType: 'application/json', buffer: backup.bytes });
  const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open as new figure', exact: true }).click();
  const child = await opening; await child.setViewportSize({ width: 1280, height: 900 });
  await expect(child.locator('#status')).toHaveText('Backup opened as a new unsaved figure.');
  const after = await scientificPreview(child);
  expect(after.project.settings.geology.legend).toEqual(legend);
  expect(await child.evaluate(() => window.EM3D.getState().geology.legend)).toEqual(legend);
  expect(after.project.settings).toEqual(before.project.settings); expect(after.project.files).toEqual(before.project.files);
  expect(after.project.camera).toEqual(before.project.camera); await expectSameFigure(page, after.png, before.png);
  expect(await page.evaluate(() => window.EM3D.getProject())).toEqual(before.project);
  await child.locator('#stage').screenshot({ path: test.info().outputPath('local-backup-custom-geology.png') }); await child.close();
});
