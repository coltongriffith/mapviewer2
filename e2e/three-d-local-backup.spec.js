import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const files = [
  { name: 'synthetic-collars.csv', text: 'HoleID,X,Y,Z,Length\r\nQA-A,500000,5500000,100,100\r\nQA-B,500100,5500100,100,100' },
  { name: 'synthetic-ip.csv', text: 'X,Y,Z,Chargeability\n500000,5500000,100,10\n500010,5500010,90,12tail\n500020,5500020,80,"1,000"\n500030,5500030,70,<0.05\n500040,5500040,60,2e1' },
];
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
    expect(await restored.evaluate(async () => {
      await document.fonts.ready; await window.EM3D.layersReady();
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      return window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' });
    })).toEqual(before.png);
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
  expect(after.project.files).toEqual(before.project.files); expect(after.project.settings).toEqual(before.project.settings); expect(after.project.camera).toEqual(before.project.camera); expect(after.png).toEqual(before.png);
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
  expect(after.project.settings).toEqual(before.project.settings); expect(after.project.files).toEqual(before.project.files); expect(after.project.camera).toEqual(before.project.camera); expect(after.png).toEqual(before.png);
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
