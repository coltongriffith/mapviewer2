import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const [name, device] of [['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
  test.describe(name, () => {
    test.use(device);
    test('preserved local data can be downloaded and dismissed without console access or data changes', async ({ page }, testInfo) => {
      const raw = { 'mapviewer.projects.v1': 'gz1:synthetic-corrupt-saved-maps\r\nQA',
        'mapviewer.draft.v1': '\uFEFF{"synthetic":"BOM corruption fixture-é"}' };
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => route.fulfill({ status: 204 }));
      await page.route('https://example.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
      await page.addInitScript(values => {
        if (sessionStorage.getItem('recovery-qa-seeded')) return;
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
        sessionStorage.setItem('recovery-qa-seeded', '1');
      }, raw);
      await page.goto('/?intent=resume');
      const notice = page.getByRole('region', { name: 'Local data recovery' });
      await expect(notice).toBeVisible();
      await expect(notice).not.toContainText('__exportRecovery');
      await page.waitForFunction(() => !!window.EMAP);
      await page.evaluate(() => window.EMAP.ready());
      const stored = () => page.evaluate(keys => Object.fromEntries(keys.flatMap(key => [key, key + '.recovery']).map(key => [key, localStorage.getItem(key)])), Object.keys(raw));
      const before = await stored();
      for (const [key, value] of Object.entries(raw)) expect(before[key + '.recovery']).toBe(value);
      const box = await notice.boundingBox(); expect(box.width).toBeLessThanOrEqual(device.viewport.width);
      await page.screenshot({ path: testInfo.outputPath('recovery-notice.png') });
      for (const [label, key, file] of [['draft', 'mapviewer.draft.v1', 'draft'], ['saved maps', 'mapviewer.projects.v1', 'saved-maps']]) {
        const downloaded = page.waitForEvent('download');
        await notice.getByRole('button', { name: `Download ${label} recovery copy` }).click();
        const download = await downloaded;
        expect(download.suggestedFilename()).toBe(`exploration-maps-${file}-recovery.txt`);
        const bytes = await readFile(await download.path());
        expect(bytes.equals(Buffer.from(raw[key], 'utf8'))).toBe(true);
        expect(bytes.toString('utf8')).toBe(raw[key]);
        await expect(notice.getByRole('status')).toContainText('download started');
        expect(await stored()).toEqual(before);
      }
      await notice.getByRole('button', { name: 'Dismiss recovery notice' }).click();
      await expect(notice).toHaveCount(0); expect(await stored()).toEqual(before);
      // No seed is replayed: a new document rediscovers the preserved originals.
      await page.goto('/?intent=resume'); await expect(notice).toBeVisible();
      const after = await stored(); for (const key of Object.keys(raw)) expect(after[key + '.recovery']).toBe(raw[key]);
      expect(errors).toEqual([]);
    });
  });
}
