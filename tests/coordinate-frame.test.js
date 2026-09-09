import { describe, it, expect } from 'vitest';
import {
  getMapFrame, scaleFrame, computeGridTicks, latlngToUTM, pickUTMInterval,
  fmtUTMEasting, fmtUTMNorthing, projectionLabel, scaleBarHeight, hasCoordinateFrame,
  TICK_MARGIN, STRIP_H,
} from '../src/utils/coordinateFrame.js';

// The frame was drawn by four renderers from four copies of the same maths,
// and they disagreed about where a tick sat: the editor squeezed the map's
// full width into the frame, the exporter shifted every tick by the margin.
// One computation now, in container pixels; each renderer scales it.

// A flat fake map: linear in both axes around a Yukon centre. Good enough for
// ticks to land where the maths says, and for the inverse to round-trip.
function fakeMap({ w = 1000, h = 600, lat = 61.5, lng = -133.0, mPerPx = 20 } = {}) {
  const dLat = mPerPx / 111132;
  const dLng = mPerPx / (111319.9 * Math.cos(lat * Math.PI / 180));
  return {
    getSize: () => ({ x: w, y: h }),
    containerPointToLatLng: ([x, y]) => ({ lat: lat - (y - h / 2) * dLat, lng: lng + (x - w / 2) * dLng }),
    latLngToContainerPoint: ([la, ln]) => ({ x: w / 2 + (ln - lng) / dLng, y: h / 2 - (la - lat) / dLat }),
    getCenter: () => ({ lat, lng }),
  };
}

describe('getMapFrame', () => {
  const stage = { width: 1000, height: 600 };

  it('is nothing unless the layout asks for a frame', () => {
    expect(getMapFrame({ templateId: 'technical_results_v2' }, stage)).toBeNull();
    expect(getMapFrame({ templateId: 'side_panel' }, stage)).toBeNull();
    expect(hasCoordinateFrame({})).toBe(false);
  });

  it('is always on for NI 43-101, making room for the title strip', () => {
    const bottom = getMapFrame({ templateId: 'ni_43101_technical' }, stage);
    expect(bottom).toMatchObject({ left: TICK_MARGIN, top: TICK_MARGIN, right: 1000 - TICK_MARGIN, bottom: 600 - TICK_MARGIN - STRIP_H });
    const top = getMapFrame({ templateId: 'ni_43101_technical', titleStripPosition: 'top' }, stage);
    expect(top.top).toBe(TICK_MARGIN + STRIP_H);
    expect(top.bottom).toBe(600 - TICK_MARGIN);
    expect(hasCoordinateFrame({ templateId: 'ni_43101_technical' })).toBe(true);
  });

  it('insets any template that switches it on', () => {
    const f = getMapFrame({ templateId: 'technical_results_v2', showCoordinateFrame: true }, stage);
    expect(f).toMatchObject({ left: 28, top: 28, right: 972, bottom: 572 });
    expect(f.area).toEqual({ left: 0, top: 0, right: 1000, bottom: 600 });
  });

  it('stops at the rail on the side-panel template', () => {
    const f = getMapFrame({ templateId: 'side_panel', showCoordinateFrame: true }, stage, { sidebarFrac: 0.28 });
    // The map area is the left 72%; the white margin must not paint the rail.
    expect(f.area.right).toBe(720);
    expect(f.right).toBe(720 - TICK_MARGIN);
  });

  it('scales every edge for export', () => {
    const f = scaleFrame(getMapFrame({ templateId: 'ni_43101_technical' }, stage), 2);
    expect(f.left).toBe(56);
    expect(f.area.right).toBe(2000);
    expect(scaleFrame(null, 2)).toBeNull();
  });
});

describe('UTM', () => {
  it('projects a Yukon point into zone 8N with sane eastings', () => {
    const u = latlngToUTM(61.5, -133.0);
    expect(u.zone).toBe(8);
    expect(u.hemisphere).toBe('N');
    expect(u.easting).toBeGreaterThan(500000);
    expect(u.easting).toBeLessThan(620000);
    expect(u.northing).toBeGreaterThan(6_800_000);
    expect(u.northing).toBeLessThan(6_900_000);
  });

  it('formats labels the way a survey grid reads', () => {
    expect(fmtUTMEasting(593000)).toBe('593 000E');
    expect(fmtUTMNorthing(6981500)).toBe('6 981 500N');
    expect(fmtUTMNorthing(981500)).toBe('981 500N');
  });

  it('picks the smallest standard interval giving roughly the asked count', () => {
    expect(pickUTMInterval(12000, 6)).toBe(2000);
    expect(pickUTMInterval(1500, 6)).toBe(250);
    expect(pickUTMInterval(9_000_000, 6)).toBe(100000);
  });
});

