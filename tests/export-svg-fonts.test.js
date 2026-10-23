import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSceneToSvg, createExportContext } from '../src/export/renderScene.js';
import { exportSVG } from '../src/export/exportSVG.js';
import { getTemplate } from '../src/templates';
import { downloadBlob } from '../src/utils/svg';

vi.mock('../src/utils/svg', async (original) => ({ ...await original(), downloadBlob: vi.fn() }));

function scene() {
  document.body.innerHTML = '<div class="map-stage"><div class="leaflet-container"><div class="leaflet-tile-pane"></div></div></div>';
  const container = document.querySelector('.map-stage');
  container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500 });
  const layout = { basemap: 'blank', showTitle: false, showNorthArrow: false, showScaleBar: false, legendItems: [], fonts: { title: 'Inter' } };
  const project = { layout, layers: [], callouts: [], markers: [] };
  return { width: 800, height: 500, container, layout, project, layers: [], template: getTemplate('technical_results_v2'),
    map: { getSize: () => ({ x: 800, y: 500 }), latLngToContainerPoint: (ll) => ({ x: ll.lng, y: ll.lat }) } };
}
const options = { pixelRatio: 1, noWatermark: true };
const bytes = new Uint8Array([1, 2, 3, 4]);
let fetchMock;
beforeEach(() => {
  const ctx = { font: '10px sans', save() {}, restore() {}, measureText: () => ({ width: 12 }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  fetchMock = vi.fn(async (url) => {
    const u = new URL(url);
    if (u.hostname === 'fonts.googleapis.com') {
      const family = u.searchParams.get('family').split(':')[0];
      return { ok: true, text: async () => `/* latin */\n@font-face { font-family: '${family}'; font-weight: 300 800; src: url(https://fonts.gstatic.com/${encodeURIComponent(family)}.woff2) format('woff2'); }` };
    }
    return { ok: true, arrayBuffer: async () => bytes.buffer };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const fontQueries = () => fetchMock.mock.calls.map(([url]) => new URL(url)).filter((u) => u.hostname === 'fonts.googleapis.com').map((u) => u.searchParams.get('family'));
const blobText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blob);
});

describe('SVG branding font portability', () => {
  it('includes the band font in the actual downloaded SVG, even when the map only uses Inter', async () => {
    await exportSVG(scene(), { ...options, watermarkBand: { year: 2026 } });
    const svg = await blobText(downloadBlob.mock.calls[0][1]);
    expect(svg).toContain('id="em-watermark-band"');
    expect(svg).toContain("font-family: 'Source Sans 3'");
    expect(svg).toContain('data:font/woff2;base64,AQIDBA==');
    expect(svg).not.toContain('https://fonts.gstatic.com/');
    expect(fontQueries()).toEqual(['Inter:wght@400;500;600;700', 'Source Sans 3:wght@300..800']);
  });

  it('embeds the font for a draft-only export', async () => {
    await exportSVG(scene(), { ...options, draftOverlay: true });
    const svg = await blobText(downloadBlob.mock.calls[0][1]);
    expect(svg).toContain('DRAFT');
    expect(svg).not.toContain('id="em-watermark-band"');
    expect(svg).toContain("font-family: 'Source Sans 3'");
  });

  it('does not add branding fonts to unbranded exports or clean designer layers', async () => {
    const plain = await renderSceneToSvg(scene(), options);
    expect(fontQueries()).toEqual(['Inter:wght@400;500;600;700']);
    fetchMock.mockClear();
    const notes = await renderSceneToSvg(scene(), { ...options, layer: 'annotations', watermarkBand: {}, draftOverlay: true });
    expect(fontQueries()).toEqual(['Inter:wght@400;500;600;700']);
    expect(plain + notes).not.toContain('Source Sans 3');
  });

  it('honors the embedding opt-out without removing the branding', async () => {
    await exportSVG(scene(), { ...options, embedFonts: false, watermarkBand: {} });
    const svg = await blobText(downloadBlob.mock.calls[0][1]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(svg).toContain('id="em-watermark-band"');
    expect(svg).not.toContain('@font-face');
  });

  it('fetches a shared map and band font once with all required weights', async () => {
    const s = scene(); s.project.layout.fonts.title = 'Source Sans 3';
    await renderSceneToSvg(s, { ...options, watermarkBand: {}, draftOverlay: true });
    expect(fontQueries().filter((q) => q.startsWith('Source Sans 3'))).toEqual(['Source Sans 3:wght@300..800']);
  });

  it('uses the band font override without adding the default family unnecessarily', async () => {
    await renderSceneToSvg(scene(), { ...options, watermarkBand: { font: '"Montserrat", Arial, sans-serif' } });
    expect(fontQueries()).toEqual(['Inter:wght@400;500;600;700', 'Montserrat:wght@300..800']);
  });

  it('still downloads the branded SVG and records a warning if the font file fails', async () => {
    const fetchFont = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url) => String(url).includes('gstatic.com/Source') ? Promise.resolve({ ok: false, status: 503 }) : fetchFont(url));
    const exportContext = createExportContext();
    await exportSVG(scene(), { ...options, watermarkBand: {}, exportContext });
    expect(await blobText(downloadBlob.mock.calls[0][1])).toContain('id="em-watermark-band"');
    expect(exportContext.diagnostics).toEqual([expect.objectContaining({ code: 'font-not-embedded', message: expect.stringContaining('Source Sans 3') })]);
  });
});
