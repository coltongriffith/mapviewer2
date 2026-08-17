import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('tutorial-output');
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const video = page.video();
const narrationCues = [];
let narrationOriginAt = null;

const pause = (ms) => page.waitForTimeout(ms);

async function addTutorialOverlay() {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent =
      '#tutorial-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;background:rgba(12,26,53,.95);color:#fff;padding:14px 24px;border-radius:12px;font:600 22px Inter,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);pointer-events:none;max-width:900px;text-align:center}' +
      '#tutorial-cursor{position:fixed;left:707px;top:437px;z-index:2147483647;width:26px;height:26px;border:4px solid #fff;background:#2563eb;border-radius:50%;box-shadow:0 2px 10px rgba(0,0,0,.55);pointer-events:none;transition:left .65s ease,top .65s ease,transform .15s ease}';
    document.head.appendChild(style);
    const caption = document.createElement('div');
    caption.id = 'tutorial-caption';
    document.body.appendChild(caption);
    const cursor = document.createElement('div');
    cursor.id = 'tutorial-cursor';
    document.body.appendChild(cursor);
  });
}

async function caption(text, spokenText = text) {
  const now = Date.now();
  if (narrationOriginAt === null) narrationOriginAt = now;
  narrationCues.push({
    text,
    spokenText,
    atMs: now - narrationOriginAt + 350,
  });
  await page.evaluate((value) => {
    document.querySelector('#tutorial-caption').textContent = value;
  }, text);
}

async function moveTo(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Tutorial target is not visible');
  await page.evaluate(({ x, y }) => {
    const cursor = document.querySelector('#tutorial-cursor');
    cursor.style.left = String(x - 13) + 'px';
    cursor.style.top = String(y - 13) + 'px';
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await pause(800);
}

async function click(locator) {
  await moveTo(locator);
  await page.evaluate(() => {
    document.querySelector('#tutorial-cursor').style.transform = 'scale(.65)';
  });
  await locator.click();
  await pause(180);
  await page.evaluate(() => {
    document.querySelector('#tutorial-cursor').style.transform = 'scale(1)';
  });
}

try {
  await page.goto('https://www.explorationmaps.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await page.getByRole('button', { name: 'Search BC mineral claims' }).waitFor();
  await addTutorialOverlay();

  await caption(
    'How to search British Columbia mineral claims',
    'How to search British Columbia mineral claims.'
  );
  await pause(3200);

  await caption(
    'Open Exploration Maps and select “Search BC mineral claims.”',
    'Open Exploration Maps and select Search B C mineral claims.'
  );
  await click(page.getByRole('button', { name: 'Search BC mineral claims' }));
  await page.getByRole('heading', { name: 'Claims Registry Search' }).waitFor();
  await pause(3000);

  await caption(
    'British Columbia — Mineral Titles Online is selected automatically.',
    'British Columbia Mineral Titles Online is selected automatically.'
  );
  await pause(4000);

  await caption('Search by company name, claim number, or map sheet.');
  await pause(3800);

  await caption('For this example, search for Dolly Varden Silver.');
  const input = page.getByPlaceholder('e.g. Teck Resources');
  await moveTo(input);
  await input.fill('Dolly Varden Silver');
  await pause(900);

  await click(page.getByRole('button', { name: 'Search', exact: true }));
  await page.getByText('Skeena / Haida Gwaii').waitFor({ timeout: 30_000 });
  await pause(1800);

  await caption('The matching claim area shows its claim count, area, and expiry range.');
  await pause(5200);

  await caption('Select the result, then add the claims to your map.');
  await click(page.getByRole('checkbox', { name: 'Select All 1 area' }));
  const addButton = page.getByRole('button', { name: /^Add [0-9]+ claims to map$/ });
  await addButton.waitFor();
  await pause(600);
  await click(addButton);
  await page.getByRole('heading', { name: 'Claims Registry Search' }).waitFor({ state: 'hidden', timeout: 30_000 });
  await pause(3500);

  await caption(
    'The BC mineral claims are now loaded and ready to style or export.',
    'The B C mineral claims are now loaded and ready to style or export.'
  );
  await pause(5200);

  await caption('explorationmaps.com', 'Exploration Maps dot com.');
  await pause(2000);
} finally {
  await fs.writeFile(
    path.join(outputDir, 'narration-cues.json'),
    JSON.stringify(narrationCues, null, 2)
  );
  await context.close();
}

await video.saveAs(path.join(outputDir, 'bc-mineral-claims-search.webm'));
await browser.close();
console.log('Saved tutorial-output/bc-mineral-claims-search.webm');
console.log('Saved tutorial-output/narration-cues.json');
