import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { resolveCalloutBoxes, intersects, panelObstacles } from '../src/utils/calloutLayout.js';
import { resolveScoredBoxes, autoArrangeCallouts, leaderOf, lineHitsRect, crossings } from '../src/utils/calloutScorer.js';
import { leaderGeometry, leaderEndpoint, leaderSvgD, anchorMark, leaderTangentFrom } from '../shared/leaderGeometry.js';
import { renderCalloutsSvg, drawCalloutsCanvas } from '../src/export/renderScene.js';
import { resolveTemplateZones, technicalResultsTemplate } from '../src/templates/technicalResultsTemplate.js';
import { createInitialProjectState } from '../shared/projectState.js';
import CalloutsOverlay from '../src/components/CalloutsOverlay.jsx';

// Automatic callout placement (the scored layout, layoutAlgorithm 2) and the
// one leader geometry the editor, shared view, PNG/PDF canvas and SVG draw.

// jsdom has no canvas: the exporters fall back to estimated text widths, as
// they did when the legacy hashes below were recorded. Silence its warning.
beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });

// A Leaflet stand-in: container px = (lng, lat).
const map = {
  getSize: () => ({ x: 1200, y: 800 }),
  latLngToContainerPoint: ([lat, lng]) => ({ x: lng, y: lat }),
  on() {}, off() {}, getContainer: () => null,
};
const legend = { key: 'legend', left: 18, top: 560, width: 300, height: 222 };
const card = (id, x, y, extra = {}) => ({
  id, text: id, type: 'leader', priority: 2, anchor: { lat: y, lng: x }, offset: { x: 20, y: -18 }, boxWidth: 150, ...extra,
});

// Twenty drill-hole intercepts on a 5 × 4 collar grid, every card carrying a
// result line, mixed priorities, types and leader shapes. Every default
// offset lands its card on a neighbour.
const dense = () => Array.from({ length: 20 }, (_, i) => card(`DDH-${i + 1}`, 380 + (i % 5) * 110 + ((i * 53) % 29), 250 + Math.floor(i / 5) * 80 + ((i * 37) % 17), {
  subtext: `${(i * 0.37 + 1).toFixed(2)} g/t Au over ${8 + i} m`,
  type: i % 3 ? 'leader' : 'boxed',
  priority: (i % 3) + 1,
  style: { fontSize: 12, paddingX: 10, paddingY: 8, leaderShape: ['straight', 'elbow', 'curve'][i % 3] },
}));

const inside = (r) => ({ left: r.left + 1, top: r.top + 1, width: r.width - 2, height: r.height - 2 });
function problems(placed, obstacles = []) {
  const out = [];
  placed.forEach((a, i) => {
    obstacles.forEach((o) => intersects(a, o, -1) && out.push(`${a.id} on ${o.key}`));
    placed.forEach((b, j) => {
      if (j > i && intersects(a, b, -1)) out.push(`${a.id} overlaps ${b.id}`);
      const lead = leaderOf(a);
      if (j !== i && lead && lineHitsRect(lead, inside(b))) out.push(`${a.id} leader through ${b.id}`);
      const other = leaderOf(b);
      if (j > i && lead && other && crossings(lead, other)) out.push(`${a.id} leader crosses ${b.id} leader`);
    });
  });
  return out;
}

