import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runPreflight, textScale, isBlankImage, disclosureFacts } from '../src/export/preflight.js';
import { renderSceneToSvg, createExportContext, getExportWarnings, ensureExportFonts } from '../src/export/renderScene.js';
import { getTemplate } from '../src/templates';

// The publication check (ticket F3, part 1): diagnostics before a 2D download,
// from the same stage, placement and legend layout the export draws.

const W = 800, H = 500;
function rect(el, { x, y, w, h }) {
  el.getBoundingClientRect = () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y });
}
// x = lng, y = lat: container px straight from the coordinates.
const map = {
  latLngToContainerPoint: (ll) => { const [lat, lng] = Array.isArray(ll) ? ll : [ll.lat, ll.lng]; return { x: lng, y: lat }; },
  getSize: () => ({ x: W, y: H }),
};
function stage(tileHrefs = []) {
  document.body.innerHTML = '<div class="map-stage"><div class="leaflet-container"><div class="leaflet-tile-pane"></div></div></div>';
  const el = document.querySelector('.map-stage');
  rect(el, { x: 0, y: 0, w: W, h: H });
  const pane = el.querySelector('.leaflet-tile-pane');
  tileHrefs.forEach((href, i) => {
    const img = document.createElement('img');
    img.className = 'leaflet-tile';
    img.src = href;
    pane.append(img);
    rect(img, { x: i * 256, y: 0, w: 256, h: 256 });
  });
  return el;
}
function scene({ layout = {}, callouts = [], markers = [], layers = [], tiles = [] } = {}) {
  const project = { layers, callouts, markers, layout: { showTitle: false, showNorthArrow: false, showScaleBar: false, legendItems: [], ...layout } };
  return { width: W, height: H, layers, layout: project.layout, map, container: stage(tiles), project, template: getTemplate('technical_results_v2') };
}
// Tiles named bad-* fail, slow-* never answer; everything else loads.
const loadImage = (href) => (String(href).includes('bad-') ? Promise.reject(new Error('404'))
  : String(href).includes('slow-') ? new Promise(() => {}) : Promise.resolve({}));
const codes = (list) => list.map((d) => d.code);

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); delete document.fonts; });

