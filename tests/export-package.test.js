import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderSceneToSvg } from '../src/export/renderScene.js';
import { bandHeight, watermarkBandSvg, withWatermarkBandSvg, BAND_STATUS } from '../src/export/watermarkBand.js';
import { figureFileName, packageFileName, namePart, todayStamp } from '../src/utils/packageNames.js';
import { getTemplate } from '../src/templates';

// Tower v3 items 38, 40 and 42 in 2D: the watermark band in the SVG export, the package's file names, and the
// clean layers (map alone, annotations alone).

// A 2D context for measuring: text is 0.5 em a character wide.
function measurer() {
  const t = { font: '10px sans', letterSpacing: '0px', save() {}, restore() {} };
  t.measureText = (s) => ({ width: String(s).length * parseFloat(/([\d.]+)px/.exec(t.font)[1]) * 0.5 });
  return t;
}

describe('the watermark band as SVG', () => {
  it('holds the wordmark, the status and the note as live text inside the band', () => {
    const svg = watermarkBandSvg(0, 1000, 1760, { client: 'Tower Resources Ltd. · TSXV: TWR', year: 2026, ctx: measurer() });
    expect(svg).toContain('<tspan font-weight="300">Exploration</tspan>');
    expect(svg).toContain('<tspan dx="9" font-weight="700">Maps</tspan>'); // after "Exploration" in the text flow
    expect(svg).toContain(`font-weight="800" fill="#142126" letter-spacing="1.8">${BAND_STATUS}</text>`);
    expect(svg).toContain('Prepared for Tower Resources Ltd. by Exploration Maps. Not licensed for use or redistribution without written permission. © 2026 Exploration Maps');
    expect(svg).toContain('fill="#fcfbf7"'); // cream
    expect(svg).toContain('fill="#C65322"'); // the orange square
    const ys = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"/g)].map((m) => +m[1]);
    expect(ys.length).toBe(4);
    ys.forEach((y) => { expect(y).toBeGreaterThan(1000); expect(y).toBeLessThan(1000 + bandHeight(1760)); });
  });

  it('grows an exported SVG by the band, the figure untouched above it', () => {
    const doc = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="880" height="500" viewBox="0 0 880 500"><rect width="100%" height="100%" fill="#fff" /><g id="em-map-content"></g></svg>';
    const out = withWatermarkBandSvg(doc, { client: 'Star Copper', year: 2026, ctx: measurer() });
    expect(out).toMatch(/<svg [^>]*width="880" height="555" viewBox="0 0 880 555">/);
    expect(out).toContain('<rect width="100%" height="100%" fill="#fff" /><g id="em-map-content"></g><g id="em-watermark-band"><rect x="0" y="500" width="880" height="55" fill="#fcfbf7"/>');
    expect(out.endsWith('</g></svg>')).toBe(true);
    expect(withWatermarkBandSvg('not an svg')).toBe('not an svg');
  });
});