describe('leader geometry', () => {
  const box = { left: 300, top: 100, width: 150, height: 40 };

  it('straight: today\'s line, from the anchor to the facing side', () => {
    const g = leaderGeometry({ x: 200, y: 160 }, box);
    expect(g).toEqual({ start: { x: 200, y: 160 }, bend: null, end: leaderEndpoint({ x: 200, y: 160 }, box), curve: false });
    expect(g.end).toEqual({ x: 300, y: 120 });
    expect(leaderSvgD(g)).toBe('M200 160 L300 120');
  });

  it('elbow: a 45° leg from the anchor, then a level shelf into the card side', () => {
    const g = leaderGeometry({ x: 200, y: 160 }, box, 'elbow');
    expect(g.start).toEqual({ x: 200, y: 160 });
    expect(g.bend).toEqual({ x: 240, y: 120 });
    expect(Math.abs(g.bend.x - g.start.x)).toBe(Math.abs(g.bend.y - g.start.y));
    expect(g.bend.y).toBe(g.end.y);
    expect(leaderSvgD(g)).toBe('M200 160 L240 120 L300 120');
  });

  it('elbow into the top or bottom of a card ends square to that edge', () => {
    const g = leaderGeometry({ x: 390, y: 300 }, box, 'elbow');
    expect(g.end).toEqual({ x: 375, y: 140 });
    expect(g.bend.x).toBe(g.end.x);
    expect(Math.abs(g.bend.x - g.start.x)).toBe(Math.abs(g.bend.y - g.start.y));
  });

  it('a steep elbow keeps a short shelf rather than folding flat', () => {
    const g = leaderGeometry({ x: 290, y: 119 }, box, 'elbow');
    expect(g.end).toEqual({ x: 300, y: 120 });
    expect(g.bend).toEqual({ x: 290, y: 120 });
  });

  it('curve: the elbow route smoothed, starting exactly on the anchor', () => {
    const anchor = { x: 200, y: 160 };
    const g = leaderGeometry(anchor, box, 'curve');
    expect(g.curve).toBe(true);
    expect(g.start).toEqual(anchor);
    expect(g.start).not.toBe(anchor);
    expect(leaderSvgD(g)).toBe('M200 160 Q240 120 300 120');
    const pts = leaderOf({ type: 'leader', anchorPx: anchor, ...box, style: { leaderShape: 'curve' } });
    expect(pts[0]).toEqual(anchor);
    expect(pts[pts.length - 1]).toEqual(g.end);
    expect(pts.length).toBeGreaterThan(3);
  });

  it('scales linearly, so 3x export geometry is the 1x geometry times three', () => {
    for (const shape of ['straight', 'elbow', 'curve']) {
      const one = leaderGeometry({ x: 210, y: 175 }, box, shape);
      const three = leaderGeometry({ x: 630, y: 525 }, { left: 900, top: 300, width: 450, height: 120 }, shape, 3);
      for (const k of ['start', 'bend', 'end']) {
        if (!one[k]) { expect(three[k]).toBeNull(); continue; }
        expect(three[k].x).toBeCloseTo(one[k].x * 3, 9);
        expect(three[k].y).toBeCloseTo(one[k].y * 3, 9);
      }
    }
  });

  it('draws an anchor mark only when asked', () => {
    expect(anchorMark({})).toBeNull();
    expect(anchorMark({ anchorMark: 'none' })).toBeNull();
    expect(anchorMark({ anchorMark: 'dot' })).toEqual({ r: 3, filled: true });
    expect(anchorMark({ anchorMark: 'ring' })).toEqual({ r: 3.5, filled: false });
  });
});

