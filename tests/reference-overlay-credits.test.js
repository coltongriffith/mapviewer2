import { describe, it, expect } from 'vitest';
import { referenceOverlayCredits, overlayCreditLine, OVERLAY_DESCRIPTIONS } from '../src/utils/referenceOverlayCredits.js';
import { REFERENCE_OVERLAY_CONFIG, REFERENCE_OVERLAY_KEYS, overlayAttribution } from '../src/utils/referenceOverlayConfig.js';

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
    const all = referenceOverlayCredits(Object.fromEntries(REFERENCE_OVERLAY_KEYS.map((k) => [k, true])));
    expect(all).toHaveLength(REFERENCE_OVERLAY_KEYS.length);
    all.forEach((line) => expect(line.length).toBeGreaterThan(10));
  });

  it('keeps the lines short enough for 7.5px margin type', () => {
    const all = referenceOverlayCredits(Object.fromEntries(REFERENCE_OVERLAY_KEYS.map((k) => [k, true])));
    all.forEach((line) => expect(line.length).toBeLessThan(110));
  });

  // Anchored to the tile HOST, which is the one fact that cannot be edited to
  // match a wrong credit.
  //
  // This is the reported defect: the two CARTO-hosted layers were credited to
  // "OpenStreetMap" alone, so CARTO went uncredited in precisely the artifact
  // the credits exist to produce. Checking the credit against the `parties`
  // list would NOT have caught it — the export and the Leaflet control both
  // derive from that list, so dropping a name there changes both together and
  // every such assertion stays green. The URL is independent of both.
  const HOST_REQUIRES = [
    { host: /cartocdn\.com/, parties: ['CARTO', 'OpenStreetMap'] },
    { host: /openrailwaymap\.org/, parties: ['OpenRailwayMap', 'OpenStreetMap'] },
    { host: /mrdata\.usgs\.gov/, parties: ['USGS'] },
  ];

  it.each(REFERENCE_OVERLAY_KEYS)('credits whoever actually serves the tiles — %s', (key) => {
    const url = REFERENCE_OVERLAY_CONFIG[key].url || '';
    const rule = HOST_REQUIRES.find((r) => r.host.test(url));
    expect(rule, `no attribution rule covers ${url} — add one when adding an overlay`).toBeTruthy();
    const line = overlayCreditLine(key);
    rule.parties.forEach((party) => {
      expect(line, `${key} is served from ${url} but its export credit omits "${party}"`).toContain(party);
    });
  });

  it('gives the map control the same names as the export', () => {
    // Narrower than it looks — both sides read one list, so this guards the two
    // derivations rather than the data. The host rules above guard the data.
    REFERENCE_OVERLAY_KEYS.forEach((key) => {
      const attribution = overlayAttribution(key);
      const line = overlayCreditLine(key);
      REFERENCE_OVERLAY_CONFIG[key].parties.forEach((party) => {
        expect(attribution, `${key}: map control omits ${party}`).toContain(party);
        expect(line, `${key}: export omits ${party}`).toContain(party);
      });
    });
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
