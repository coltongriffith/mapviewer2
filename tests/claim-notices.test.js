import { describe, it, expect } from 'vitest';
import { claimNotices, rankNotices, SEVERITY } from '../src/utils/claimNotices';

// These tests pin a design decision, not a calculation.
//
// A US claim-name search used to render five warning blocks at once — roughly
// 150 words of caution wrapped around a list of claims. Each was individually
// justified; together they were banner blindness, and the one that actually
// blocked an import competed with boilerplate that is true on every search
// this product will ever run.
//
// The rule is: say the thing that changed, keep the thing that did not one
// click away. What must never regress is that nothing gets DELETED — a
// collapsed notice still carries its full text, and the loudest thing on the
// panel is still the one asking for a decision.

const scoping = { short: 'Approximate state scoping', detail: 'Selected by administering BLM office…' };
const adoption = { message: 'Showing Nevada — no BC claims found', rankedBy: 'area' };

describe('claimNotices', () => {
  it('says nothing at all when there are no results', () => {
    // An empty result set has its own message. Stacking provenance boilerplate
    // on top of "we found nothing" is pure noise.
    expect(claimNotices({ hasResults: false, isUs: true, scoping })).toEqual([]);
  });

  it('marks the claim-name match as blocking', () => {
    const [n] = claimNotices({ hasResults: true, nameMatched: true });
    expect(n.severity).toBe(SEVERITY.BLOCKING);
  });

  it('files degraded scoping as accuracy — it is true of THIS result set', () => {
    const n = claimNotices({ hasResults: true, scoping }).find((x) => x.id === 'scoping');
    expect(n.severity).toBe(SEVERITY.ACCURACY);
    expect(n.detail).toBe(scoping.detail);   // full wording preserved
  });

  it('files the geometry disclaimer as provenance — true of every US search', () => {
    const n = claimNotices({ hasResults: true, isUs: true }).find((x) => x.id === 'geometry');
    expect(n.severity).toBe(SEVERITY.PROVENANCE);
  });

  it('keeps the auto-adopted jurisdiction attributable', () => {
    const n = claimNotices({ hasResults: true, adoption }).find((x) => x.id === 'adoption');
    expect(n.short).toMatch(/Showing Nevada/);
    expect(n.detail).toMatch(/stays on the layer/);
  });
});

describe('rankNotices', () => {
  it('expands exactly one accuracy notice and collapses the rest', () => {
    const { expanded, collapsed } = rankNotices(
      claimNotices({ hasResults: true, isUs: true, scoping, adoption }),
    );
    expect(expanded).toHaveLength(1);
    expect(expanded[0].id).toBe('scoping');
    expect(collapsed.map((n) => n.id).sort()).toEqual(['adoption', 'geometry']);
  });

  it('lets a blocking notice own the panel alone', () => {
    // When something needs a decision, nothing expands beside it — otherwise
    // the decision competes with a disclaimer that has been true all along.
    const { expanded, collapsed } = rankNotices(
      claimNotices({ hasResults: true, isUs: true, nameMatched: true, scoping }),
    );
    expect(expanded.map((n) => n.id)).toEqual(['name-match']);
    expect(collapsed.map((n) => n.id)).toContain('scoping');
  });

  it('never expands standing provenance on its own', () => {
    // The generalized-geometry disclaimer is true of every US search ever run.
    // A banner that never changes is one users stop seeing.
    const { expanded, collapsed } = rankNotices(claimNotices({ hasResults: true, isUs: true }));
    expect(expanded).toEqual([]);
    expect(collapsed.map((n) => n.id)).toEqual(['geometry']);
  });

  it('loses nothing — every notice is still present somewhere', () => {
    // The property that matters. Collapsing is a layout decision; it must never
    // become a deletion, because these maps go into filings.
    const all = claimNotices({ hasResults: true, isUs: true, scoping, adoption, nameMatched: true });
    const { expanded, collapsed } = rankNotices(all);
    expect([...expanded, ...collapsed].map((n) => n.id).sort())
      .toEqual(all.map((n) => n.id).sort());
  });

  it('is stable regardless of input order', () => {
    const a = rankNotices(claimNotices({ hasResults: true, isUs: true, scoping, adoption }));
    const b = rankNotices([...claimNotices({ hasResults: true, isUs: true, scoping, adoption })].reverse());
    expect(b.expanded.map((n) => n.id)).toEqual(a.expanded.map((n) => n.id));
  });
});
