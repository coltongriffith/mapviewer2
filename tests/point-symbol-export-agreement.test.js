import { describe, it, expect } from 'vitest';
import { resolvePointSymbol, symbolPath, symbolSvg, DEFAULT_POINT_SIZE } from '../src/utils/pointSymbol.js';
import { getFeatureStyle, scalePointSizes, withoutFeatureSizes, sizedFeatureCount } from '../src/utils/featureStyle.js';
import { buildCategorical, buildGraduated, withClassSizes, withoutClassSizes, hasClassSizes } from '../src/utils/classification.js';
import { resolveCalloutBoxes, panelObstacles } from '../src/utils/calloutLayout.js';
import { inferRoleFromLayer, applyRoleToLayer, NEUTRAL_ROLES } from '../shared/mapPresets.js';
import { exportFooterBox } from '../src/export/renderScene.js';
import { technicalResultsTemplate } from '../src/templates/technicalResultsTemplate.js';

const pt = (id, props, x = -120, y = 50) => ({ type: 'Feature', id, properties: props, geometry: { type: 'Point', coordinates: [x, y] } });
const ravenLayer = (extra = {}) => ({
  id: 'raven', type: 'points', role: 'rock_samples',
  style: { markerSize: 13, markerColor: '#111111', markerFill: '#ffffff' },
  geojson: { type: 'FeatureCollection', features: [
    pt('a', { Au: 0.02, Class: 'Green' }), pt('b', { Au: 1.4, Class: 'Red' }), pt('c', { Au: 12, Class: 'Red' }),
    pt('d', { Class: 'Green' }), // missing assay
    pt('e', {}), // missing every attribute
  ] },
  ...extra,
});
const sizeOf = (layer, id) => resolvePointSymbol(getFeatureStyle(technicalResultsTemplate, layer, layer.geojson.features.find((f) => f.id === id), id)).size;

describe('point size precedence (feature > class > layer)', () => {
  it('unclassified: the layer size is the drawn size, unclamped', () => {
    for (const s of [2, 8, 13, 24]) expect(sizeOf(ravenLayer({ style: { markerSize: s } }), 'a')).toBe(s);
    expect(resolvePointSymbol({}).size).toBe(DEFAULT_POINT_SIZE);
  });

  it('13 → 24 on a classified layer changes every point (colour classes carry no size)', () => {
    for (const cls of [buildCategorical(ravenLayer(), 'Class'), buildGraduated(ravenLayer(), 'Au', 3)]) {
      expect(hasClassSizes(cls)).toBe(false);
      const layer = ravenLayer({ classification: cls, style: { markerSize: 24 } });
      for (const id of ['a', 'b', 'c', 'd', 'e']) expect(sizeOf(layer, id)).toBe(24);
    }
  });

  it('a class size of 2 → 8 is drawn at exactly 2 then 8 (no editor-only minimum)', () => {
    const cls = withClassSizes(buildCategorical(ravenLayer(), 'Class'), 13);
    const green = cls.classes.findIndex((c) => c.value === 'Green');
    const at = (size) => ({ ...cls, classes: cls.classes.map((c, i) => (i === green ? { ...c, size } : c)) });
    expect(sizeOf(ravenLayer({ classification: at(2) }), 'a')).toBe(2);
    expect(sizeOf(ravenLayer({ classification: at(8) }), 'a')).toBe(8);
    expect(sizeOf(ravenLayer({ classification: at(8) }), 'b')).toBe(13);
  });

  it('a feature override beats its class; removing sizes keeps colours', () => {
    const cls = withClassSizes(buildCategorical(ravenLayer(), 'Class'), 10);
    const layer = ravenLayer({ classification: cls, featureOverrides: { b: { markerSize: 30, fill: '#ff0000' } } });
    expect(sizeOf(layer, 'b')).toBe(30);
    expect(sizedFeatureCount(layer)).toBe(1);
    expect(withoutFeatureSizes(layer.featureOverrides)).toEqual({ b: { fill: '#ff0000' } });
    expect(withoutClassSizes(cls).classes.map((c) => c.color)).toEqual(cls.classes.map((c) => c.color));
  });

  it('scale all points keeps relative differences at every level', () => {
    const cls = withClassSizes(buildGraduated(ravenLayer(), 'Au', 3), 10);
    const layer = ravenLayer({ style: { markerSize: 10 }, classification: cls, featureOverrides: { c: { markerSize: 30 } } });
    const patch = scalePointSizes(layer, 1.5);
    expect(patch.style.markerSize).toBe(15);
    expect(patch.classification.classes.map((c) => c.size)).toEqual(cls.classes.map((c) => Math.round(c.size * 15) / 10));
    expect(patch.featureOverrides.c.markerSize).toBe(45);
  });
});

