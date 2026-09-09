import { describe, it, expect } from 'vitest';
import { pickScaleBar, formatScaleLength, formatScaleHalf } from '../src/utils/scaleBar.js';
import { distanceLineLabel, bracketTicks, bracketLabelAnchor, isBracket, formatDistance } from '../src/utils/distanceLine.js';
import { arrowheadPoints, estimateBox } from '../src/utils/calloutLayout.js';

// Three copies of the scale-bar picker (editor card, shared page, exporter)
// were one table drifting three ways. One picker now, and the bar reads
// "0 · 2.5 · 5 km" the way a technical figure's does.

function mapAt(mPerPx) {
  const dLng = mPerPx / (111319.9 * Math.cos(61.5 * Math.PI / 180));
  return {
    getSize: () => ({ x: 1000, y: 600 }),
    containerPointToLatLng: ([x]) => ({ lat: 61.5, lng: -133 + x * dLng }),
  };
}

describe('pickScaleBar', () => {
  it('chooses a round length near 120px and labels its midpoint in the same unit', () => {
    const bar = pickScaleBar(mapAt(40));
    expect(bar.metres).toBe(5000);
    expect(bar.label).toBe('5 km');
    expect(bar.half).toBe('2.5');
    expect(bar.widthPx).toBe(125);
  });

  it('stays in metres below a kilometre', () => {
    const bar = pickScaleBar(mapAt(2));
    expect(bar.metres).toBe(250);
    expect(bar.label).toBe('250 m');
    expect(bar.half).toBe('125');
  });

  it('formats consistently', () => {
    expect(formatScaleLength(1000)).toBe('1 km');
    expect(formatScaleHalf(1000)).toBe('0.5');
    expect(formatScaleHalf(500)).toBe('250');
  });
});

describe('distance lines', () => {
  const line = { p1: { lat: 61.5, lng: -133 }, p2: { lat: 61.5, lng: -132.97 }, units: 'km' };

  it('captions a measurement with its length, unless told otherwise', () => {
    expect(distanceLineLabel(line)).toMatch(/km$/);
    expect(distanceLineLabel({ ...line, label: 'Untested strike length >1.5 km' })).toBe('Untested strike length >1.5 km');
    expect(distanceLineLabel({ ...line, showLabel: false, label: 'x' })).toBe('');
    expect(formatDistance(0.4, 'km')).toBe('400 m');
    expect(formatDistance(2, 'mi')).toBe('1.2 mi');
  });

  it('puts a perpendicular tick across each end of a bracket', () => {
    expect(isBracket({ style: 'bracket' })).toBe(true);
    expect(isBracket({})).toBe(false);
    const [a, b] = bracketTicks(0, 0, 100, 0, 10);
    expect(a).toEqual({ x1: 0, y1: -5, x2: 0, y2: 5 });
    expect(b).toEqual({ x1: 100, y1: -5, x2: 100, y2: 5 });
    const [c] = bracketTicks(0, 0, 0, 100, 10);
    expect(Math.abs(c.x1 - 5)).toBeLessThan(1e-9);
    expect(Math.abs(c.x2 + 5)).toBeLessThan(1e-9);
  });

  it('floats a bracket caption above the bar, whichever way it was drawn', () => {
    expect(bracketLabelAnchor(0, 0, 100, 0, 14).y).toBe(-14);
    expect(bracketLabelAnchor(100, 0, 0, 0, 14).y).toBe(-14);
  });
});

describe('callouts', () => {
  it('points the arrowhead at the anchor', () => {
    const [tip, l, r] = arrowheadPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 8);
    expect(tip).toEqual({ x: 100, y: 0 });
    expect(l.x).toBe(92); expect(r.x).toBe(92);
    expect(l.y).toBe(-r.y);
  });

  it('sizes the box for one result per line', () => {
    const one = estimateBox({ text: 'TL-11-005', subtext: '2.25m @ 7.18% Cu', boxWidth: 220 });
    const three = estimateBox({ text: 'TL-11-005', subtext: '2.25m @ 7.18% Cu\n14.15m @ 1.45% Cu\n0.59m @ 1.42% Cu', boxWidth: 220 });
    expect(three.height).toBeGreaterThan(one.height + 20);
  });
});
