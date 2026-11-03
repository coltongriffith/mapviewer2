import { describe, it, expect } from 'vitest';
import { propertyBoundaryScene } from '../src/utils/propertyBoundaryScene.js';
import { paintFxCanvas, paintFxSvg } from '../src/utils/geoStyle.js';

const ring = (x) => [[x,0],[x+1,0],[x+1,1],[x,1],[x,0]];
const project = () => ({ layout: { propertyNeighboursVersion: 1, primaryLayerId: 'subject', propertyBoundaryOutline: true },
  layers: [{ id: 'subject', role: 'claims', style: { stroke: '#112233', strokeWidth: 2.2, opacity: .5, layerOpacity: .4 },
    geojson: { type: 'FeatureCollection', features: [0,1].map((x) => ({ type: 'Feature', id: String(x), properties: {}, geometry: { type: 'Polygon', coordinates: [ring(x)] } })) } }] });
const view = { W: 100, H: 100, pt: (x,y) => [20+x*20,20+y*20] };

describe('Shared presentation-only property boundary stroke', () => {
  it('projects one separate exterior without changing internal paths or source styles', () => {
    const p = project(), before = structuredClone(p), result = propertyBoundaryScene(p,view);
    expect(result).toMatchObject({ ok: true, layerId: 'subject' });
    expect(result.primitives).toHaveLength(1);
    const stroke = result.primitives[0];
    expect(stroke).toMatchObject({ t: 'stroke', closed: false, sw: 4.2, stroke: '#112233', opacity: .2 });
    expect(stroke.lines.some(([a,b]) => a[0] === 40 && b[0] === 40)).toBe(false);
    expect(p).toEqual(before);
  });
  it('uses the same primitive for Canvas and SVG with scaled stroke/opacity', () => {
    const { primitives } = propertyBoundaryScene(project(),view), widths = [], colors = [];
    const ctx = new Proxy({}, { get: () => () => {}, set: (_,key,value) => { if (key === 'lineWidth') widths.push(value); if (key === 'strokeStyle') colors.push(value); return true; } });
    paintFxCanvas(ctx,primitives,2);
    const svg = paintFxSvg(primitives,2,[],{ W: 100, H: 100 });
    expect(widths).toEqual([4.2]); // Canvas's enclosing scale applies the ratio.
    expect(colors[0]).toContain('0.2');
    expect(svg).toContain('stroke-width="8.4"');
    expect(svg).toContain('stroke-opacity="0.2"');
    expect(svg).toContain('fill="none"');
  });
  it('does not invent viewport closing edges when a property encloses the frame', () => {
    const p = project(); p.layers[0].geojson.features = [p.layers[0].geojson.features[0]];
    const result = propertyBoundaryScene(p,{ ...view, pt: (x,y) => [x*300-100,y*300-100] });
    expect(result).toMatchObject({ ok: true, primitives: [] });
  });
  it('keeps projected strokes within the coordinate-frame rectangle', () => {
    const frame = { left: 30, top: 10, right: 50, bottom: 70 };
    const { primitives } = propertyBoundaryScene(project(),{ ...view, frame });
    expect(primitives[0].lines.length).toBeGreaterThan(0);
    for (const line of primitives[0].lines) for (const [x,y] of line) {
      expect(x).toBeGreaterThanOrEqual(frame.left+2.1); expect(x).toBeLessThanOrEqual(frame.right-2.1);
      expect(y).toBeGreaterThanOrEqual(frame.top+2.1); expect(y).toBeLessThanOrEqual(frame.bottom-2.1);
    }
  });
  it('suppresses emphasis during direct trim/style editing', () => {
    for (const options of [{ trimLayerId: 'subject' }, { featureStyleLayerId: 'subject' }]) {
      expect(propertyBoundaryScene(project(),view,options)).toEqual({ ok: false, reason: 'editing-source', primitives: [] });
    }
  });
  it('honours zero stroke/opacity and never enables an old map automatically', () => {
    const p = project(); delete p.layout.propertyBoundaryOutline;
    expect(propertyBoundaryScene(p,view).reason).toBe('disabled');
    p.layout.propertyBoundaryOutline = true; p.layers[0].style.strokeWidth = 0;
    expect(propertyBoundaryScene(p,view).reason).toBe('stroke-hidden');
    p.layers[0].style.strokeWidth = 2; p.layers[0].style.layerOpacity = 0;
    expect(propertyBoundaryScene(p,view).primitives).toEqual([]);
  });
  it('refuses invalid projection or a collapsed frame without partial output', () => {
    expect(propertyBoundaryScene(project(),{ ...view, pt: () => [Infinity,0] }).reason).toBe('invalid-projection');
    expect(propertyBoundaryScene(project(),{ ...view, frame: { left: 2, top: 2, right: 3, bottom: 3 } }).reason).toBe('invalid-frame');
  });
});