describe('one symbol geometry for every renderer', () => {
  const SHAPES = ['circle', 'star', 'square', 'diamond', 'triangle', 'triangle_down', 'cross', 'drillhole', 'hexagon', 'pin'];
  const coords = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);

  it.each(SHAPES)('%s fits the size-diameter box', (shape) => {
    const d = symbolPath(shape, 50, 50, 6);
    expect(d).toMatch(/^M/);
    // Every coordinate (arc radii and flags are the small numbers) stays
    // within the 12 px box around (50, 50).
    for (const n of coords(d).filter((v) => v > 20)) expect(Math.abs(n - 50)).toBeLessThanOrEqual(6.01);
  });

  it('the editor icon scales with the export scale and pads for the stroke', () => {
    const sym = resolvePointSymbol({ markerSize: 8, markerShape: 'star', strokeWidth: 2 });
    expect(symbolSvg(sym, 1).box).toBe(12);
    expect(symbolSvg(sym, 3).box).toBe(32);
  });
});

describe('callouts avoid panels, identically in editor and export', () => {
  const map = { getSize: () => ({ x: 1000, y: 700 }), latLngToContainerPoint: ([lat, lng]) => ({ x: lng, y: lat }) };
  const legend = { key: 'legend', left: 0, top: 400, width: 300, height: 300 };
  const callout = (id, x, y, extra = {}) => ({ id, text: id, anchor: { lat: y, lng: x }, offset: { x: 0, y: 0 }, ...extra });

  it('moves an automatic card off the legend without moving its anchor', () => {
    const [c] = resolveCalloutBoxes([callout('A', 100, 500)], map, { obstacles: [legend] });
    expect(c.collidesWith).toBeUndefined();
    expect(c.anchorPx).toEqual({ x: 100, y: 500 });
    expect(c.anchor).toEqual({ lat: 500, lng: 100 });
  });

  it('keeps a manual card where it was dragged and reports the collision', () => {
    const [c] = resolveCalloutBoxes([callout('B', 100, 500, { isManualPosition: true })], map, { obstacles: [legend] });
    expect([c.left, c.top]).toEqual([100, 500]);
    expect(c.collidesWith).toEqual(['legend']);
  });

  it('overlapping clustered callouts separate', () => {
    const placed = resolveCalloutBoxes([callout('1', 500, 200), callout('2', 502, 201), callout('3', 504, 202)], map);
    expect(placed.filter((c) => c.collidesWith)).toHaveLength(0);
  });

  it('hidden panels are not obstacles', () => {
    const zones = { legend: { left: 0, top: 0, width: 10, height: 10 }, inset: { left: 20, top: 0, width: 10, height: 10 } };
    expect(panelObstacles(zones, { legendItems: [{}] }).map((o) => o.key)).toEqual(['legend', 'inset']);
    expect(panelObstacles(zones, { legendItems: [{}], showLegend: false }).map((o) => o.key)).toEqual(['inset']);
  });
});

describe('export footer respects visibility', () => {
  const scene = (layout) => ({ width: 1200, height: 800, template: technicalResultsTemplate, project: { layout } });
  it('a hidden or empty footer is not drawn', () => {
    expect(exportFooterBox(scene({ footerText: 'Oval is indicative only', footerEnabled: false }))).toBeNull();
    expect(exportFooterBox(scene({ footerText: '' }))).toBeNull();
    expect(exportFooterBox(scene({ footerText: 'Note', footerHeightPx: 60 })).height).toBe(60);
  });
});