describe('computeGridTicks', () => {
  const layout = { templateId: 'technical_results_v2', showCoordinateFrame: true };
  const stage = { width: 1000, height: 600 };
  const frame = getMapFrame(layout, stage);

  it('returns only ticks inside the frame, in container pixels', () => {
    const t = computeGridTicks(fakeMap(), frame, 1);
    expect(t.zone).toBe(8);
    expect(t.x.length).toBeGreaterThanOrEqual(4);
    expect(t.y.length).toBeGreaterThanOrEqual(3);
    for (const { px } of t.x) { expect(px).toBeGreaterThanOrEqual(frame.left - 1); expect(px).toBeLessThanOrEqual(frame.right + 1); }
    for (const { py } of t.y) { expect(py).toBeGreaterThanOrEqual(frame.top - 1); expect(py).toBeLessThanOrEqual(frame.bottom + 1); }
  });

  it('labels eastings increasing to the right and northings increasing upward', () => {
    const t = computeGridTicks(fakeMap(), frame, 1);
    for (let i = 1; i < t.x.length; i += 1) {
      expect(t.x[i].px).toBeGreaterThan(t.x[i - 1].px);
      expect(t.x[i].easting).toBe(t.x[i - 1].easting + t.xInterval);
    }
    for (let i = 1; i < t.y.length; i += 1) {
      expect(t.y[i].py).toBeGreaterThan(t.y[i - 1].py);
      expect(t.y[i].northing).toBe(t.y[i - 1].northing - t.yInterval);
    }
    expect(t.x[0].label).toMatch(/^\d{3} \d{3}E$/);
    expect(t.y[0].label).toMatch(/^\d \d{3} \d{3}N$/);
  });

  it('lands each tick where that easting actually is, not squeezed into the frame', () => {
    const map = fakeMap();
    const t = computeGridTicks(map, frame, 1);
    const first = t.x[0];
    // Project the tick's own easting back through the map: it must be at px.
    const centre = map.getCenter();
    const u = latlngToUTM(centre.lat, centre.lng);
    const mPerLng = 111319.9 * Math.cos(centre.lat * Math.PI / 180) * 0.9996 * 1.0000; // ~flat approx
    const expectedX = map.latLngToContainerPoint([centre.lat, centre.lng + (first.easting - u.easting) / mPerLng]).x;
    expect(Math.abs(first.px - expectedX)).toBeLessThan(3);
  });

  it('multiplies by the export scale', () => {
    const one = computeGridTicks(fakeMap(), frame, 1);
    const two = computeGridTicks(fakeMap(), frame, 2);
    expect(two.x[0].px).toBeCloseTo(one.x[0].px * 2, 6);
    expect(two.frame.right).toBe(frame.right * 2);
  });

  it('is null without a usable map', () => {
    expect(computeGridTicks(null, frame)).toBeNull();
    expect(computeGridTicks({ getSize: () => ({ x: 0, y: 0 }) }, frame)).toBeNull();
  });
});

describe('projection label and scale bar height', () => {
  it('prefers what the user wrote, else derives the zone from the map', () => {
    expect(projectionLabel({ projectionName: ' NAD83 / UTM Zone 7N ' }, fakeMap())).toBe('NAD83 / UTM Zone 7N');
    expect(projectionLabel({}, fakeMap())).toBe('WGS84 / UTM Zone 8N');
    expect(projectionLabel({}, null)).toBe('WGS84');
  });

  it('grows the scale bar card for the caption unless a height was set by hand', () => {
    expect(scaleBarHeight({})).toBe(48);
    expect(scaleBarHeight({ showProjectionLabel: true })).toBe(64);
    expect(scaleBarHeight({ showProjectionLabel: true, scaleBarHeightPx: 40 })).toBe(40);
  });
});