describe('runPreflight', () => {
  it('finds nothing on an empty blank-basemap figure', async () => {
    expect(await runPreflight(scene({ layout: { basemap: 'blank' } }), { loadImage })).toEqual([]);
  });

  it('reports a missing imagery tile, with where it is', async () => {
    const list = await runPreflight(scene({ tiles: ['https://tiles.example/1.png', 'https://tiles.example/bad-2.png'] }), { loadImage });
    const d = list.find((x) => x.code === 'imagery-tile-failed');
    expect(d).toMatchObject({ severity: 'warning', bounds: { left: 256, top: 0, width: 256, height: 256 } });
    expect(d.message).toMatch(/1 of 2 imagery tiles failed to load/);
  });

  it('reports a tile that answered 200 with a transparent placeholder', async () => {
    // A tiny canvas that reads back what was drawn: all-zero pixels for the
    // blank tile, opaque for the rest.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      let drawn = null;
      return { drawImage: (img) => { drawn = img; }, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(drawn?.blank ? 0 : 255) }) };
    });
    const load = (href) => Promise.resolve({ blank: String(href).includes('empty-') });
    const list = await runPreflight(scene({ tiles: ['https://tiles.example/1.png', 'https://tiles.example/empty-2.png'] }), { loadImage: load });
    expect(list.find((x) => x.code === 'imagery-tile-failed')).toMatchObject({ bounds: { left: 256, width: 256 } });
    expect(list.find((x) => x.code === 'imagery-tile-failed').message).toMatch(/1 of 2 imagery tiles failed to load or are empty/);
  });

  it('treats a tile it cannot inspect as healthy', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage() {}, getImageData() { throw new DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError'); },
    });
    expect(isBlankImage({})).toBe(false);
  });

  it('reports a basemap with no tiles, and fully transparent imagery', async () => {
    expect(codes(await runPreflight(scene(), { loadImage }))).toContain('imagery-missing');
    const s = scene({ tiles: ['https://tiles.example/1.png'] });
    s.container.querySelector('.leaflet-tile-pane').style.opacity = '0';
    expect(codes(await runPreflight(s, { loadImage }))).toContain('imagery-invisible');
  });

  it('does not hang on imagery or fonts that never arrive', async () => {
    document.fonts = { load: () => new Promise(() => {}), ready: new Promise(() => {}), check: () => false };
    const started = Date.now();
    const list = await runPreflight(scene({ tiles: ['https://tiles.example/slow-1.png'], layout: { fonts: { title: 'Montserrat' } } }), { loadImage, timeoutMs: 60 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(codes(list)).toEqual(expect.arrayContaining(['imagery-timeout', 'font-timeout']));
    expect(list.find((d) => d.code === 'font-timeout').message).toMatch(/Montserrat/);
  });

  it('reports a result label clipped at the frame edge', async () => {
    // Eight one-line results under the headline: the card grows past the
    // estimate the placement clamped to the frame, so its foot is cut off.
    const subtext = Array.from({ length: 8 }, (_, i) => `incl. ${i + 1}.0 m @ 2 g/t`).join('\n');
    const callout = { id: 'r1', type: 'boxed', text: 'DDH-07 12 m @ 3 g/t', subtext, anchor: { lat: 490, lng: 400 }, offset: { x: 0, y: 0 }, boxWidth: 188, style: { fontSize: 12, paddingX: 10, paddingY: 8 } };
    const list = await runPreflight(scene({ layout: { basemap: 'blank' }, callouts: [callout] }), { loadImage });
    const d = list.find((x) => x.code === 'label-clipped');
    expect(d).toMatchObject({ elementId: 'r1', severity: 'warning' });
    expect(d.bounds.top + d.bounds.height).toBeGreaterThan(H);
    // A small label is a different finding from bad geometry.
    expect(codes(list)).not.toContain('interval-geometry-invalid');
  });

  it('keeps invalid interval geometry apart from text size', async () => {
    const list = await runPreflight(scene({ layout: { basemap: 'blank' }, callouts: [
      { id: 'a', text: 'No anchor', anchor: null },
      { id: 'b', text: 'Backwards', anchor: { lat: 100, lng: 100 }, fromM: 40, toM: 12, style: { fontSize: 5 } },
    ] }), { loadImage });
    const bad = list.filter((d) => d.code === 'interval-geometry-invalid');
    expect(bad.map((d) => d.elementId).sort()).toEqual(['a', 'b']);
    expect(bad.every((d) => d.severity === 'error')).toBe(true);
    expect(list[0].severity).toBe('error');
    expect(list.find((d) => d.code === 'text-too-small')).toMatchObject({ elementId: 'b', severity: 'warning' });
  });

  it('flags text outside its card and labels cut off by the frame', async () => {
    const list = await runPreflight(scene({ layout: { basemap: 'blank' },
      callouts: [{ id: 'w', type: 'boxed', text: 'Supercalifragilisticexpialidocious-zone-north', anchor: { lat: 200, lng: 200 }, boxWidth: 100 }],
      markers: [{ id: 'm', type: 'circle', lat: 250, lng: 790, label: 'Camp' }] }), { loadImage });
    expect(list.find((d) => d.code === 'text-outside-card')).toMatchObject({ elementId: 'w' });
    expect(list.find((d) => d.code === 'label-clipped')).toMatchObject({ elementId: 'm' });
  });

  it('reports truncated legends, layers missing from the legend, and missing assets', async () => {
    const layer = { id: 'L1', name: 'Soil samples', visible: true, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }] } };
    const legendItems = Array.from({ length: 40 }, (_, i) => ({ id: `row${i}`, label: `Row ${i}`, type: 'polygons', style: {} }));
    const list = await runPreflight(scene({ layers: [layer], layout: { basemap: 'blank', legendItems, logo: 'https://cdn.example/bad-logo.png' } }), { loadImage });
    expect(codes(list)).toEqual(expect.arrayContaining(['legend-truncated', 'legend-row-missing', 'asset-missing']));
    expect(list.find((d) => d.code === 'legend-row-missing')).toMatchObject({ elementId: 'L1' });
    expect(list.find((d) => d.code === 'asset-missing')).toMatchObject({ elementId: 'logo' });
  });

  it('checks a rotated map label against the frame by its turned box', async () => {
    // 200 px of text, turned 90°, centred 60 px above the bottom edge: level it
    // fits; standing upright its lower half runs off the frame.
    const measure = { font: '', measureText: () => ({ width: 200 }) };
    const label = { id: 'ml', type: 'maplabel', lat: 440, lng: 400, label: 'Ridge', size: 20 };
    const level = await runPreflight(scene({ layout: { basemap: 'blank' }, markers: [label] }), { loadImage, measure });
    expect(codes(level)).not.toContain('label-clipped');
    const turned = await runPreflight(scene({ layout: { basemap: 'blank' }, markers: [{ ...label, rotation: 90 }] }), { loadImage, measure });
    const d = turned.find((x) => x.code === 'label-clipped');
    expect(d).toMatchObject({ elementId: 'ml' });
    expect(d.bounds.height).toBeCloseTo(200);
  });

  it('includes the title block and the technical title strip in the text-size check', async () => {
    // titleFontScale 0.6 sets a 10 px date line at 6 px.
    const small = await runPreflight(scene({ layout: { basemap: 'blank', showTitle: true, title: 'Cedar', mapDate: 'Oct 2026', titleFontScale: 0.6 } }), { loadImage });
    expect(small.find((d) => d.code === 'text-too-small')).toMatchObject({ elementId: 'title' });
    expect(small.find((d) => d.code === 'text-too-small').message).toMatch(/^Title meta text shows at 6 px/);
    expect(codes(await runPreflight(scene({ layout: { basemap: 'blank', showTitle: true, title: 'Cedar', mapDate: 'Oct 2026' } }), { loadImage }))).not.toContain('text-too-small');
    const strip = scene({ layout: { basemap: 'blank', templateId: 'ni_43101_technical', stripFontScale: 0.7 } });
    strip.template = getTemplate('ni_43101_technical');
    expect((await runPreflight(strip, { loadImage })).find((d) => d.code === 'text-too-small').message).toMatch(/^Title strip label text shows at 5.6 px/);
  });

  it('measures print text in points at the page size, slides at slide size', () => {
    const s = scene();
    expect(textScale(s, { format: 'pdf', pdfSize: 'news_release' })).toMatchObject({ medium: 'print', unit: 'pt' });
       // 800 px across a 6 in page: 0.54 pt per px, so 10 px text is 5.4 pt.
    expect(textScale(s, { format: 'pdf', pdfSize: 'news_release' }).perPx).toBeCloseTo((6 * 72) / 800);
    s.project.layout.exportRatio = 'landscape';
    expect(textScale(s, { format: 'png' })).toMatchObject({ medium: 'slide', unit: 'pt' });
    s.project.layout.exportRatio = null;
    expect(textScale(s, { format: 'png' })).toMatchObject({ medium: 'screen', unit: 'px', perPx: 1 });
  });

  it('flags 10 px callout text on a news-release page but not on screen', async () => {
    const s = scene({ layout: { basemap: 'blank' }, callouts: [{ id: 'c', type: 'boxed', text: 'Hole 1', anchor: { lat: 100, lng: 100 }, style: { fontSize: 10 } }] });
    const print = await runPreflight(s, { loadImage, format: 'pdf', pdfSize: 'news_release' });
    expect(print.find((d) => d.code === 'text-too-small').message).toMatch(/pt on a News Release Figure page/);
    expect(codes(await runPreflight(s, { loadImage, format: 'png' }))).not.toContain('text-too-small');
  });
});