describe('import roles', () => {
  it('a sampling footprint is not a claim or an anomaly', () => {
    expect(inferRoleFromLayer({ name: 'Raven soil sampling extent', type: 'polygons' })).toBe('sampling_extent');
    expect(inferRoleFromLayer({ name: 'survey_footprint', type: 'polygons' })).toBe('sampling_extent');
  });
  it('an unnamed polygon stays neutral; named claims are still claims', () => {
    expect(inferRoleFromLayer({ name: 'export_2024', type: 'polygons' })).toBe('other');
    expect(inferRoleFromLayer({ name: 'Crystal Lake Claims', type: 'polygons' })).toBe('claims');
    expect(inferRoleFromLayer({ name: 'tenures', type: 'polygons' })).toBe('claims');
    expect(inferRoleFromLayer({ name: 'mag_high', type: 'polygons' })).toBe('anomalies');
    expect(inferRoleFromLayer({ name: 'imagery footprint', type: 'polygons' })).toBe('sampling_extent');
    expect(inferRoleFromLayer({ name: 'rocks', type: 'points' })).toBe('drillholes');
  });
  it('neutral roles get their own style, not the claims palette', () => {
    expect(NEUTRAL_ROLES.has('sampling_extent')).toBe(true);
    const l = applyRoleToLayer({ id: 'x', style: {} }, 'sampling_extent');
    expect(l.style.fillOpacity).toBe(0);
    expect(l.style.dashArray).toBe('4 3');
    expect(l.claimsIndex).toBeUndefined();
  });
});

describe('placed logo / image markers', () => {
  it('size is the width at 1x, centred on its map point, and scales with export resolution', async () => {
    const { imageMarkerBox } = await import('../src/export/renderScene.js');
    expect(imageMarkerBox({ size: 100, aspect: 0.5 }, { x: 300, y: 200 }, 1)).toEqual({ x: 250, y: 175, w: 100, h: 50, pad: 0 });
    expect(imageMarkerBox({ size: 100, aspect: 0.5, plate: true }, { x: 900, y: 600 }, 3)).toEqual({ x: 750, y: 525, w: 300, h: 150, pad: 18 });
  });
});

describe('source credit and legend width', () => {
  it('the source credit never prints under the legend', async () => {
    const { sourceCreditPlacement } = await import('../src/export/renderScene.js');
    const { resolveTemplateZones } = await import('../src/templates/technicalResultsTemplate.js');
    const legendItems = [{ label: 'Apex Holdings' }, { label: 'Railway Network' }];
    const scene = { width: 930, height: 930, template: technicalResultsTemplate, project: { layout: { legendItems } } };
    const lines = ['Railways: OpenRailwayMap / OpenStreetMap contributors'];
    const place = sourceCreditPlacement(scene, lines);
    const legend = resolveTemplateZones(technicalResultsTemplate, scene.project.layout, { width: 930, height: 930 }).legend;
    const box = { left: place.left, top: place.bottom - 9.5, width: lines[0].length * 7.5 * 0.52, height: 9.5 };
    const overlaps = !(box.left > legend.left + legend.width || box.left + box.width < legend.left || box.top > legend.top + legend.height || box.top + box.height < legend.top);
    expect(overlaps).toBe(false);
  });

  it('the legend widens for a long label unless the user sized it', async () => {
    const { legendWidthFor } = await import('../src/utils/legendCustomization.js');
    const items = [{ label: 'Elk Creek Carbonatite complex (approx.)' }];
    expect(legendWidthFor({ legendWidthPx: 300 }, items)).toBeGreaterThan(300); // 300 is the stored default
    expect(legendWidthFor({ legendWidthPx: 260 }, items)).toBe(260);
    expect(legendWidthFor({}, [{ label: 'Short' }])).toBe(300);
  });
});