describe('scored callout layout', () => {
  it('arranges a dense project with no overlaps and no leader through a card', () => {
    const arranged = autoArrangeCallouts(dense(), map, { obstacles: [legend] });
    const placed = resolveScoredBoxes(arranged, map, { obstacles: [legend] });
    expect(placed).toHaveLength(20);
    expect(problems(placed, [legend])).toEqual([]);
    expect(placed.filter((c) => c.collidesWith)).toEqual([]);
    // The same project under the legacy stepping, for scale: it does not.
    expect(problems(resolveCalloutBoxes(dense(), map, { obstacles: [legend] }), [legend]).length).toBeGreaterThan(10);
  });

  it('is deterministic and leaves its input alone', () => {
    const input = dense();
    const snapshot = JSON.stringify(input);
    const a = autoArrangeCallouts(input, map, { obstacles: [legend] });
    const b = autoArrangeCallouts(dense(), map, { obstacles: [legend] });
    expect(a).toEqual(b);
    expect(resolveScoredBoxes(a, map, { obstacles: [legend] })).toEqual(resolveScoredBoxes(b, map, { obstacles: [legend] }));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('keeps ids, anchors and pinned cards; only automatic offsets change', () => {
    const input = dense().map((c, i) => (i % 4 === 0 ? { ...c, isManualPosition: true, offset: { x: -60, y: 30 + i } } : c));
    const out = autoArrangeCallouts(input, map, { obstacles: [legend] });
    out.forEach((c, i) => {
      expect(c.id).toBe(input[i].id);
      expect(c.anchor).toBe(input[i].anchor);
      if (input[i].isManualPosition) expect(c).toBe(input[i]);
    });
    const placed = resolveScoredBoxes(out, map, { obstacles: [legend] });
    for (const c of input.filter((x) => x.isManualPosition)) {
      const p = placed.find((x) => x.id === c.id);
      expect([p.left, p.top]).toEqual([c.anchor.lng + c.offset.x, c.anchor.lat + c.offset.y]);
    }
  });

  it('places a pinned card before an automatic one of higher priority', () => {
    // The legacy order is by priority alone, so the high-priority automatic
    // card took the spot the user had pinned a low-priority card on.
    const input = [card('Auto', 400, 300, { priority: 1 }), card('Pinned', 380, 296, { priority: 3, isManualPosition: true, offset: { x: 30, y: -10 } })];
    const legacy = resolveCalloutBoxes(input, map);
    expect(legacy.find((c) => c.id === 'Pinned').collidesWith).toEqual(['callout "Auto"']);
    const placed = resolveScoredBoxes(input, map);
    expect(placed.filter((c) => c.collidesWith)).toEqual([]);
    expect(problems(placed)).toEqual([]);
    const pinned = placed.find((c) => c.id === 'Pinned');
    expect([pinned.left, pinned.top]).toEqual([410, 286]);
    // Drawing order stays by priority, as before.
    expect(placed.map((c) => c.id)).toEqual(['Auto', 'Pinned']);
  });

  it('keeps an approved position that collides with nothing', () => {
    // Far from the anchor, but approved: it stays. Auto-arrange is what pulls
    // it back in.
    const input = [card('Far', 500, 400, { offset: { x: 120, y: -140 } })];
    const [kept] = resolveScoredBoxes(input, map);
    expect([kept.left, kept.top]).toEqual([620, 260]);
    const [fresh] = resolveScoredBoxes(autoArrangeCallouts(input, map), map);
    expect(Math.hypot(fresh.left - 500, fresh.top - 400)).toBeLessThan(Math.hypot(120, 140));
  });

  it('re-places only the card something landed on, near where it was', () => {
    const arranged = autoArrangeCallouts(dense(), map, { obstacles: [legend] });
    const before = resolveScoredBoxes(arranged, map, { obstacles: [legend] });
    const hit = before[7];
    // Pin a new card exactly over one approved card.
    const intruder = card('Pinned', 1150, 780, { type: 'plain', isManualPosition: true, offset: { x: hit.left - 1150, y: hit.top - 780 } });
    const after = resolveScoredBoxes([...arranged, intruder], map, { obstacles: [legend] });
    const moved = after.filter((c) => c.id !== 'Pinned' && before.find((b) => b.id === c.id).left !== c.left);
    expect(moved.map((c) => c.id)).toEqual([hit.id]);
    expect(after.find((c) => c.id === 'Pinned')).toMatchObject({ left: hit.left, top: hit.top });
  });

  it('never drops a callout it cannot clear; it reports it', () => {
    const input = [
      card('A', 400, 300, { isManualPosition: true, offset: { x: 0, y: 0 } }),
      card('B', 402, 302, { isManualPosition: true, offset: { x: 0, y: 0 } }),
      card('C', 420, 310),
    ];
    const placed = resolveScoredBoxes(input, map);
    expect(placed.map((c) => c.id).sort()).toEqual(['A', 'B', 'C']);
    expect(placed.find((c) => c.id === 'B').collidesWith).toContain('callout "A"');
    expect(placed.find((c) => c.id === 'C').collidesWith.some((w) => w.startsWith('leader crosses'))).toBe(true);
  });
});

describe('projects saved before the scored layout are unchanged', () => {
  const legacyFixture = [
    card('a', 400, 300, { text: 'Alpha', priority: 1 }),
    card('b', 420, 310, { text: 'Bravo', type: 'boxed' }),
    card('c', 380, 296, { text: 'Charlie', subtext: '12 m @ 3.1 g/t', priority: 3, offset: { x: 30, y: -10 }, isManualPosition: true }),
    card('d', 100, 600, { text: 'Delta', type: 'plain', boxWidth: undefined }),
  ];

  it('the legacy placement is what it was', () => {
    // Recorded from the layout before this change.
    const placed = resolveCalloutBoxes(legacyFixture, map, { obstacles: [legend] });
    expect(placed.map((c) => [c.id, c.left, c.top, c.width, c.height, c.collidesWith || null])).toEqual([
      ['a', 420, 282, 150, 31, null],
      ['b', 440, 335.4, 150, 31, null],
      ['d', 336.9999999999999, 545.9999999999995, 120, 31, null],
      ['c', 410, 286, 150, 48, ['callout "Alpha"']],
    ]);
  });

  it('only new projects start on the latest scored layout', () => {
    expect(createInitialProjectState().layout.layoutAlgorithm).toBe(3);
  });

  const scene = (layout, callouts) => ({
    width: 1200, height: 800, template: technicalResultsTemplate, map,
    project: { layout: { showTitle: false, showLegend: false, showNorthArrow: false, showScaleBar: false, insetEnabled: false, ...layout }, layers: [], callouts },
  });
  const rects = (svg) => [...svg.matchAll(/<g id="em-callout-([^"]+)" class="em-callout"><rect x="([^"]+)" y="([^"]+)"/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);

  it('exports an old project with the legacy placement and a new one with the scored', () => {
    const obstacles = panelObstacles(resolveTemplateZones(technicalResultsTemplate, scene({}).project.layout, { width: 1200, height: 800 }), scene({}).project.layout);
    const old = rects(renderCalloutsSvg(scene({}, dense()), 1, []));
    expect(old).toEqual(resolveCalloutBoxes(dense(), map, { obstacles }).filter((c) => c.type !== 'plain').map((c) => [c.id.replace(/[^a-zA-Z0-9]/g, ''), c.left, c.top]));
    const scored = rects(renderCalloutsSvg(scene({ layoutAlgorithm: 2 }, dense()), 1, []));
    expect(scored).toEqual(resolveScoredBoxes(dense(), map, { obstacles }).map((c) => [c.id.replace(/[^a-zA-Z0-9]/g, ''), c.left, c.top]));
    expect(scored).not.toEqual(old);
  });

  it('an old project exports the same SVG and canvas callouts, byte for byte', async () => {
    // Hashes of renderCalloutsSvg / drawCalloutsCanvas output recorded from the
    // code before the shared leader geometry, for the dense fixture with
    // straight leaders and some arrowheads, at 1x and 3x.
    const before = {
      svg1: '33b400f028227705ce0553689ca22c2ebeef19e7ec8d990c11974a93cdbfb5ce',
      canvas1: 'b87b7708521c659b8b3bbe27d7b31913f25e24ae9cf603f4340a3589f217c807',
      svg3: 'b8eacb4a8eaa855e737b11b889aaa65d0ca418960898f81481ed59c4e8796d5c',
      canvas3: 'c9abf04b02d0ad640f804f39692a2f44ad16590efbe6733ee908033d1611829c',
    };
    const old = () => dense().map((c, i) => ({ ...c, style: { fontSize: 12, paddingX: 10, paddingY: 8, arrowhead: i % 4 === 0 } }));
    const sha = (x) => createHash('sha256').update(x).digest('hex');
    for (const s of [1, 3]) {
      expect(sha(renderCalloutsSvg(scene({}, old()), s, []))).toBe(before[`svg${s}`]);
      const calls = [];
      const ctx = new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (x) => ({ width: String(x).length * 6 * s }) : (...a) => calls.push([k, ...a])),
        set: (t, k, v) => { calls.push(['set', k, v]); t[k] = v; return true; },
      });
      await drawCalloutsCanvas(ctx, scene({}, old()), s);
      expect(sha(JSON.stringify(calls))).toBe(before[`canvas${s}`]);
    }
  });
});

