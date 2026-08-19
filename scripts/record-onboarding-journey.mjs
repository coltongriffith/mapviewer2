import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('onboarding-series-output');
const ASSETS = path.resolve('scripts/tutorial-assets');
const SITE = 'https://www.explorationmaps.com/';
const SLUG = 'exploration-maps-complete-onboarding';
const DEMO_EMAIL = 'demo@explorationmaps.com';

await fs.mkdir(ROOT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: ROOT, size: { width: 1440, height: 900 } },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const video = page.video();
const cues = [];
const chapters = [];
let origin = null;

const pause = (ms) => page.waitForTimeout(ms);

// Keep the tutorial from creating a real test account or sending an email.
// The product UI still follows the same successful magic-link path shown to users.
await page.route('**/auth/v1/otp**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

async function addOverlay() {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent =
      '#tutorial-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;background:rgba(12,26,53,.95);color:#fff;padding:14px 24px;border-radius:12px;font:600 22px Inter,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);pointer-events:none;max-width:940px;text-align:center;line-height:1.25}' +
      '#tutorial-cursor{position:fixed;left:707px;top:437px;z-index:2147483647;width:26px;height:26px;border:4px solid #fff;background:#2563eb;border-radius:50%;box-shadow:0 2px 10px rgba(0,0,0,.55);pointer-events:none;transition:left .65s ease,top .65s ease,transform .15s ease}' +
      '#tutorial-download{position:fixed;right:24px;top:82px;z-index:2147483645;background:#ecfdf5;color:#065f46;border:1px solid #6ee7b7;border-radius:10px;padding:12px 16px;font:600 15px Inter,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.16);pointer-events:none}';
    document.head.appendChild(style);
    const caption = document.createElement('div');
    caption.id = 'tutorial-caption';
    document.body.appendChild(caption);
    const cursor = document.createElement('div');
    cursor.id = 'tutorial-cursor';
    document.body.appendChild(cursor);
  });
}

function elapsedMs() {
  if (origin === null) origin = Date.now();
  return Date.now() - origin;
}

async function chapter(slug, title) {
  chapters.push({ slug, title, startMs: elapsedMs() });
}

async function caption(text, spokenText = text, holdMs = 5800) {
  cues.push({ text, spokenText, atMs: elapsedMs() + 350 });
  await page.evaluate((value) => {
    document.querySelector('#tutorial-caption').textContent = value;
  }, text);
  await pause(holdMs);
}

