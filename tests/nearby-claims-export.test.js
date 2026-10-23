import { describe, it, expect } from 'vitest';
import { layersWithNearbyClaims, nearbyClaimsLegendItems } from '../src/utils/nearbyClaims.js';
import { onWhite } from '../src/export/exportPDF.js';

// What every 2D export path (the editor's export and share, the dashboard's package) draws for a map's nearby
// claims (project.areaClaims), and the PDF page's white backing for a transparent figure.

const square = (x, y) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });
const claims = (over = {}) => ({
  visible: true, showInLegend: true, dissolve: false, fillOpacity: 0.3, ownerField: 'OWNER',
  ownerColors: { Rival: '#7c3aed', Hidden: '#16a34a' }, ownerLabels: { Rival: 'Rival Metals Corp.' }, hiddenOwners: ['Hidden'],
  features: [
    { type: 'Feature', properties: { OWNER: 'Rival' }, geometry: square(0, 0) },
    { type: 'Feature', properties: { OWNER: 'Rival' }, geometry: square(1, 0) },
    { type: 'Feature', properties: { OWNER: 'Hidden' }, geometry: square(5, 5) },
    { type: 'Feature', properties: {}, geometry: square(9, 9) },
  ],
  ...over,
});
const own = { id: 'claims', name: 'Claims', type: 'polygons', visible: true, geojson: { type: 'FeatureCollection', features: [] } };

describe('nearby claims in an export', () => {
  it('adds one layer per shown owner after the map\'s own layers, styled and labelled as the editor shows them', () => {
    const layers = layersWithNearbyClaims({ layers: [own], areaClaims: claims() });
    expect(layers[0]).toBe(own);
    expect(layers.slice(1).map((l) => [l.id, l.name, l.geojson.features.length])).toEqual([['__ac_Rival', 'Rival Metals Corp.', 2], ['__ac_Unknown', 'Unknown', 1]]);
    expect(layers[1]).toMatchObject({ type: 'polygons', role: 'other', visible: true, claimInfo: true, legend: { enabled: true, label: 'Rival Metals Corp.' },
      style: { fill: '#7c3aed', fillOpacity: 0.3, stroke: '#7c3aed', strokeWidth: 1, layerOpacity: 1 } });
    expect(layers[2].style.fill).toBe('#888888'); // an owner without a colour
  });

  it('merges an owner\'s claims into one outline when dissolve is on', () => {
    const [, rival] = layersWithNearbyClaims({ layers: [own], areaClaims: claims({ dissolve: true }) });
    expect(rival.geojson.features).toHaveLength(1);
    expect(rival.style.strokeWidth).toBe(1.5);
  });

  it('leaves the layers alone when the nearby claims are hidden or empty', () => {
    const layers = [own];
    expect(layersWithNearbyClaims({ layers, areaClaims: claims({ visible: false }) })).toBe(layers);
    expect(layersWithNearbyClaims({ layers, areaClaims: claims({ features: [] }) })).toBe(layers);
    expect(layersWithNearbyClaims({ layers })).toBe(layers);
  });

  it('lists a legend row per shown owner under "Nearby Claims" when they are in the legend', () => {
    expect(nearbyClaimsLegendItems(claims())).toEqual([{ id: '__ac_Rival', role: 'other', group: 'Nearby Claims', label: 'Rival Metals Corp.', type: 'polygons',
      style: { fill: '#7c3aed', fillOpacity: 0.3, stroke: '#7c3aed', strokeWidth: 1 } }]);
    expect(nearbyClaimsLegendItems(claims({ showInLegend: false }))).toEqual([]);
    expect(nearbyClaimsLegendItems(null)).toEqual([]);
  });
});

describe('a PDF page on white', () => {
  it('fills the page white, then draws the figure over it at its own size, leaving the figure untouched', () => {
    const calls = [];
    const ctx = { set fillStyle(v) { calls.push(['fillStyle', v]); }, fillRect: (...a) => calls.push(['fillRect', ...a]), drawImage: (c, x, y) => calls.push(['drawImage', c, x, y]) };
    const doc = { createElement: (t) => (t === 'canvas' ? { getContext: () => ctx } : null) };
    const figure = { width: 640, height: 480 };
    const out = onWhite(figure, doc);
    expect([out.width, out.height]).toEqual([640, 480]);
    expect(calls).toEqual([['fillStyle', '#ffffff'], ['fillRect', 0, 0, 640, 480], ['drawImage', figure, 0, 0]]);
    expect(figure).toEqual({ width: 640, height: 480 });
  });
});
