import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('tutorial-series-output');
const ASSETS = path.resolve('scripts/tutorial-assets');
const SITE = 'https://www.explorationmaps.com/';
await fs.mkdir(ROOT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const pause = (page, ms) => page.waitForTimeout(ms);

async function addOverlay(page) {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent =
      '#tutorial-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;background:rgba(12,26,53,.95);color:#fff;padding:14px 24px;border-radius:12px;font:600 22px Inter,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);pointer-events:none;max-width:940px;text-align:center;line-height:1.25}' +
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

async function runTutorial(slug, body) {
  const outputDir = path.join(ROOT, slug);
  await fs.mkdir(outputDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const video = page.video();
  const cues = [];
  let origin = null;

  const caption = async (text, spokenText = text, holdMs = 5600) => {
    const now = Date.now();
    if (origin === null) origin = now;
    cues.push({ text, spokenText, atMs: now - origin + 350 });
    await page.evaluate((value) => {
      document.querySelector('#tutorial-caption').textContent = value;
    }, text);
    await pause(page, holdMs);
  };

  const moveTo = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Tutorial target is not visible in ${slug}`);
    await page.evaluate(({ x, y }) => {
      const cursor = document.querySelector('#tutorial-cursor');
      cursor.style.left = `${x - 13}px`;
      cursor.style.top = `${y - 13}px`;
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await pause(page, 800);
  };

  const click = async (locator) => {
    await moveTo(locator);
    await page.evaluate(() => {
      document.querySelector('#tutorial-cursor').style.transform = 'scale(.65)';
    });
    await locator.click();
    await pause(page, 180);
    await page.evaluate(() => {
      document.querySelector('#tutorial-cursor').style.transform = 'scale(1)';
    });
  };

  const clickMap = async (x, y) => {
    const map = page.locator('.leaflet-container').first();
    const box = await map.boundingBox();
    if (!box) throw new Error('Map is not visible');
    const px = box.x + x;
    const py = box.y + y;
    await page.evaluate(({ x: cx, y: cy }) => {
      const cursor = document.querySelector('#tutorial-cursor');
      cursor.style.left = `${cx - 13}px`;
      cursor.style.top = `${cy - 13}px`;
    }, { x: px, y: py });
    await pause(page, 800);
    await map.click({ position: { x, y } });
    await pause(page, 500);
  };

  const openHome = async () => {
    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.getByRole('button', { name: 'Start Mapping' }).first().waitFor();
    await addOverlay(page);
  };

  const openDemo = async (name = 'Claims & drill target map') => {
    await click(page.getByRole('button', { name }));
    await page.getByRole('textbox', { name: 'Title' }).waitFor();
    await pause(page, 1600);
  };

  const openBlankEditor = async () => {
    await click(page.getByRole('button', { name: 'Start Mapping' }).first());
    await page.getByRole('button', { name: 'Search public claims' }).waitFor();
    await pause(page, 900);
  };

  try {
    await openHome();
    await body({ page, caption, click, moveTo, clickMap, openDemo, openBlankEditor });
  } finally {
    await fs.writeFile(path.join(outputDir, 'narration-cues.json'), JSON.stringify(cues, null, 2));
    await context.close();
  }
  await video.saveAs(path.join(outputDir, `${slug}.webm`));
  console.log(`Recorded ${slug}`);
}

const tutorials = [
  ['01-investor-ready-map', async ({ page, caption, click, moveTo, openDemo }) => {
    await caption('How to create an investor-ready exploration map', undefined, 4200);
    await caption('Start with the claims and drill target sample.', undefined, 4800);
    await openDemo();
    await caption('The sample already includes claims, target areas, drill collars, a legend, and an inset map.', undefined, 7600);
    const title = page.getByRole('textbox', { name: 'Title' });
    await caption('Replace the sample title and subtitle with your project information.', undefined, 6200);
    await moveTo(title);
    await title.fill('Cedar Ridge Gold Project');
    await page.getByRole('textbox', { name: 'Subtitle' }).fill('Claims, targets, and drill program');
    await pause(page, 1100);
    await caption('Choose a basemap that supports the story without hiding your data.', undefined, 6000);
    await click(page.getByRole('button', { name: 'Satellite Satellite' }));
    await pause(page, 1500);
    await caption('Select Improve Map to automatically refine framing and layout.', undefined, 5900);
    await click(page.getByRole('button', { name: 'Improve Map' }));
    await pause(page, 1800);
    await caption('Your investor-ready project map is now ready for final styling and export.', undefined, 6500);
  }],

  ['02-search-canada-claims', async ({ page, caption, click, moveTo, openBlankEditor }) => {
    await caption('How to search mineral claims across Canada', undefined, 4200);
    await openBlankEditor();
    await caption('Choose Search public claims, then open the claims registry search.', undefined, 6000);
    await click(page.getByRole('button', { name: 'Search public claims' }));
    await click(page.getByRole('button', { name: 'Search Claims Registry' }));
    const dialog = page.getByRole('dialog');
    const jurisdiction = dialog.getByRole('combobox').first();
    await caption('Select the province whose public registry you want to search.', undefined, 5600);
    await moveTo(jurisdiction);
    await jurisdiction.selectOption({ label: 'Ontario — MLAS' });
    await pause(page, 600);
    await caption('Search by company or switch to an exact claim number.', undefined, 5400);
    const search = dialog.getByRole('textbox');
    await moveTo(search);
    await search.fill('Agnico Eagle Mines');
    await pause(page, 800);
    await caption('Run the search and review the matching legal owner names and claim counts.', undefined, 6500);
    await click(dialog.getByRole('button', { name: 'Search', exact: true }));
    const result = dialog.getByRole('button', { name: /AGNICO EAGLE MINES LIMITED.*claims/ }).first();
    await Promise.race([result.waitFor({ timeout: 30_000 }).catch(() => null), pause(page, 14_000)]);
    if (await result.isVisible().catch(() => false)) await moveTo(result);
    await caption('Select the correct owner, choose the claim areas you need, and add them to the map.', undefined, 7200);
  }],

  ['03-import-geojson-boundary', async ({ page, caption, moveTo, openBlankEditor }) => {
    await caption('How to import a GeoJSON project boundary', undefined, 4200);
    await openBlankEditor();
    const upload = page.getByRole('button', { name: 'Upload shapefile, GeoJSON, KML, or CSV file' });
    await caption('Use the Upload panel for GeoJSON, KML, KMZ, shapefiles, and CSV files.', undefined, 6800);
    await moveTo(upload);
    await page.locator('input[type="file"]').first().setInputFiles(path.join(ASSETS, 'sample-project.geojson'));
    await page.getByText('sample-project', { exact: false }).first().waitFor({ timeout: 30_000 });
    await pause(page, 1200);
    await caption('The project boundary is added as a new map layer and framed automatically.', undefined, 6600);
    const layer = page.getByRole('button', { name: /sample-project.*visibility/i }).first();
    if (await layer.isVisible().catch(() => false)) await moveTo(layer);
    await caption('Select the layer to rename it, assign a role, and adjust its line and fill styling.', undefined, 7200);
  }],

  ['04-import-drillhole-csv', async ({ page, caption, moveTo, click, openBlankEditor }) => {
    await caption('How to import drillhole collars from a CSV file', undefined, 4400);
    await openBlankEditor();
    const upload = page.getByRole('button', { name: 'Upload shapefile, GeoJSON, KML, or CSV file' });
    await caption('Upload a CSV that includes longitude, latitude, and a hole identifier.', undefined, 6600);
    await moveTo(upload);
    await page.locator('input[type="file"]').first().setInputFiles(path.join(ASSETS, 'sample-drillholes.csv'));
    await page.getByRole('heading', { name: 'Map CSV columns' }).waitFor();
    await caption('Exploration Maps detects the coordinate columns and previews the first rows.', undefined, 6800);
    await caption('Confirm the longitude, latitude, and point-name assignments, then import.', undefined, 6600);
    await click(page.getByRole('button', { name: 'Import drillholes' }));
    await page.getByText('sample-drillholes.csv', { exact: false }).first().waitFor({ timeout: 30_000 });
    await pause(page, 1200);
    await caption('The drill collars now appear as a styled point layer, ready for labels and callouts.', undefined, 7600);
  }],

  ['05-style-map-layers', async ({ page, caption, click, moveTo, openDemo }) => {
    await caption('How to style claims, targets, and drillhole layers', undefined, 4300);
    await openDemo();
    const drillLayer = page.getByRole('button', { name: /Drill Collars Drillholes.*visibility/ }).first();
    await caption('Select a layer to open its role-specific styling controls.', undefined, 5600);
    await click(drillLayer);
    const label = page.getByRole('textbox', { name: 'Display Label' });
    await caption('Give the layer a clear display label for the legend.', undefined, 5200);
    await moveTo(label);
    await label.fill('Priority Drill Collars');
    await pause(page, 800);
    await caption('For point data, set the marker size and choose a shape that stays readable.', undefined, 6600);
    const size = page.getByRole('slider', { name: 'Point Size' });
    await moveTo(size);
    await size.fill('14');
    await click(page.getByRole('button', { name: 'Star' }));
    await caption('Use a consistent theme so every layer, label, and panel reads as one map.', undefined, 6500);
    const theme = page.getByRole('combobox', { name: 'Design Theme' });
    await moveTo(theme);
    await theme.selectOption({ label: 'Technical' });
    await pause(page, 1600);
  }],

  ['06-switch-basemaps', async ({ page, caption, click, openDemo }) => {
    await caption('How to choose the right basemap', undefined, 3900);
    await openDemo();
    await caption('Use Terrain when topography and access routes are part of the story.', undefined, 6500);
    await click(page.getByRole('button', { name: 'Terrain Terrain' }));
    await pause(page, 1600);
    await caption('Use Satellite when recent land cover and surface context matter.', undefined, 6200);
    await click(page.getByRole('button', { name: 'Satellite Satellite' }));
    await pause(page, 1600);
    await caption('Use Light or Blank when your claims and technical layers need maximum contrast.', undefined, 6700);
    await click(page.getByRole('button', { name: 'Light Light' }));
    await pause(page, 1300);
    await caption('Always check that labels, outlines, and fills remain readable before export.', undefined, 6500);
  }],

  ['07-add-map-annotations', async ({ page, caption, click, clickMap, openDemo }) => {
    await caption('How to add markers and annotations', undefined, 4100);
    await openDemo();
    await caption('Open Annotations and choose Place Marker.', undefined, 5000);
    await click(page.getByRole('button', { name: 'Place Marker' }));
    await caption('Click the map where you want to highlight a target, access point, or field location.', undefined, 6900);
    await clickMap(520, 330);
    await pause(page, 900);
    await caption('Use dashed areas, distance rings, labels, boundaries, or measurements for added context.', undefined, 7600);
    await click(page.getByRole('button', { name: 'Draw Distance Ring' }));
    await caption('Every annotation remains editable, so you can refine its position and appearance later.', undefined, 7200);
  }],

  ['08-load-nearby-claims', async ({ page, caption, click, moveTo, openDemo }) => {
    await caption('How to load nearby mineral claims around a project', undefined, 4400);
    await openDemo();
    await caption('In Nearby Claims, select the correct jurisdiction for the project.', undefined, 6200);
    const radius = page.getByRole('combobox', { name: 'Search Radius' });
    await caption('Choose a search radius that gives useful context without overcrowding the map.', undefined, 7000);
    await moveTo(radius);
    await radius.selectOption({ label: '10 km' });
    await pause(page, 600);
    await caption('Select Load Claims to retrieve public tenure around the current project extent.', undefined, 6700);
    await click(page.getByRole('button', { name: 'Load Claims' }));
    await pause(page, 10_000);
    await caption('Nearby owners are separated by colour, making competing ground and open areas easier to review.', undefined, 7800);
  }],

  ['09-search-us-blm-claims', async ({ page, caption, click, moveTo, openBlankEditor }) => {
    await caption('How to search United States federal BLM mining claims', 'How to search United States federal B L M mining claims.', 4700);
    await openBlankEditor();
    await click(page.getByRole('button', { name: 'Search public claims' }));
    await click(page.getByRole('button', { name: 'Search Claims Registry' }));
    const dialog = page.getByRole('dialog');
    const jurisdiction = dialog.getByRole('combobox').first();
    await caption('Choose a supported western state, such as Nevada, from the jurisdiction list.', undefined, 6900);
    await moveTo(jurisdiction);
    await jurisdiction.selectOption({ label: 'Nevada — BLM MLRS (federal)' });
    await pause(page, 700);
    await caption('These results cover federal BLM claims, not state-managed mineral tenure.', 'These results cover federal B L M claims, not state-managed mineral tenure.', 7100);
    await caption('For the most precise lookup, switch to Claim Number and enter the complete BLM serial.', 'For the most precise lookup, switch to Claim Number and enter the complete B L M serial.', 7400);
    await click(dialog.getByRole('button', { name: 'Claim #' }));
    const serial = dialog.getByRole('textbox');
    await moveTo(serial);
    await serial.fill('NV101234567');
    await pause(page, 900);
    await caption('Use the Customer Info Report when you need to connect a claimant name to its serial numbers.', undefined, 7600);
  }],

  ['10-export-finished-map', async ({ page, caption, click, moveTo, openDemo }) => {
    await caption('How to export a finished exploration map', undefined, 4200);
    await openDemo();
    await caption('Open Export after you have checked the title, legend, scale bar, and map framing.', undefined, 7000);
    await click(page.getByRole('button', { name: 'Export', exact: true }));
    await caption('Choose a landscape, square, or portrait ratio for the final destination.', undefined, 6600);
    await click(page.getByRole('button', { name: 'Landscape 16:9' }));
    const filename = page.getByRole('textbox', { name: 'Filename' });
    await caption('Set a descriptive filename before downloading the map.', undefined, 5400);
    await moveTo(filename);
    await filename.fill('cedar-ridge-investor-map');
    await pause(page, 700);
    await caption('PNG is ideal for presentations, while SVG, Illustrator, and PDF support publication workflows.', undefined, 7600);
    await moveTo(page.getByRole('button', { name: 'Export PNG' }));
    await caption('Select Export PNG to generate the finished map.', undefined, 5200);
    const download = page.waitForEvent('download', { timeout: 25_000 }).catch(() => null);
    await click(page.getByRole('button', { name: 'Export PNG' }));
    await Promise.race([download, pause(page, 12_000)]);
    await caption('Your exploration map is ready to place in a deck, report, or investor update.', undefined, 6800);
  }],
];

const failures = [];
for (const [slug, body] of tutorials) {
  try {
    await runTutorial(slug, body);
  } catch (error) {
    console.error(`FAILED ${slug}:`, error);
    failures.push(`${slug}: ${error.message}`);
  }
}

await browser.close();
if (failures.length) {
  throw new Error(`Tutorial recording failures:\n${failures.join('\n')}`);
}
