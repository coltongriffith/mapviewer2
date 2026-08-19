import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyResultMessage } from '../src/utils/scopingNotice.js';
import { fitProjectToTemplate } from '../src/utils/frameMapForTemplate.js';

// Tokenised owner matching and the subsidiary guidance were both correct for
// the search they were written for, and both leaked into searches they were
// not. A claim is named, not incorporated; a claim number is not a company.

describe('tokenising is for owner search only', () => {
  // `type=name` resolves cfg.nameFields — CSE_NAME, CLAIM_NAME — which are the
  // names of CLAIMS. It is a literal substring search by design, and reachable
  // from public deep links.
  const src = readFileSync('api/claims.js', 'utf8');

  it('never tokenises a claim-name search', () => {
    const branch = src.slice(src.indexOf('} else if (isStringType(field)) {'),
      src.indexOf('} else if (/^\\d+$/.test(effectiveTerm)) {'));
    expect(branch).toMatch(/type !== 'number' && type !== 'name'/);
    expect(branch).not.toMatch(/ownerSearchTokens\(effectiveTerm\)\s*;/);
  });

  it('keeps the owner variant in step with how fields are resolved', () => {
    // resolveLayerAndFields treats anything that is not number/name as owner.
    // If the two ever disagree, a request could resolve an OWNER column and
    // then match it with claim-name semantics — searching the right field the
    // wrong way, which is the hardest kind of bug to see in a result set.
    expect(src).toMatch(/const variant = type === 'number' \? 'number' : type === 'name' \? 'name' : 'owner'/);
    expect(src).toMatch(/const isOwnerSearch = type !== 'number' && type !== 'name'/);
  });
});

describe('the empty state answers the question that was asked', () => {
  const base = {
    resolution: { status: 'resolved' },
    query: 'X',
    jurisdictionLabel: 'British Columbia',
    isUs: false,
  };

  it('offers subsidiary guidance for a company search', () => {
    const msg = emptyResultMessage({ ...base, query: 'Taseko Mines', mode: 'company' });
    expect(msg.detail).toMatch(/subsidiary/i);
    expect(msg.hint).toMatch(/one distinctive word/i);
  });

  it('does not talk about subsidiaries to someone who typed a claim number', () => {
    // The regression: a failed number search told the user to try "one
    // distinctive word from the name, the subsidiary that holds the project" —
    // advice about a search they did not run, replacing the guidance that did
    // apply to them.
    const msg = emptyResultMessage({ ...base, query: '1012345', mode: 'number' });
    expect(msg.detail).toBeNull();
    expect(msg.hint).not.toMatch(/subsidiary/i);
    expect(msg.hint).toMatch(/check the number/i);
  });

  // Map-sheet search was removed: no provincial layer publishes a map sheet
  // column, so the mode could only ever error. The guidance it used to carry
  // ("check the map sheet format") pointed at a search that cannot run, so the
  // answer now leads with why rather than with how to retry.
  it('tells a map-sheet search that the search does not exist', () => {
    const msg = emptyResultMessage({ ...base, query: '082F056', mode: 'map' });
    expect(msg.headline).toMatch(/map sheet search is not available/i);
    expect(msg.hint).not.toMatch(/subsidiary/i);
    // Never advice to re-type a sheet number in a different format.
    expect(msg.hint).not.toMatch(/format/i);
  });

  it('defaults to company guidance when no mode is supplied', () => {
    // Company is the dominant mode and the one the guidance was written for;
    // an omitted mode must not silently drop it.
    expect(emptyResultMessage({ ...base, mode: undefined }).detail).toMatch(/subsidiary/i);
  });

  it('still separates unresolved from genuinely empty', () => {
    const msg = emptyResultMessage({
      resolution: { status: 'unresolved', reason: 'no_claimant_field' },
      query: 'X', jurisdictionLabel: 'Nevada', isUs: true, mode: 'company',
    });
    expect(msg.kind).toBe('unresolved');
  });
});

describe('Refit Map still frames what is left on screen', () => {
  const cell = (lng, lat, id) => ({
    type: 'Feature',
    properties: { TENURE_NUMBER_ID: id },
    geometry: { type: 'Polygon', coordinates: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat]]] },
  });

  // Enough of a Leaflet map for fitProjectToTemplate to act on.
  const fakeMap = () => {
    const calls = [];
    return {
      calls,
      getSize: () => ({ x: 1000, y: 700 }),
      getZoom: () => 10,
      getMinZoom: () => 0,
      getMaxZoom: () => 20,
      getCenter: () => ({ lat: 55, lng: -120 }),
      getBoundsZoom: () => 11,
      project: (ll) => ({ x: ll.lng * 100, y: ll.lat * 100 }),
      unproject: (p) => ({ lat: p.y / 100, lng: p.x / 100 }),
      setView: (...a) => calls.push(['setView', ...a]),
      fitBounds: (...a) => calls.push(['fitBounds', ...a]),
    };
  };

  it('frames the roads layer when every claim has been trimmed away', () => {
    // The dead end: a fully trimmed claims layer is still `visible` and still
    // has a geojson, so it was chosen as the focus layer and produced invalid
    // bounds — and Refit Map returned without framing anything, while the
    // roads layer sat on screen.
    const project = {
      layers: [
        {
          id: 'claims', role: 'claims', visible: true,
          geojson: { type: 'FeatureCollection', features: [cell(-120, 55, 1)] },
          featureOverrides: { 'TENURE_NUMBER_ID:1': { hidden: true } },
        },
        {
          id: 'roads', role: 'other', visible: true,
          geojson: { type: 'FeatureCollection', features: [cell(-121, 54, 2)] },
        },
      ],
      layout: {},
    };
    const map = fakeMap();
    fitProjectToTemplate(project, map, { zones: {} }, 'balanced', { focusRoles: true });
    expect(map.calls.length, 'Refit Map did nothing at all').toBeGreaterThan(0);
  });

  it('still prefers the claims layer when it has features left', () => {
    const project = {
      layers: [
        {
          id: 'claims', role: 'claims', visible: true,
          geojson: { type: 'FeatureCollection', features: [cell(-120, 55, 1), cell(-120.02, 55, 2)] },
          featureOverrides: { 'TENURE_NUMBER_ID:2': { hidden: true } },
        },
      ],
      layout: {},
    };
    const map = fakeMap();
    fitProjectToTemplate(project, map, { zones: {} }, 'balanced', { focusRoles: true });
    expect(map.calls.length).toBeGreaterThan(0);
  });

  it('does nothing when there is genuinely nothing on the map', () => {
    const project = {
      layers: [{
        id: 'claims', role: 'claims', visible: true,
        geojson: { type: 'FeatureCollection', features: [cell(-120, 55, 1)] },
        featureOverrides: { 'TENURE_NUMBER_ID:1': { hidden: true } },
      }],
      layout: {},
    };
    const map = fakeMap();
    fitProjectToTemplate(project, map, { zones: {} }, 'balanced', { focusRoles: true });
    expect(map.calls).toHaveLength(0);
  });
});
