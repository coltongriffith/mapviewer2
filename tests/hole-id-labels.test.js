import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { autoArrangeCallouts, resolveScoredBoxes, boxDistance, isIdLabel } from '../src/utils/calloutScorer.js';
import { panelObstacles, intersects } from '../src/utils/calloutLayout.js';
import { renderCalloutsSvg } from '../src/export/renderScene.js';
import { resolveTemplateZones, technicalResultsTemplate } from '../src/templates/technicalResultsTemplate.js';
import { createInitialProjectState } from '../shared/projectState.js';
import { collars, planMap, planCallouts, holeIdCallout, STAGE } from './fixtures/dense-drill-plan.js';

// Hole-ID labels in a dense 2D drill plan (layoutAlgorithm 3). The report: the
// automatic labels sat 100–200 m from their holes, sometimes beside the wrong
// one. Layout 2 placed a hole ID like an intercept card — a 188 px box tried
// up to 180 px out, where covering any collar cost far more than distance —
// so on a plan with collars ~40 px apart it took the nearest empty ground.

beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });

const map = planMap();
// legendFit off: the hashes below were recorded with the legend sized as before new maps fitted it (a saved map).
const layout = { ...createInitialProjectState().layout, legendFit: undefined, legendItems: [{ id: 'collars', label: 'Drill collars' }] };
const obstacles = panelObstacles(resolveTemplateZones(technicalResultsTemplate, layout, STAGE), layout);
const collarPx = collars.map((c) => ({ id: c.hole_id, ...map.latLngToContainerPoint([c.lat, c.lng]) }));
const NEAR = 20; // px: a label's edge this close to its collar needs no leader
const hasLeader = (c) => c.type === 'leader' || c.type === 'boxed' || !!c.pushLeader;

// Each hole-ID label: its gap to its own collar and to the nearest other one.
function audit(placed) {
  return placed.filter((c) => c.id.startsWith('id-')).map((c) => {
    const own = collarPx.find((p) => `id-${p.id}` === c.id);
    const others = collarPx.filter((p) => p !== own).map((p) => boxDistance(c, p));
    return { id: c.id, own: boxDistance(c, own), other: Math.min(...others), leader: hasLeader(c), collides: c.collidesWith || null };
  });
}
const arrange = (callouts, algorithm) => resolveScoredBoxes(autoArrangeCallouts(callouts, map, { obstacles, algorithm }), map, { obstacles, algorithm });
const plain = () => planCallouts().map((c) => (c.id.startsWith('id-') ? { ...c, type: 'plain' } : c));