describe('export context', () => {
  // Each family's embed fails or succeeds on its own schedule, so two exports
  // in flight interleave their font fetches.
  function fontFetch() {
    return vi.fn(async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('Montserrat')) { await new Promise((r) => setTimeout(r, 30)); return { ok: false, status: 500 }; }
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, text: async () => '' };
    });
  }

  it('keeps concurrent exports’ warnings apart', async () => {
    globalThis.fetch = fontFetch();
    const a = scene({ layout: { basemap: 'blank', fonts: { title: 'Montserrat' } } });
    const b = scene({ layout: { basemap: 'blank', fonts: { title: 'Lato' } } });
    const ca = createExportContext(), cb = createExportContext();
    await Promise.all([renderSceneToSvg(a, { pixelRatio: 1, exportContext: ca }), renderSceneToSvg(b, { pixelRatio: 1, exportContext: cb })]);
    expect(ca.warnings).toEqual(['font Montserrat could not be embedded in the SVG — viewers without it installed will substitute another font']);
    expect(ca.diagnostics).toMatchObject([{ code: 'font-not-embedded', severity: 'warning' }]);
    expect(cb.warnings).toEqual([]);
    // The compatibility wrapper reads the export started last.
    expect(getExportWarnings()).toBe(cb.warnings);
    // The scene passed in is not given a context of its own.
    expect(a.exportContext).toBeUndefined();
  });

  it('a render started later (a thumbnail) does not take over an export’s warnings', async () => {
    globalThis.fetch = fontFetch();
    const download = createExportContext();
    const first = renderSceneToSvg(scene({ layout: { basemap: 'blank', fonts: { title: 'Montserrat' } } }), { pixelRatio: 1, exportContext: download });
    // The thumbnail starts after the download and passes no context.
    const thumb = renderSceneToSvg(scene({ layout: { basemap: 'blank', fonts: { title: 'Lato' } } }), { pixelRatio: 1 });
    await Promise.all([first, thumb]);
    expect(download.warnings).toEqual(['font Montserrat could not be embedded in the SVG — viewers without it installed will substitute another font']);
    // The wrapper now reads the thumbnail's; the export reads its own context.
    expect(getExportWarnings()).toEqual([]);
  });

  it('keeps concurrent preflights apart', async () => {
    const [x, y] = await Promise.all([
      runPreflight(scene({ tiles: ['https://tiles.example/bad-1.png'] }), { loadImage }),
      runPreflight(scene({ layout: { basemap: 'blank' } }), { loadImage }),
    ]);
    expect(codes(x)).toContain('imagery-tile-failed');
    expect(y).toEqual([]);
  });

  it('font waits are bounded and say what had not loaded', async () => {
    document.fonts = { load: () => new Promise(() => {}), ready: new Promise(() => {}), check: (f) => !f.includes('Lato') };
    const ctx = createExportContext();
    const res = await ensureExportFonts({ project: { layout: { fonts: { title: 'Lato' } } }, exportContext: ctx }, 20);
    expect(res).toEqual({ timedOut: true, missing: ['Lato'] });
    expect(ctx.diagnostics[0]).toMatchObject({ code: 'font-timeout' });
    expect(ctx.warnings).toEqual([]);
  });

  it('checks disclosure defaults only for a figure with a standard, from what it draws', async () => {
    expect(codes(await runPreflight(scene({ layout: { basemap: 'blank' } }), { loadImage })).filter((c) => c.startsWith('disclosure-'))).toEqual([]);
    const pending = { id: 'h', name: 'Holes', visible: true, geojson: { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 1, properties: { hole: 'DDH-4', assay_status: 'Pending' }, geometry: { type: 'Point', coordinates: [100, 100] } }] } };
    const s = scene({ layout: { basemap: 'blank', disclosureStandard: 'ni43101' }, layers: [pending], callouts: [{ id: 'r', resultId: 'R1', text: 'DDH-4 12 m @ 3 g/t', anchor: { lat: 100, lng: 100 } }] });
    const list = (await runPreflight(s, { loadImage })).filter((d) => d.code.startsWith('disclosure-'));
    expect(codes(list).sort()).toEqual(['disclosure-crs', 'disclosure-north-arrow', 'disclosure-pending', 'disclosure-scale-bar', 'disclosure-sources', 'disclosure-true-width']);
    expect(list.find((d) => d.code === 'disclosure-scale-bar').fix).toEqual({ label: 'Add scale bar', layout: { showScaleBar: true } });
    // A claim's "Pending" status is not a pending assay; the projection label under a scale bar states the CRS.
    const claims = { ...pending, geojson: { type: 'FeatureCollection', features: [{ ...pending.geojson.features[0], properties: { status: 'PENDING' } }] } };
    const f = disclosureFacts(scene({ layout: { showScaleBar: true, showProjectionLabel: true, projectionName: 'NAD83 / UTM 10N', footerText: 'Source: MTO' }, layers: [claims] }));
    expect(f).toMatchObject({ scaleBar: true, crs: 'NAD83 / UTM 10N', pending: false, intercepts: false, historical: false });
    expect(f.texts).toContain('Source: MTO');
  });
});
