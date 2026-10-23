/* global EMAP */
import { test, expect } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInitialProjectState } from '../shared/projectState.js';
import { CRS, COLLARS_CSV, SURVEYS_CSV, ASSAYS_CSV, RESULTS_CSV } from '../tests/fixtures/tower-drill.js';

// window.EMAP (Tower v3 spec items 43 and 45): a Tower Fig 1-like figure built in the 2D editor through the API
// alone, with fictional data: claims, geology units feathered and named in their fill, a soil plume, a trend and a
// thrust named along their lines, the Studio title card, legend, satellite inset and scale-north panel, the drill
// plan's interval tags and NEW results card. Then PNG and SVG come back as data, and the map is duplicated and saved
// with no dialog. SVG export and the cloud save need the configured client build with a mocked Pro account
// (playwright.admin.config.js). E2E_RENDER_DIR=<dir> keeps the PNG, the SVG and the EMAP.help() text.
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');
test.skip(({ isMobile }) => isMobile, 'The editor is a desktop flow');
test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ timeout: 180_000 });

const uid = '00000000-0000-4000-8000-0000000000a4';
const user = { id: uid, email: 'emap@tower.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };
const keep = (name, data) => { const d = process.env.E2E_RENDER_DIR; if (!d) return; mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), data); };

// A mottled green-brown 256 px tile, so the satellite basemap reads like imagery without the network.
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

