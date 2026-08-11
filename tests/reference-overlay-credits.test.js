import { describe, it, expect } from 'vitest';
import { referenceOverlayCredits, OVERLAY_DESCRIPTIONS, OVERLAY_CREDITS } from '../src/utils/referenceOverlayCredits.js';

// A viewer handed a finished map saw coloured shapes under the claims with no
// way to learn what they were: the toggle is in the editor, Leaflet's
// attribution control is not part of an export, and the legend lists only the
// author's own layers. Reported as "it's cool to have the bedrock overlayed but
// as a reader I don't even know what that is".
//
// It was also an attribution gap — these are third-party services whose
// licences require credit, and an exported PNG or SVG carried none.

describe('referenceOverlayCredits', () => {
  it('says nothing when no overlay is on', () => {
    expect(referenceOverlayCredits({})).toEqual([]);
    expect(referenceOverlayCredits(null)).toEqual([]);
    expect(referenceOverlayCredits(undefined)).toEqual([]);
  });

  it('credits only the overlays actually enabled', () => {
    const lines = referenceOverlayCredits({ geology: true, rail: false, context: false });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/bedrock geology/i);
  });

  it('names both what the colours are and who publishes them', () => {
    const [line] = referenceOverlayCredits({ geology: true });
    // The two things a reader needs: what am I looking at, and says who.
    expect(line).toMatch(/coloured units/i);
    expect(line).toMatch(/USGS/);
    expect(line).toMatch(/Geological Survey of Canada/);
  });

  it('ignores an unknown overlay key rather than emitting a blank line', () => {
    // A blank credit would still take a row of margin and look like a defect.
    expect(referenceOverlayCredits({ somethingNew: true })).toEqual([]);
  });

  it('keeps a stable order regardless of which toggle was flipped last', () => {
    const a = referenceOverlayCredits({ rail: true, geology: true, context: true });
    const b = referenceOverlayCredits({ context: true, geology: true, rail: true });
    expect(a).toEqual(b);
    expect(a[0]).toMatch(/bedrock geology/i);
  });

  it('credits every overlay the app can switch on', () => {
    // A new overlay shipping without attribution is the failure this guards:
    // the geology layer did exactly that.
    const all = referenceOverlayCredits({ geology: true, context: true, labels: true, rail: true });
    expect(all).toHaveLength(Object.keys(OVERLAY_CREDITS).length);
    all.forEach((line) => expect(line.length).toBeGreaterThan(10));
  });

  it('keeps the lines short enough for 7.5px margin type', () => {
    const all = referenceOverlayCredits({ geology: true, context: true, labels: true, rail: true });
    all.forEach((line) => expect(line.length).toBeLessThan(110));
  });
});

describe('OVERLAY_DESCRIPTIONS', () => {
  it('tells the editor what the geology overlay is and what it is not', () => {
    const text = OVERLAY_DESCRIPTIONS.geology;
    expect(text).toMatch(/rock units/i);
    // Honesty about resolution: it is a world compilation, and reading it as
    // property-scale mapping would be a real misuse.
    expect(text).toMatch(/regional|not property-scale/i);
  });
});
