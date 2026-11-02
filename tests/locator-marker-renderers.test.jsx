import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import LocatorInset from '../src/components/LocatorInset.jsx';
import { renderInsetSvg, studioInsetOpts } from '../src/export/renderScene.js';
import { getTemplate } from '../src/templates/index.js';
import { createInitialProjectState } from '../shared/projectState.js';
import { geojsonBounds } from '../src/utils/geometry.js';

afterEach(cleanup);
const layer = (id, x, y, extra = {}) => ({ id, role: 'claims', type: 'geojson', visible: true, ...extra,
  geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', id, properties: {}, geometry: {
    type: 'Polygon', coordinates: [[[x, y], [x + .02, y], [x + .02, y + .02], [x, y + .02], [x, y]]],
  } }] } });
const subject = layer('subject', -120, 50), context = layer('context', -115, 52, { focus: false });
const region = { name: 'Synthetic QA region', bbox: [-130, 40, -100, 60],
  coordinates: [[[-130, 40], [-100, 40], [-100, 60], [-130, 60], [-130, 40]]] };
const layout = { ...createInitialProjectState().layout, propertyNeighboursVersion: 1, primaryLayerId: 'subject', autoInsetRegion: region };
const svgDocument = (svg) => new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`, 'image/svg+xml');
const point = (root) => Array.from(root.querySelectorAll('circle')).map((node) => [node.getAttribute('cx'), node.getAttribute('cy')]);
const outline = (root) => Array.from(root.querySelectorAll('path')).map((node) => node.getAttribute('d'));
function exported(layers, settings = layout) {
  return svgDocument(renderInsetSvg({ project: { layout: settings, layers }, template: getTemplate(settings.templateId), width: 1600, height: 900, map: null }, 1, []));
}

describe('Property locator marker render paths', () => {
  it('editor/read-only shared component marks the subject while retaining the regional outline', () => {
    const props = { layers: [subject, context], layout, insetMode: 'province_state', autoInsetRegion: region };
    const { container, rerender } = render(<LocatorInset {...props} />);
    const selected = point(container), regionOutline = outline(container);
    expect(selected).toHaveLength(1);
    rerender(<LocatorInset {...props} layers={[subject]} />);
    expect(point(container)).toEqual(selected);
    expect(outline(container)).toEqual(regionOutline);
    rerender(<LocatorInset {...props} layout={{ ...layout, propertyNeighboursVersion: undefined }} />);
    expect(point(container)).not.toEqual(selected);
    expect(outline(container)).toEqual(regionOutline);
  });
  it('standard SVG export uses the same property marker regardless of distant context', () => {
    const selected = exported([subject, context]);
    expect(point(selected)).toHaveLength(1);
    expect(point(selected)).toEqual(point(exported([subject])));
    const legacy = exported([subject, context], { ...layout, propertyNeighboursVersion: undefined });
    expect(point(legacy)).not.toEqual(point(selected));
    expect(outline(legacy)).toEqual(outline(selected));
  });
  it('Studio export primitives use the subject without replacing the provided regional background', () => {
    const opts = studioInsetOpts(layout, [subject, context], { width: 240, height: 180 });
    expect(opts.bounds).toEqual(geojsonBounds(subject.geojson));
    expect(opts.region).toBe(region);
    const legacy = studioInsetOpts({ ...layout, propertyNeighboursVersion: undefined }, [subject, context], { width: 240, height: 180 });
    expect(legacy.bounds.maxLng).toBe(-114.98);
  });
  it('preserves supplied custom images without adding a location marker', () => {
    const settings = { ...layout, insetMode: 'custom_image', insetImage: 'data:image/png;base64,qa' };
    const svg = exported([subject, context], settings);
    expect(svg.querySelector('image')?.getAttribute('href')).toBe(settings.insetImage);
    expect(point(svg)).toHaveLength(0);
  });
});