describe('hole-ID labels in a dense drill plan', () => {
  it('the fixture is dense: 39 collars, the nearest neighbour ~40 px away at 2 m/px', () => {
    expect(collars).toHaveLength(39);
    const nn = collarPx.map((p) => Math.min(...collarPx.filter((q) => q !== p).map((q) => Math.hypot(p.x - q.x, p.y - q.y)))).sort((a, b) => a - b);
    expect(nn[19]).toBeLessThan(50);
    expect(planCallouts().filter(isIdLabel)).toHaveLength(39);
  });

  it('layout 2 (before): labels far from their holes, many nearer another hole', () => {
    const rows = audit(arrange(planCallouts(), 2));
    expect(Math.max(...rows.map((r) => r.own))).toBeGreaterThan(90); // > 180 m
    expect(rows.filter((r) => r.other < r.own).length).toBeGreaterThan(20);
  });

  for (const [name, callouts] of [['leader labels', planCallouts], ['plain labels', plain]]) {
    it(`layout 3, ${name}: every label at its own collar, never nearer another`, () => {
      const placed = arrange(callouts(), 3);
      const rows = audit(placed);
      expect(rows).toHaveLength(39);
      for (const r of rows) {
        // Within NEAR px of its own collar, or attached by a leader.
        expect(r.own <= NEAR || r.leader, `${r.id} ${r.own.toFixed(1)} px out with no leader`).toBe(true);
        // Clear of its own collar symbol (12 px), and nearer it than any other.
        expect(r.own, r.id).toBeGreaterThanOrEqual(6);
        expect(r.other, `${r.id} is nearer another collar`).toBeGreaterThan(r.own);
        expect(r.collides, r.id).toBeNull();
      }
      // On this plan every hole fits beside its collar: no leader needed.
      expect(Math.max(...rows.map((r) => r.own))).toBeLessThanOrEqual(NEAR);
      // Placed ID labels are hard obstacles: no intercept card lies over one.
      const ids = placed.filter((c) => c.id.startsWith('id-'));
      const overlaps = placed.filter((c) => c.id.startsWith('int-')).flatMap((c) => ids.filter((l) => intersects(c, l, -1)).map((l) => `${c.id} over ${l.id}`));
      expect(overlaps).toEqual([]);
      // Sized to its text, not a 188 px card.
      expect(Math.max(...placed.filter((c) => c.id.startsWith('id-')).map((c) => c.width))).toBeLessThan(100);
    });
  }

  it('is deterministic and leaves its input alone', () => {
    const input = planCallouts();
    const snapshot = JSON.stringify(input);
    const a = autoArrangeCallouts(input, map, { obstacles });
    expect(autoArrangeCallouts(planCallouts(), map, { obstacles })).toEqual(a);
    expect(resolveScoredBoxes(a, map, { obstacles, algorithm: 3 })).toEqual(resolveScoredBoxes(a, map, { obstacles, algorithm: 3 }));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('keeps a pinned label exactly where the user put it', () => {
    const input = planCallouts().map((c) => (c.id === 'id-RN-25-012' ? { ...c, isManualPosition: true, offset: { x: -140, y: 55 } } : c));
    const pinned = input.find((c) => c.isManualPosition);
    const arranged = autoArrangeCallouts(input, map, { obstacles });
    expect(arranged.find((c) => c.id === pinned.id)).toBe(pinned);
    const p = resolveScoredBoxes(arranged, map, { obstacles, algorithm: 3 }).find((c) => c.id === pinned.id);
    const at = map.latLngToContainerPoint([pinned.anchor.lat, pinned.anchor.lng]);
    expect([p.left, p.top]).toEqual([at.x - 140, at.y + 55]);
  });

  it('a project saved on layout 2 keeps layout 2 exactly', () => {
    // Recorded from origin/main (before layout 3) for this fixture.
    const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
    const a = autoArrangeCallouts(planCallouts(), map, { obstacles, algorithm: 2 });
    expect(sha(a)).toBe('29ab4af0e09e9e0b6ee075c598c9c9a4f973eff489a09c20667db37f6bbd3873');
    expect(sha(resolveScoredBoxes(a, map, { obstacles, algorithm: 2 }))).toBe('8d0cad2a05bcf4c6f49b25246488248afdfe56799ffbe24187d67efb0bfb5384');
    expect(sha(resolveScoredBoxes(planCallouts(), map, { obstacles, algorithm: 2 }))).toBe('177012ad9516c8d1427c14855d678f3f3434e71db2c9de15ca1414c5340331e3');
  });
});

describe('layout 3 when a label cannot sit at its collar', () => {
  // A collar boxed in by panels on every side: no spot within NEAR px is free.
  const m = { getSize: () => ({ x: 800, y: 600 }), latLngToContainerPoint: ([lat, lng]) => ({ x: lng, y: lat }), on() {}, off() {}, getContainer: () => null };
  const hole = holeIdCallout({ hole_id: 'DDH-1', lat: 300, lng: 400 });
  const box = (key, left, top, width, height) => ({ key, left, top, width, height });
  const ring = [box('N', 330, 250, 140, 40), box('S', 330, 310, 140, 40), box('W', 330, 290, 62, 20), box('E', 408, 290, 62, 20)];

  it('pushes it out on a leader that starts at its own collar (a plain label gets one)', () => {
    const label = resolveScoredBoxes(autoArrangeCallouts([{ ...hole, type: 'plain' }], m, { obstacles: ring }), m, { obstacles: ring, algorithm: 3 })[0];
    expect(boxDistance(label, { x: 400, y: 300 })).toBeGreaterThan(NEAR);
    expect(label.pushLeader).toBe(true);
    expect(label.collidesWith).toBeUndefined();
    // The SVG export draws that leader, from the collar.
    const saved = { ...hole, type: 'plain', offset: { x: label.left - 400, y: label.top - 300 } };
    const svg = renderCalloutsSvg({ width: 800, height: 600, template: technicalResultsTemplate, map: m, project: { layout: { showTitle: false, showLegend: false, showNorthArrow: false, showScaleBar: false, insetEnabled: false, layoutAlgorithm: 3 }, layers: [], callouts: [saved] } }, 1, []);
    const leaders = svg.match(/<g id="em-callout-leaders">(.*?)<\/g>/)[1];
    expect(leaders).toMatch(/x1="400" y1="300"|M400 300/);
    // Layout 2 draws no leader for a plain label.
    const old = renderCalloutsSvg({ width: 800, height: 600, template: technicalResultsTemplate, map: m, project: { layout: { showTitle: false, showLegend: false, showNorthArrow: false, showScaleBar: false, insetEnabled: false, layoutAlgorithm: 2 }, layers: [], callouts: [saved] } }, 1, []);
    expect(old).not.toContain('em-callout-leaders');
  });

  it('reports a label it cannot clear rather than floating it beside another hole', () => {
    // Another collar right beside DDH-1 on every side it could go.
    const crowd = [[-16, 0], [16, 0], [0, -16], [0, 16], [-12, -12], [12, 12], [-12, 12], [12, -12]].map(([dx, dy], k) => ({ ...holeIdCallout({ hole_id: `X-${k}`, lat: 300 + dy, lng: 400 + dx }), isManualPosition: true, offset: { x: 300, y: 200 } }));
    const placed = resolveScoredBoxes(autoArrangeCallouts([...crowd, hole], m), m, { algorithm: 3 });
    const label = placed.find((c) => c.id === hole.id);
    const own = boxDistance(label, { x: 400, y: 300 });
    const other = Math.min(...crowd.map((c) => boxDistance(label, { x: c.anchor.lng, y: c.anchor.lat })));
    // Every spot is nearer a neighbour than DDH-1: it says so (the editor
    // lists it under "Still overlapping", the export warns).
    expect(other).toBeLessThanOrEqual(own + 6);
    expect(label.collidesWith).toContain('too near another point');
  });

  it('leaves non-ID callouts (intercept cards, layer and neighbour labels) to layout 2 rules', () => {
    expect(isIdLabel({ text: 'RN-25-001', featureId: 'f1', type: 'plain' })).toBe(true);
    expect(isIdLabel({ text: 'RN-25-001', type: 'plain' })).toBe(false); // a layer/neighbour label
    expect(isIdLabel({ text: 'RN-25-001', subtext: '45 m @ 0.4% Cu', featureId: 'f1' })).toBe(false);
    expect(isIdLabel({ text: 'RN-25-001', featureId: 'f1', type: 'badge' })).toBe(false);
    const cards = planCallouts().filter((c) => !isIdLabel(c));
    expect(resolveScoredBoxes(cards, map, { obstacles, algorithm: 3 })).toEqual(resolveScoredBoxes(cards, map, { obstacles, algorithm: 2 }));
  });
});
