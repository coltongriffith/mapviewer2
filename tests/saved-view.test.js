import { describe, it, expect } from 'vitest';
import { projectStageSize, savedViewFor, zoomForSize } from '../src/utils/savedView.js';

describe('saved map view', () => {
  const center = { lat: 49.5, lng: -120.2 };

  it('uses the export shape view with its fixed stage size', () => {
    const p = { layout: { exportRatio: 'square' }, ratioMapStates: { square: { center, zoom: 13.25 } }, mapView: { center: { lat: 0, lng: 0 }, zoom: 3 } };
    expect(savedViewFor(p)).toEqual({ center, zoom: 13.25, width: 1000, height: 1000 });
  });

  it('falls back to the free-form view with its screen size', () => {
    const p = { layout: {}, mapView: { center, zoom: 11, screenW: 1200, screenH: 800 } };
    expect(savedViewFor(p)).toEqual({ center, zoom: 11, width: 1200, height: 800 });
  });

  it('returns null when nothing was saved', () => {
    expect(savedViewFor({ layout: { exportRatio: 'square' }, ratioMapStates: {} })).toBeNull();
    expect(savedViewFor({ layout: {}, mapView: null })).toBeNull();
  });

  it('custom pixel size uses the free-form view, not a stale shape view', () => {
    const p = { layout: { exportRatio: 'square', exportSettings: { customWidth: 1600, customHeight: 900 } }, ratioMapStates: { square: { center: { lat: 1, lng: 1 }, zoom: 5 } }, mapView: { center, zoom: 12, screenW: 1333, screenH: 750 } };
    expect(savedViewFor(p).zoom).toBe(12);
    expect(projectStageSize(p.layout)).toEqual({ width: 1333, height: 750 });
  });

  it('keeps zoom on the same size and keeps the extent on another size', () => {
    const v = { zoom: 12, width: 1000, height: 1000 };
    expect(zoomForSize(v, 1000, 1000)).toBe(12);
    expect(zoomForSize(v, 500, 800)).toBeCloseTo(11);
    expect(zoomForSize(v, 2000, 2000)).toBeCloseTo(13);
    expect(zoomForSize({ zoom: 9 }, 500, 500)).toBe(9);
  });
});
