import { test, expect } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import { createInitialProjectState } from '../shared/projectState.js';
import { collarGeojson, planCallouts, PLAN_CENTER } from '../tests/fixtures/dense-drill-plan.js';

// A dense drill plan (39 collars with traces, 7 intercept cards, every hole
// labelled with its ID) saved before layout 3, on a satellite basemap. After
// Auto-arrange every hole ID sits beside its own collar, nearer it than any
// other, in the editor and in the exported PNG. HOLE_IDS_PNG saves the export.
test.skip(({ isMobile }) => isMobile, 'Exports are a desktop flow');
test.use({ viewport: { width: 1600, height: 1000 } });

// A mottled green-brown 256 px tile, so the export reads like imagery.
function tilePng(seed) {
  const n = 256, raw = Buffer.alloc((n * 3 + 1) * n);
  for (let y = 0; y < n; y += 1) {
    raw[y * (n * 3 + 1)] = 0;
    for (let x = 0; x < n; x += 1) {
      const v = Math.sin((x + seed) * 0.07) * Math.cos((y - seed) * 0.05) + Math.sin((x * 0.31 + y * 0.17 + seed) * 0.4) * 0.35;
      const o = y * (n * 3 + 1) + 1 + x * 3;
      raw[o] = 74 + v * 22; raw[o + 1] = 84 + v * 20; raw[o + 2] = 58 + v * 14;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('hole IDs sit at their own collars after Auto-arrange, in the editor and the PNG', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://server.arcgisonline.com/**', (route) => {
    const x = Number(new URL(route.request().url()).pathname.split('/').at(-1)) || 0;
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tilePng(x * 37) });
  });

  const project = createInitialProjectState();
  project.layout = { ...project.layout, basemap: 'satellite', layoutAlgorithm: 2, title: 'Dense drill plan', subtitle: '39 collars, synthetic', legendItems: [] };
  project.mapView = { center: PLAN_CENTER, zoom: 15.5 };
  project.layers = [{
    id: 'collars', name: 'collars', sourceName: 'collars.csv', dataSource: 'upload', displayName: 'Drill collars', type: 'points',
    visible: true, role: 'drillholes', geojson: collarGeojson, userStyled: false, legend: { enabled: true, label: 'Drill collars' },
  }];
  project.callouts = planCallouts();
  const draft = JSON.stringify({ schemaVersion: 1, payload: project, projectId: null, projectName: 'Dense drill plan' });
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('holeids-seeded')) return;
    localStorage.setItem('mapviewer.draft.v1', value);
    sessionStorage.setItem('holeids-seeded', '1');
  }, draft);

  await page.goto('/?intent=resume');
  await expect(page.locator('.map-callout')).toHaveCount(46, { timeout: 30_000 });
  await page.locator('#ins-tab-annotate').click();
  await page.getByRole('button', { name: 'Auto-arrange' }).click();
  await page.waitForTimeout(500);

  // Collars are the drill layer's circle markers, in file order; hole IDs are
  // the title-only cards. Distances in the stage's logical px.
  const rows = await page.evaluate(() => {
    const host = document.querySelector('.leaflet-container');
    const sc = host.getBoundingClientRect().width / host.offsetWidth;
    const collars = [...document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive')]
      .filter((p) => /a/.test(p.getAttribute('d') || ''))
      .map((p) => { const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const gap = (r, p) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom)) / sc;
    const box = (el) => el.getBoundingClientRect();
    const cards = [...document.querySelectorAll('.map-callout')].filter((el) => /^RN-25-\d{3}: /.test(el.textContent.trim())).map(box);
    const tags = [...document.querySelectorAll('.map-callout')].filter((el) => /^RN-25-\d{3}$/.test(el.textContent.trim())).map(box);
    const under = cards.reduce((n, a) => n + tags.filter((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).length, 0);
    return { under, collars: collars.length, labels: [...document.querySelectorAll('.map-callout')].filter((el) => /^RN-25-\d{3}$/.test(el.textContent.trim())).map((el) => {
      const id = el.textContent.trim(), r = el.getBoundingClientRect(), own = collars[Number(id.slice(-3)) - 1];
      return { id, own: gap(r, own), other: Math.min(...collars.filter((c) => c !== own).map((c) => gap(r, c))), collides: el.classList.contains('collides') ? el.title : false };
    }) };
  });

  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Export PNG', exact: true }).first().click();
  await page.getByRole('button', { name: 'Download with watermark', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  if (process.env.HOLE_IDS_PNG) await file.saveAs(process.env.HOLE_IDS_PNG);

  const own = rows.labels.map((r) => r.own).sort((a, b) => a - b);
  console.log(`hole IDs: ${rows.labels.length}, collars ${rows.collars}; own-collar gap median ${own[19]?.toFixed(1)} px, max ${own.at(-1)?.toFixed(1)} px; nearer another collar: ${rows.labels.filter((r) => r.other <= r.own).length}; cards over labels: ${rows.under}; flagged: ${rows.labels.filter((r) => r.collides).map((r) => `${r.id} (${r.collides})`).join(', ') || 'none'}`);
  expect(rows.under, 'intercept cards over hole-ID labels').toBe(0);
  expect(rows.collars).toBe(39);
  expect(rows.labels).toHaveLength(39);
  // Beside the collar (within 24 px), or — where the plan is too tight — out
  // on its (dashed) leader, not far.
  expect(rows.labels.filter((r) => r.own <= 24).length).toBeGreaterThanOrEqual(35);
  for (const r of rows.labels) {
    expect(r.own, `${r.id} is ${r.own.toFixed(1)} px from its collar`).toBeLessThanOrEqual(100);
    expect(r.other, `${r.id} is nearer another collar`).toBeGreaterThan(r.own);
    expect(r.collides, r.id).toBe(false);
  }
});