async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Tutorial target is not visible');
  await page.evaluate(({ x, y }) => {
    const cursor = document.querySelector('#tutorial-cursor');
    cursor.style.left = `${x - 13}px`;
    cursor.style.top = `${y - 13}px`;
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
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByRole('button', { name: 'Start Mapping' }).first().waitFor();
  await addOverlay();

  await chapter('01-first-visit-and-start', 'First visit and start mapping');
  await caption('Build your first Exploration Maps project — from first visit to download.', undefined, 5400);
  await caption('Select Start Mapping. You can explore the editor before creating an account.', undefined, 6200);
  await click(page.getByRole('button', { name: 'Start Mapping' }).first());
  await page.getByRole('button', { name: 'Search public claims' }).waitFor();
  await pause(1200);

  await chapter('02-find-and-add-mineral-claims', 'Find and add mineral claims');
  await caption('Find and add the mineral claims for your project.', undefined, 4700);
  await click(page.getByRole('button', { name: 'Search public claims' }));
  await click(page.getByRole('button', { name: 'Search Claims Registry' }));
  await page.getByRole('heading', { name: 'Claims Registry Search' }).waitFor();
  await caption('British Columbia Mineral Titles Online is selected. Search by company, claim number, or map sheet.', undefined, 7200);
  const search = page.getByPlaceholder('e.g. Teck Resources');
  await moveTo(search);
  await search.fill('Dolly Varden Silver');
  await pause(700);
  await click(page.getByRole('button', { name: 'Search', exact: true }));
  await page.getByText('Skeena / Haida Gwaii').waitFor({ timeout: 30_000 });
  await caption('Review the matching area, select it, and add the claims to the map.', undefined, 6200);
  await click(page.getByRole('checkbox', { name: 'Select All 1 area' }));
  const addClaims = page.getByRole('button', { name: /^Add [0-9]+ claims to map$/ });
  await addClaims.waitFor();
  await click(addClaims);
  await page.getByRole('heading', { name: 'Claims Registry Search' }).waitFor({ state: 'hidden', timeout: 30_000 });
  await pause(2600);

  await chapter('03-add-project-and-drill-data', 'Add project and drill data');
  await caption('Add your own project boundary and drill data.', undefined, 4800);
  const uploadInput = page.locator('input[type="file"]').first();
  const uploadButton = page.getByRole('button', { name: 'Upload shapefile, GeoJSON, KML, or CSV file' });
  await caption('Upload GeoJSON, KML, KMZ, shapefiles, or CSV files from the Upload panel.', undefined, 6800);
  await moveTo(uploadButton);
  await uploadInput.setInputFiles(path.join(ASSETS, 'sample-project.geojson'));
  await page.getByText('sample-project', { exact: false }).first().waitFor({ timeout: 30_000 });
  await pause(1500);
  await caption('Next, upload a CSV with longitude, latitude, and drillhole identifiers.', undefined, 6500);
  await moveTo(uploadButton);
  await uploadInput.setInputFiles(path.join(ASSETS, 'sample-drillholes.csv'));
  await page.getByText('sample-drillholes.csv', { exact: false }).first().waitFor({ timeout: 30_000 });
  await pause(1800);

  await chapter('04-style-and-add-context', 'Style the map and add context');
  await caption('Style the map and add the context an investor needs.', undefined, 5000);
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await moveTo(title);
  await title.fill('Cedar Ridge Exploration Project');
  await page.getByRole('textbox', { name: 'Subtitle' }).fill('Claims, targets, drilling, and access');
  await caption('Use a clear project title and subtitle that explain what the map shows.', undefined, 6200);
  const boundaryLayer = page.getByRole('button', { name: /sample-project.*visibility/i }).first();
  if (await boundaryLayer.isVisible().catch(() => false)) {
    await click(boundaryLayer);
    const displayLabel = page.getByRole('textbox', { name: 'Display Label' });
    if (await displayLabel.isVisible().catch(() => false)) {
      await moveTo(displayLabel);
      await displayLabel.fill('Cedar Ridge Project Boundary');
    }
  }
  await caption('Select any layer to give it a clean legend label and adjust its styling.', undefined, 6200);
  await click(page.getByRole('button', { name: 'Satellite Satellite' }));
  await pause(1300);
  await caption('Choose a basemap that supports the story without hiding your project data.', undefined, 6200);
  const referenceButton = page.getByRole('button', { name: /Reference Overlays/ });
  if ((await referenceButton.getAttribute('aria-expanded')) !== 'true') await click(referenceButton);
  const roads = page.getByRole('checkbox', { name: 'Roads + Settlements' });
  const labels = page.getByRole('checkbox', { name: 'Reference Labels' });
  if (!(await roads.isChecked())) await click(roads);
  if (!(await labels.isChecked())) await click(labels);
  await caption('Reference overlays can add roads, settlements, labels, railways, and geology.', undefined, 7000);

  await chapter('05-save-and-reopen-your-map', 'Save and reopen your map');
  await caption('Save the map so you can return to it later.', undefined, 4600);
  page.once('dialog', (dialog) => dialog.accept('Cedar Ridge Exploration Map'));
  await click(page.getByRole('button', { name: 'Save As', exact: true }));
  await pause(1800);
  await caption('Save As creates a named project. Signed-out work stays on this device.', undefined, 6200);
  await click(page.getByRole('button', { name: 'Open', exact: true }));
  await page.getByRole('heading', { name: 'Saved Projects' }).waitFor();
  const savedProject = page.getByText('Cedar Ridge Exploration Map', { exact: true });
  await moveTo(savedProject);
  await caption('Open lists your saved projects so you can continue editing or export again.', undefined, 6500);
  await savedProject.click();
  await page.getByRole('heading', { name: 'Saved Projects' }).waitFor({ state: 'hidden' });
  await pause(1400);

  await chapter('06-create-a-free-account', 'Create a free account');
  await caption('Create a free account to keep projects beyond this browser.', undefined, 5200);
  const localBadge = page.locator('.autosave-badge');
  await click(localBadge);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await caption('Enter your email. Exploration Maps sends a no-password sign-in link and creates the account if you are new.', undefined, 7600);
  const authEmail = page.getByRole('textbox', { name: 'Email' });
  await moveTo(authEmail);
  await authEmail.fill(DEMO_EMAIL);
  await click(page.getByRole('button', { name: 'Email me a sign-in link' }));
  await page.getByText(/We emailed a sign-in link/).waitFor({ timeout: 20_000 });
  await caption('Open the link in your email to sign in. Your map remains available while you do.', undefined, 7000);
  await click(page.getByRole('button', { name: 'Close' }));

  await chapter('07-export-and-download', 'Export and download the finished map');
  await caption('Export and download the finished map.', undefined, 4700);
  await click(page.getByRole('button', { name: 'Export', exact: true }));
  await click(page.getByRole('button', { name: 'Landscape 16:9' }));
  const filename = page.getByRole('textbox', { name: 'Filename' });
  await moveTo(filename);
  await filename.fill('cedar-ridge-exploration-map');
  await caption('Choose the final ratio, enter a useful filename, and select Export PNG.', undefined, 6700);
  const exportPng = page.locator('#section-export').getByRole('button', { name: 'Export PNG' });
  await click(exportPng);
  await page.getByRole('dialog').waitFor({ timeout: 25_000 });
  const workEmail = page.getByRole('textbox', { name: 'Work email' });
  await moveTo(workEmail);
  await workEmail.fill(DEMO_EMAIL);
  await caption('Enter your email to remove the large watermark and receive your reusable sign-in link.', undefined, 7200);
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await click(page.getByRole('button', { name: /Email my link & download clean PNG/ }));
  const download = await downloadPromise;
  const downloadPath = path.join(ROOT, 'cedar-ridge-exploration-map.png');
  await download.saveAs(downloadPath);
  await page.evaluate((name) => {
    const previous = document.querySelector('#tutorial-download');
    if (previous) previous.remove();
    const badge = document.createElement('div');
    badge.id = 'tutorial-download';
    badge.textContent = `Downloaded: ${name}`;
    document.body.appendChild(badge);
  }, await download.suggestedFilename());
  const notNow = page.getByText('Not now', { exact: true });
  if (await notNow.isVisible().catch(() => false)) {
    await click(notNow);
    await pause(500);
  }
  await caption('The PNG downloads immediately. It is ready for a deck, website, report, or investor update.', undefined, 7600);
  await caption('Exploration Maps dot com.', 'Exploration Maps dot com.', 2800);

  const endMs = elapsedMs() + 800;
  const normalized = chapters.map((item, index) => ({
    ...item,
    endMs: chapters[index + 1]?.startMs ?? endMs,
  }));
  await fs.writeFile(path.join(ROOT, 'chapters.json'), JSON.stringify(normalized, null, 2));
} finally {
  await fs.writeFile(path.join(ROOT, 'narration-cues.json'), JSON.stringify(cues, null, 2));
  await context.close();
}

await video.saveAs(path.join(ROOT, `${SLUG}.webm`));
await browser.close();
console.log(`Saved ${ROOT}/${SLUG}.webm`);
console.log(`Saved ${ROOT}/narration-cues.json and chapters.json`);