describe('package file names', () => {
  const meta = { client: 'Tower Resources Ltd.', project: 'Blue Sky', date: '2026-10-15', version: '3' };
  it('are Client_Project_Date_FigN_Name_vX.png', () => {
    expect(figureFileName(meta, 1, 'Geology & gold trends')).toBe('Tower-Resources-Ltd_Blue-Sky_2026-10-15_Fig1_Geology-gold-trends_v3.png');
    expect(figureFileName({ ...meta, version: 'v4' }, 2, 'Drill plan 077/078')).toBe('Tower-Resources-Ltd_Blue-Sky_2026-10-15_Fig2_Drill-plan-077-078_v4.png');
    expect(packageFileName(meta, 'pdf')).toBe('Tower-Resources-Ltd_Blue-Sky_2026-10-15_Package_v3.pdf');
    expect(packageFileName(meta, 'zip')).toBe('Tower-Resources-Ltd_Blue-Sky_2026-10-15_Package_v3.zip');
  });
  it('drop empty parts and accents, and default the version to 1', () => {
    expect(figureFileName({ date: '2026-10-22' }, 3, 'Coupe A–A′ Hercule')).toBe('2026-10-22_Fig3_Coupe-A-A-Hercule_v1.png');
    expect(namePart('  Ãrea  norte!! ')).toBe('Area-norte');
    expect(todayStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

// The scene fixture of export-preflight.test.js: container px straight from the coordinates.
const W = 800, H = 500;
const map = { latLngToContainerPoint: (ll) => ({ x: ll.lng, y: ll.lat }), getSize: () => ({ x: W, y: H }) };
function scene() {
  document.body.innerHTML = '<div class="map-stage"><div class="leaflet-container"><div class="leaflet-tile-pane"></div></div></div>';
  const el = document.querySelector('.map-stage');
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0 });
  const layers = [{ id: 'claims', name: 'Claims', type: 'polygons', role: 'claims', visible: true, style: { fill: '#c65322', stroke: '#c65322', strokeWidth: 2, fillOpacity: 0.3 },
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[100, 100], [300, 100], [300, 300], [100, 100]]] } }] } }];
  const layout = { basemap: 'blank', blankBg: '#f0f0f0', showTitle: true, title: 'Star Copper', showNorthArrow: false, showScaleBar: false, legendItems: [] };
  const project = { layers, callouts: [], markers: [{ id: 'm', type: 'circle', lat: 200, lng: 200, label: 'Target A', color: '#d97706', size: 18 }], layout };
  return { width: W, height: H, layers, layout, map, container: el, project, template: getTemplate('technical_results_v2') };
}

describe('the clean layers', () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('the annotations SVG keeps the text and drops the basemap, the data and the corner credit', async () => {
    const full = await renderSceneToSvg(scene(), { pixelRatio: 1, embedFonts: false, noWatermark: true });
    const notes = await renderSceneToSvg(scene(), { pixelRatio: 1, embedFonts: false, noWatermark: true, layer: 'annotations' });
    expect(full).toContain('fill="#f0f0f0"'); // the blank basemap's page
    expect(full).toContain('#c65322'); // the claims
    expect(full).toContain('>explorationmaps.com</text>');
    expect(notes).not.toContain('fill="#f0f0f0"');
    expect(notes).not.toContain('#c65322');
    expect(notes).not.toContain('>explorationmaps.com</text>');
    expect(notes).toContain('>Star Copper</text>'); // the title, as text
    expect(notes).toContain('Target A');
  });
});

describe('exportLayers', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../src/export/renderScene'); vi.doUnmock('../src/export/exportPNG'); });

  it('zips the figure, the map alone and the annotations alone (and their SVG when asked)', async () => {
    const calls = [];
    const canvas = (tag) => ({ width: 1600, height: tag === 'figure' ? 1700 : 1000, toBlob: (cb) => cb(new Blob([tag])) });
    vi.doMock('../src/export/renderScene', () => ({
      renderSceneToCanvas: async (s, o) => { calls.push(['canvas', o.layer, o.background]); return canvas(o.layer); },
      renderSceneToSvg: async (s, o) => { calls.push(['svg', o.layer]); return '<svg>notes</svg>'; },
    }));
    vi.doMock('../src/export/exportPNG', () => ({ figureCanvas: async (s, o) => { calls.push(['figure', o.watermarkBand?.client]); return canvas('figure'); } }));
    const { layerFiles } = await import('../src/export/exportLayers.js');
    const files = await layerFiles({}, { pixelRatio: 2, watermarkBand: { client: 'Star' }, svg: true });
    expect(Object.keys(files)).toEqual(['figure.png', 'map.png', 'annotations.png', 'annotations.svg', 'layers.json']);
    expect(calls).toEqual([['figure', 'Star'], ['canvas', 'map', undefined], ['canvas', 'annotations', 'transparent'], ['svg', 'annotations']]);
    expect(new TextDecoder().decode(files['map.png'])).toBe('map');
    const about = JSON.parse(new TextDecoder().decode(files['layers.json']));
    expect(about).toMatchObject({ width: 1600, height: 1000, files: ['figure.png', 'map.png', 'annotations.png', 'annotations.svg'] });
    expect(about.watermarkBand).toMatch(/under figure\.png only/);
    const plain = await layerFiles({}, {});
    expect(Object.keys(plain)).toEqual(['figure.png', 'map.png', 'annotations.png', 'layers.json']);
  });
});
