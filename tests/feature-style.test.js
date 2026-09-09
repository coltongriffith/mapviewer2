import { describe, it, expect } from 'vitest';
import {
  getTemplateStyle, getFeatureStyle, stripFeatureStyle, hasFeatureStyle, styledFeatureCount,
} from '../src/utils/featureStyle.js';

// Export merged a feature's own style for every geometry; the editor only did
// so for points. A polygon given a bold dashed outline was unchanged on
// screen and bold in the PNG — the one artifact a reader receives. Both
// renderers now resolve through these, so this is where that contract lives.

const template = { roleStyles: { target_areas: { stroke: '#f59e0b', dashArray: '8 5', strokeWidth: 2.2 }, other: { stroke: '#000' } } };
const layer = {
  role: 'target_areas',
  style: { fill: '#fbbf24', strokeWidth: 1 },
  featureOverrides: {
    'k:priority': { stroke: '#111111', strokeWidth: 4, hidden: false },
    'k:hidden': { hidden: true },
  },
};

describe('feature style resolution', () => {
  it('layers template role defaults under the layer style', () => {
    expect(getTemplateStyle(template, layer)).toMatchObject({ stroke: '#f59e0b', dashArray: '8 5', strokeWidth: 1, fill: '#fbbf24' });
  });

  it('falls back to the template "other" role for an unknown role', () => {
    expect(getTemplateStyle(template, { role: 'nope', style: {} }).stroke).toBe('#000');
  });

  it('lets one feature override the layer for any geometry', () => {
    const s = getFeatureStyle(template, layer, {}, 'k:priority');
    expect(s.stroke).toBe('#111111');
    expect(s.strokeWidth).toBe(4);
    expect(s.dashArray).toBe('8 5');
  });

  it('is the plain layer style when the feature has no key or no override', () => {
    expect(getFeatureStyle(template, layer, {}, null)).toEqual(getTemplateStyle(template, layer));
    expect(getFeatureStyle(template, layer, {}, 'k:none')).toEqual(getTemplateStyle(template, layer));
  });
});

describe('resetting a shape style', () => {
  it('removes only style keys and keeps hidden and marker shape', () => {
    const out = stripFeatureStyle({ stroke: '#111', fill: '#222', strokeWidth: 3, dashArray: '4 2', fillOpacity: 0.5, hidden: true, markerShape: 'square' });
    expect(out).toEqual({ hidden: true, markerShape: 'square' });
  });

  it('counts only features that actually carry a style', () => {
    expect(hasFeatureStyle({ hidden: true })).toBe(false);
    expect(hasFeatureStyle({ strokeWidth: 3 })).toBe(true);
    expect(styledFeatureCount(layer)).toBe(1);
    expect(styledFeatureCount({})).toBe(0);
  });
});