// Auth, plan and the projects table in memory; nothing leaves the browser.
async function fakeSupabase(page, { signedIn = true } = {}) {
  const db = { rows: [], creates: [], updates: [], dialogs: [] };
  let next = 1;
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://server.arcgisonline.com/**', (route) => {
    const x = Number(new URL(route.request().url()).pathname.split('/').at(-1)) || 0;
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tilePng(x * 37) });
  });
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, fn = path.split('/').pop();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!signedIn && path.startsWith('/auth/v1/')) return json({ message: 'Not signed in' }, 401);
    if (path.startsWith('/auth/v1/')) return json(fn === 'user' ? user : fn === 'token' ? session : {});
    if (fn === 'user_plans') return json({ plan: 'pro', source: 'test', status: 'active' });
    if (fn === 'create_cloud_project') {
      if (db.failCreates) return json({ code: 'P0001', message: 'Project quota reached' }, 409);
      const args = req.postDataJSON(), id = `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
      db.creates.push(args);
      db.rows.unshift({ id, name: args.p_name, payload: args.p_payload, revision: 1, updated_at: new Date().toISOString(), thumbnail: null });
      return json(id);
    }
    if (fn === 'save_cloud_project') {
      if (db.failSaves) return json({ code: 'XX000', message: 'Save service unavailable' }, 503);
      const args = req.postDataJSON(), row = db.rows.find((r) => r.id === args.p_id);
      db.updates.push(args);
      if (row) Object.assign(row, { name: args.p_name, payload: args.p_payload, revision: row.revision + 1 });
      return json(row ? row.revision : 1);
    }
    if (path === '/rest/v1/projects' && req.method() === 'GET') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      if (id && db.failLoads) return json({ code: 'PGRST116', message: 'Saved map unavailable' }, 406);
      if (id) { const row = db.rows.find((r) => r.id === id); return row ? json(row) : json({ code: 'PGRST116', message: 'no rows' }, 406); }
      return json(db.rows.map(({ payload: _p, ...r }) => r));
    }
    if (path === '/rest/v1/templates' && (req.headers().accept || '').includes('vnd.pgrst.object')) return json({ code: 'PGRST116', message: 'no rows' }, 406);
    return json([]);
  });
  // Every glyph the canvases draw, and a blank map to start from.
  const blank = createInitialProjectState();
  blank.layout = { ...blank.layout, title: 'Untitled map', subtitle: '', footerEnabled: false };
  const draft = JSON.stringify({ schemaVersion: 1, payload: blank, projectId: null, projectName: 'Untitled map' });
  await page.addInitScript(([s, id, d]) => {
    if (s) localStorage.setItem('sb-example-auth-token', JSON.stringify(s));
    localStorage.setItem(`em_migration_v2_${id}`, JSON.stringify({ done: true, projects: {} }));
    if (!sessionStorage.getItem('emap-seeded')) { localStorage.setItem('mapviewer.draft.v1', d); sessionStorage.setItem('emap-seeded', '1'); }
    window.__texts = [];
    const f = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__texts.push(String(t)); return f.call(this, t, ...a); };
  }, [signedIn ? session : null, uid, draft]);
  // No native dialog may open at any point.
  page.on('dialog', (d) => { db.dialogs.push(d.message()); d.dismiss(); });
  return db;
}

// Fictional geology round the Tower-like drill pad (tests/fixtures/tower-drill.js, NAD83 / UTM 10N).
const ring = (pts) => [[...pts, pts[0]]];
const poly = (pts, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: ring(pts) } });
const GEO = {
  claims: { type: 'FeatureCollection', features: [poly([[-120.716, 50.588], [-120.668, 50.588], [-120.668, 50.6125], [-120.716, 50.6125]], { tenure: '1098765' })] },
  volcanics: { type: 'FeatureCollection', features: [poly([[-120.716, 50.588], [-120.692, 50.588], [-120.686, 50.594], [-120.696, 50.602], [-120.716, 50.604]], { unit: 'uTrN', rock: 'andesite flows' })] },
  stock: { type: 'FeatureCollection', features: [poly([[-120.690, 50.6015], [-120.680, 50.600], [-120.672, 50.6045], [-120.674, 50.610], [-120.684, 50.611], [-120.692, 50.607]], { unit: 'EJd', rock: 'diorite' })] },
  soil: { type: 'FeatureCollection', features: [poly([[-120.6955, 50.5975], [-120.6885, 50.5970], [-120.6870, 50.6015], [-120.6930, 50.6035], [-120.6975, 50.6010]])] },
  trend: { type: 'LineString', coordinates: [[-120.714, 50.5915], [-120.700, 50.5965], [-120.690, 50.6005], [-120.6705, 50.6090]] },
  thrust: { type: 'LineString', coordinates: [[-120.712, 50.6105], [-120.698, 50.6045], [-120.684, 50.5960], [-120.671, 50.5905]] },
};

test('EMAP builds a Tower Fig 1-like figure, exports PNG and SVG as data, duplicates and saves without a dialog', async ({ page }) => {
  const db = await fakeSupabase(page);
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.EMAP, null, { timeout: 30_000 });

  // The help, in sections, readable as EM3D's.
  const help = await page.evaluate(() => ({ top: EMAP.help(), labels: EMAP.help('labels'), all: EMAP.help('all') }));
  expect(help.top).toContain("EMAP.help('labels')");
  for (const s of ['view', 'layers', 'geology', 'labels', 'cards', 'callouts', 'drill', 'export', 'project']) expect(help.top).toContain(`  ${s} `);
  expect(help.labels).toContain('EMAP.setLayerLabel');
  keep('emap-help.txt', `${help.top}\n\n${'='.repeat(100)}\n\n${help.all}\n`);

  // Invalid input says what is allowed.
  const err = await page.evaluate(() => EMAP.setTitle({ titel: 'x' }).then(() => null, (e) => e.message));
  expect(err).toBe('setTitle does not take "titel". It takes: title, subtitle, kicker, date, projectNumber, scaleNote, show, box, corner.');

  const summary = await page.evaluate(async ([G, files, crs]) => {
    await EMAP.ready();
    await EMAP.setTheme({ theme: 'studio', accent: '#2f9e44' });
    await EMAP.setBasemap('satellite');
    await EMAP.setWash({ amount: 0.18, vignette: 0.35 });
    const claims = await EMAP.addLayer({ name: 'Rabbit North claims', role: 'claims', geojson: G.claims, style: { fill: '#ffffff', fillOpacity: 0.04, stroke: '#ffffff', strokeWidth: 2, dash: true } });
    const volc = await EMAP.addLayer({ name: 'Nicola Group', role: 'other', geojson: G.volcanics, style: { fill: '#7fb77e', fillOpacity: 0.45, stroke: '#ffffff', strokeWidth: 1 } });
    await EMAP.setGeoStyle(volc, { feather: 10, outline: false });
    await EMAP.setLayerLabel(volc, { sub: 'andesite flows', size: 15 });
    const stock = await EMAP.addLayer({ name: 'Durand Stock', role: 'other', geojson: G.stock, style: { fill: '#e7a1bf', fillOpacity: 0.55 }, fx: { feather: 8, outline: false } });
    await EMAP.setLayerLabel(stock, { sub: 'diorite', rotate: 'auto' });
    const soil = await EMAP.addLayer({ name: 'Gold-in-soil anomaly', role: 'anomalies', geojson: G.soil, style: { fill: '#f5c518', fillOpacity: 0.5 } });
    await EMAP.setGeoStyle(soil, { plume: { az: 225, tail: 0, blur: 6 } });
    const trend = await EMAP.addLayer({ name: 'Thunder trend', role: 'faults_structures', geojson: G.trend, style: { stroke: '#f5b425', strokeWidth: 4 } });
    await EMAP.setGeoStyle(trend, { lineType: 'trend', glow: 6 });
    await EMAP.setLayerLabel(trend, { side: 'left', offset: 7, start: 22 });
    const thrust = await EMAP.addLayer({ name: 'Bluebird thrust', role: 'faults_structures', geojson: G.thrust, style: { stroke: '#e03131', strokeWidth: 2.5 } });
    await EMAP.setGeoStyle(thrust, { lineType: 'thrust', teeth: 'right' });
    await EMAP.setLayerLabel(thrust, { side: 'right', offset: 8, start: 75, size: 11 });
    await EMAP.setLayer(claims, { legend: true });

    await EMAP.setTitle({ title: 'Rabbit North Project', subtitle: 'Geology, soil anomaly and drilling', kicker: 'SAMPLE RESOURCES · TSXV: SMP', date: 'October 2026' });
    await EMAP.setLegend({ title: 'Legend', corner: 'bl' });
    await EMAP.setInset({ style: 'satellite', title: 'Project location', label: 'British Columbia, Canada', pill: 'TSXV: SMP', projectLabel: 'RABBIT NORTH' });
    await EMAP.setScaleNorth({ home: 'panel', northStyle: 'rose', datumNote: 'NAD83 / UTM Zone 10N' });

    const plan = await EMAP.setDrillPlan({ files, crs });
    await EMAP.setResultsCard({ show: true, title: 'Blue Sky · Holes 077 & 078', isNew: true });
    await EMAP.setIntervalTags({ show: true });
    await EMAP.setView({ center: { lat: 50.6003, lng: -120.6925 }, zoom: 15 });
    return { plan, state: EMAP.getState() };
  }, [GEO, [{ name: 'collars.csv', text: COLLARS_CSV }, { name: 'surveys.csv', text: SURVEYS_CSV }, { name: 'assays.csv', text: ASSAYS_CSV }, { name: 'release.csv', text: RESULTS_CSV }], CRS]);

  expect(summary.plan).toMatchObject({ holes: 9, assays: 560, results: 9 });
  const st = summary.state;
  expect(st.layers.map((l) => [l.name, l.geometry])).toEqual([
    ['Rabbit North claims', 'polygon'], ['Nicola Group', 'polygon'], ['Durand Stock', 'polygon'], ['Gold-in-soil anomaly', 'polygon'], ['Thunder trend', 'line'], ['Bluebird thrust', 'line'],
  ]);
  expect(st.layers[2].fx).toMatchObject({ feather: 8, outline: false, label: { sub: 'diorite', rotate: 'auto', on: true } });
  expect(st.layers[4].fx).toMatchObject({ lineType: 'trend', glow: 6, label: { side: 'left', on: true } });
  expect(st.theme.theme).toBe('studio');
  expect(st.title).toMatchObject({ title: 'Rabbit North Project', kicker: 'SAMPLE RESOURCES · TSXV: SMP' });
  expect(st.inset).toMatchObject({ style: 'satellite', pill: 'TSXV: SMP' });
  expect(st.scaleNorth).toMatchObject({ home: 'panel', northStyle: 'rose' });
  expect(st.drillPlan.show).toMatchObject({ card: true, tags: true });
  expect(st.view.zoom).toBe(15);
  expect(st.map.unsaved).toBe(true); // API edits are unsaved work, as clicks are

  // The stage shows what was built: the Studio cards, the fx canvases, the drill plan's card and tags.
  await page.waitForTimeout(1500);
  for (const t of ['Rabbit North Project', 'TSXV: SMP']) await expect(page.locator('.map-stage').getByText(t).first()).toBeVisible();
  await expect(page.locator('.map-stage .drill-plan-layer text', { hasText: 'NEW' })).toHaveCount(1);
  await expect(page.locator('.legend-card')).toContainText('Durand Stock');

  // Undo steps back through API edits as through clicks; redo restores.
  await page.waitForTimeout(500);
  const undo = await page.evaluate(async () => {
    await EMAP.setTitle({ title: 'A title to undo' });
    await new Promise((r) => setTimeout(r, 600));
    const a = (await EMAP.undo()).title.title;
    const b = (await EMAP.redo()).title.title;
    await EMAP.setTitle({ title: 'Rabbit North Project' });
    await new Promise((r) => setTimeout(r, 600));
    return [a, b];
  });
  expect(undo).toEqual(['Rabbit North Project', 'A title to undo']);

  // PNG and SVG come back as data, nothing downloads.
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.evaluate(() => { window.__texts = []; });
  const png = await page.evaluate(async () => {
    const { data, clamped } = await EMAP.exportPNG({ as: 'dataUrl', band: false, pixelRatio: 1 });
    const img = new Image(); img.src = data; await img.decode();
    return { head: data.slice(0, 22), length: data.length, w: img.width, h: img.height, clamped };
  });
  expect(png.head).toBe('data:image/png;base64,');
  expect(png.length).toBeGreaterThan(200_000);
  expect(png.w).toBeGreaterThan(1000);
  const texts = await page.evaluate(() => window.__texts);
  for (const t of ['Rabbit North Project', 'SAMPLE RESOURCES · TSXV: SMP', 'Legend', 'NEW', 'Blue Sky · Holes 077 & 078', '134.0 m @ 0.65 g/t Au', 'COMMON DRILL PAD']) expect(texts, t).toContain(t);
  const glyphs = texts.join('');
  for (const t of ['DURAND STOCK', 'THUNDER TREND', 'BLUEBIRD THRUST', 'NICOLA GROUP']) expect(glyphs.replace(/\s/g, ''), t).toContain(t.replace(/\s/g, ''));

  const svg = await page.evaluate(async () => (await EMAP.exportSVG({ as: 'text', band: true, draft: true, bandClient: 'Sample Resources Ltd.' })).data);
  expect(svg.startsWith('<svg') || svg.startsWith('<?xml')).toBe(true);
  for (const id of ['em-studio-title', 'em-studio-scale', 'em-studio-inset', 'em-legend', 'em-fx-layers', 'em-fx-wash']) expect(svg, id).toContain(`id="${id}"`);
  expect(svg).toMatch(/<text class="em-fx-area-label"[^>]*>DURAND STOCK<\/text>/);
  expect(svg).toMatch(/<text class="em-fx-line-label"[^>]*>THUNDER TREND<\/text>/);
  for (const t of ['>Rabbit North Project<', '>TSXV: SMP<', '>NEW<', '>Blue Sky · Holes 077 &amp; 078<', 'DRAFT FOR REVIEW · NOT FOR PUBLICATION', 'Prepared for Sample Resources Ltd.']) expect(svg, t).toContain(t);
  expect(svg).toContain('id="em-draft-overlay"');
  const cleanSvg = await page.evaluate(async () => {
    await EMAP.setExport({ draft: true });
    return (await EMAP.exportSVG({ draft: false, band: false })).data;
  });
  expect(cleanSvg).not.toContain('id="em-draft-overlay"');
  expect(await page.evaluate(() => EMAP.getState().export.draft)).toBe(true);
  expect(downloads).toBe(0);
  keep('emap-tower-fig1.png', Buffer.from((await page.evaluate(async () => (await EMAP.exportPNG({ as: 'dataUrl', band: false, draft: false })).data)).split(',')[1], 'base64'));
  keep('emap-tower-fig1.svg', svg);

  // Duplicate, then save under a new name: no dialog, the editor works on the copy.
  const dup = await page.evaluate(async () => (await EMAP.duplicate()).map);
  expect(dup).toMatchObject({ name: 'Rabbit North Project (copy)', unsaved: false });
  expect(db.creates.at(-1).p_name).toBe('Rabbit North Project (copy)');
  const saved = await page.evaluate(async () => (await EMAP.saveAs('Rabbit North Fig 1')).map);
  expect(saved).toMatchObject({ name: 'Rabbit North Fig 1', unsaved: false });
  expect(db.creates.map((c) => c.p_name)).toEqual(['Rabbit North Project (copy)', 'Rabbit North Fig 1']);
  expect(db.creates.at(-1).p_payload.layers).toHaveLength(6);
  expect(db.creates.at(-1).p_payload.drillPlan.show.card).toBe(true);
  await expect(page.locator('.ed-doc-name')).toHaveText('Rabbit North Fig 1');
  await page.evaluate(() => EMAP.setFooter({ text: 'Fictional data for illustration only.' }));
  expect(await page.evaluate(() => EMAP.getState().map.unsaved)).toBe(true);
  await page.evaluate(() => EMAP.save());
  await expect.poll(() => db.updates.length).toBeGreaterThan(0);
  expect(db.updates.at(-1).p_payload.layout.footerText).toBe('Fictional data for illustration only.');
  // Leaving unsaved work needs discard; the projects list is the Open dialog's.
  await page.evaluate(() => EMAP.setFooter({ text: 'An unsaved edit' }));
  expect(await page.evaluate(() => EMAP.newMap().then(() => 'replaced', (e) => e.message))).toMatch(/unsaved changes: EMAP\.save\(\) first, or newMap/);
  expect((await page.evaluate(() => EMAP.listProjects())).map((p) => p.name)).toEqual(expect.arrayContaining(['Rabbit North Fig 1', 'Rabbit North Project (copy)']));
  expect(db.dialogs).toEqual([]);
});


test('EMAP rejects cloud save, copy and open failures even when the current map is clean', async ({ page }) => {
  const db = await fakeSupabase(page);
  await page.goto('/?intent=resume');
  await page.waitForFunction(() => window.EMAP);
  await page.evaluate(() => EMAP.ready());
  const original = await page.evaluate(() => EMAP.saveAs('Original'));
  await expect.poll(() => page.evaluate(() => EMAP.listProjects().length)).toBe(1);
  expect(original.map.unsaved).toBe(false);
  db.failCreates = true; db.failSaves = true; db.failLoads = true;
  for (const action of ['save', 'saveAs', 'duplicate', 'openProject']) {
    const result = await page.evaluate(async ([method, id]) => {
      try {
        const args = method === 'saveAs' ? ['Failed copy'] : method === 'openProject' ? [id] : [];
        await EMAP[method](...args);
        return { error: null, map: EMAP.getState().map };
      } catch (e) { return { error: e.message, map: EMAP.getState().map }; }
    }, [action, original.map.id]);
    expect.soft(result.error, action).toContain('failed');
    expect(result.map).toEqual(original.map);
  }
  expect(db.rows).toHaveLength(1);
  expect(db.dialogs).toEqual([]);
});

test('EMAP rejects full browser storage, then saves and copies successfully after storage recovers', async ({ page }) => {
  await fakeSupabase(page, { signedIn: false });
  await page.goto('/?intent=resume');
  await page.waitForFunction(() => window.EMAP);
  await page.evaluate(() => EMAP.ready());
  const original = await page.evaluate(() => EMAP.saveAs('Local original'));
  expect(original.map.signedIn).toBe(false);
  expect(original.map.unsaved).toBe(false);
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    window.__restoreStorage = () => { Storage.prototype.setItem = write; };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('mapviewer.projects.v1')) throw new DOMException('Browser storage is full', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  for (const action of ['save', 'saveAs', 'duplicate']) {
    const result = await page.evaluate(async (method) => {
      try { await EMAP[method](...(method === 'saveAs' ? ['Failed local copy'] : [])); return { error: null }; }
      catch (e) { return { error: e.message, map: EMAP.getState().map }; }
    }, action);
    expect.soft(result.error, action).toContain('failed');
    expect(result.map).toEqual(original.map);
  }
  await page.evaluate(() => window.__restoreStorage());
  const saved = await page.evaluate(() => EMAP.save());
  expect(saved.map.id).toBe(original.map.id);
  const copy = await page.evaluate(() => EMAP.duplicate());
  expect(copy.map.id).not.toBe(original.map.id);
  expect(copy.map.unsaved).toBe(false);
  const reopened = await page.evaluate((id) => EMAP.openProject(id), original.map.id);
  expect(reopened.map.id).toBe(original.map.id);
});

test('EMAP PNG dimensions preserve the composition and reject an incompatible height', async ({ page }) => {
  await fakeSupabase(page);
  await page.goto('/?intent=resume');
  await page.waitForFunction(() => window.EMAP);
  await page.evaluate(() => EMAP.ready());
  await page.evaluate(() => EMAP.setBasemap('blank'));
  const result = await page.evaluate(async () => {
    const size = async (options) => {
      const { data } = await EMAP.exportPNG({ as: 'blob', band: false, draft: false, ...options });
      const bitmap = await createImageBitmap(data);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    };
    const native = await size({ pixelRatio: 1 });
    const width = 800, height = Math.round(native.height * width / native.width);
    let error = null;
    try { await size({ width, height: height + 150 }); } catch (e) { error = e.message; }
    const actual = await size({ width, height });
    const overlapping = await Promise.allSettled([size({ width, height }), size({ width, height })]);
    return { expected: { width, height }, actual, error,
      overlapping: overlapping.map((r) => r.status === 'fulfilled' ? { size: r.value } : { error: r.reason.message }) };
  });
  expect(result.error).toContain('must preserve the current map');
  expect(result.error).toContain(`needs height ${result.expected.height}`);
  expect(result.actual).toEqual(result.expected);
  expect(result.overlapping).toEqual([{ size: result.expected }, { error: 'An export is already running: wait for it to finish.' }]);
});
