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
    const before = await page.evaluate(async () => ({ project: window.EM3D.getProject(), diagnostics: window.EM3D.getState().geophys.diagnostics, png: await window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }) }));
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
    expect(after.diagnostics).toEqual(before.diagnostics);
    expect(after.opener).toBeNull(); expect(after.hash).toBe('');
    expect(after.project.files.find((f) => f.name === files[1].name).geophysNumericPolicy).toBe('finite-decimal-v1');
    expect(await restored.evaluate(async () => { await window.EM3D.layersReady(); return window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }); })).toEqual(before.png);
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
  const before = await page.evaluate(async () => ({ project: window.EM3D.getProject(), png: await window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }) }));
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
  const after = await restored.evaluate(async () => { await window.EM3D.layersReady(); return { project: window.EM3D.getProject(), png: await window.EM3D.exportPNG({ view: '3d', width: 400, background: 'transparent' }) }; });
  expect(after.project.files).toEqual(before.project.files); expect(after.project.settings).toEqual(before.project.settings); expect(after.png).toEqual(before.png);
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