// The same leader in the editor overlay, the SVG export and the canvas
// (PNG/PDF), at 1x and 3x.
describe('editor, SVG and canvas draw one leader path', () => {
  const callouts = [
    card('S', 300, 300, { style: { leaderShape: 'straight', arrowhead: true } }),
    card('E', 700, 320, { offset: { x: -220, y: 60 }, style: { leaderShape: 'elbow', anchorMark: 'dot' } }),
    card('C', 520, 560, { type: 'boxed', offset: { x: 90, y: 70 }, style: { leaderShape: 'curve', anchorMark: 'ring' } }),
  ];
  const layout = { showTitle: false, showLegend: false, showNorthArrow: false, showScaleBar: false, insetEnabled: false };
  const zones = resolveTemplateZones(technicalResultsTemplate, layout, { width: 1200, height: 800 });
  const nums = (d) => d.match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);
  const near = (a, b) => {
    expect(a).toHaveLength(b.length);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  };

  function canvasLeaders(scale, algorithm) {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 6 * scale }) : (...a) => calls.push([k, ...a])),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    return drawCalloutsCanvas(ctx, { width: 1200, height: 800, template: technicalResultsTemplate, map, project: { layout: { ...layout, layoutAlgorithm: algorithm }, layers: [], callouts } }, scale).then(() => {
      // Leaders come first, each one beginPath … stroke.
      const out = [];
      let cur = null;
      for (const [k, ...a] of calls) {
        if (k === 'beginPath') cur = [];
        else if (k === 'arcTo') cur = null;
        else if (cur && ['moveTo', 'lineTo', 'quadraticCurveTo'].includes(k)) cur.push(...a);
        else if (k === 'stroke' && cur?.length) { out.push(cur); cur = null; }
      }
      return out.slice(0, callouts.length);
    });
  }

  for (const algorithm of [undefined, 2]) {
    it(`matches at 1x and 3x (layoutAlgorithm ${algorithm ?? 'absent'})`, async () => {
      const { container } = render(<CalloutsOverlay map={map} callouts={callouts} zones={zones} layout={{ ...layout, layoutAlgorithm: algorithm }} />);
      // The scored layout is a lazy chunk: wait for it to replace the fallback.
      const expected = (algorithm ? resolveScoredBoxes : resolveCalloutBoxes)(callouts, map, { obstacles: panelObstacles(zones, layout) });
      const want = expected.map((c) => nums(leaderSvgD(leaderGeometry(c.anchorPx, c, c.style?.leaderShape))));
      await waitFor(() => {
        const got = [...container.querySelectorAll('.callout-leader-svg path')].map((p) => nums(p.getAttribute('d')));
        expect(got).toEqual(want);
      });
      const editor = [...container.querySelectorAll('.callout-leader-svg path')].map((p) => nums(p.getAttribute('d')));
      expect(container.querySelectorAll('.callout-leader-svg circle')).toHaveLength(2);
      expect(container.querySelectorAll('.callout-leader-svg polygon')).toHaveLength(1);

      for (const scale of [1, 3]) {
        const svg = renderCalloutsSvg({ width: 1200, height: 800, template: technicalResultsTemplate, map, project: { layout: { ...layout, layoutAlgorithm: algorithm }, layers: [], callouts } }, scale, []);
        const leaders = svg.match(/<g id="em-callout-leaders">(.*?)<\/g>/)[1];
        const svgPaths = [...leaders.matchAll(/<(line|path) ([^>]*)\/>/g)].map(([, tag, attrs]) => (tag === 'path'
          ? nums(/(?:^| )d="([^"]+)"/.exec(attrs)[1])
          : ['x1', 'y1', 'x2', 'y2'].map((k) => Number(new RegExp(`${k}="([^"]+)"`).exec(attrs)[1]))));
        const canvas = await canvasLeaders(scale, algorithm);
        editor.forEach((d, i) => {
          const scaled = d.map((v) => v * scale);
          near(svgPaths[i], scaled);
          near(canvas[i], scaled);
        });
        // Anchor marks sit on the anchors, scaled.
        const marks = [...leaders.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)].map((m) => m.slice(1).map(Number));
        near(marks.flat(), expected.filter((c) => c.style.anchorMark).flatMap((c) => [c.anchorPx.x * scale, c.anchorPx.y * scale, anchorMark(c.style).r * scale]));
      }
    });
  }
});

describe('leader tangent on a level leader', () => {
  it('points at the end when the bend sits on the anchor', () => {
    const box = { left: 200, top: 80, width: 100, height: 40 };
    for (const shape of ['elbow', 'curve']) {
      const g = leaderGeometry({ x: 100, y: 100 }, box, shape);
      expect(leaderTangentFrom(g)).not.toEqual(g.start);
    }
  });
});
