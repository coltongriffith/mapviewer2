import { describe, expect, it } from 'vitest';
import { resolveMapClaims } from '../api/_lib/map-claims.js';
import { claimSummary } from '../shared/claimData.js';
import { validateCreateMapInput } from '../shared/agentSchema.js';
import { createAgentMapProject } from '../shared/agentMapBuilder.js';

function feature(number, holder, lng) {
  return {
    type: 'Feature',
    properties: { TENURE_NUMBER_ID: number, OWNER_NAME: holder, FEATURE_AREA_SQM: 10000 },
    geometry: { type: 'Polygon', coordinates: [[[lng, 55], [lng + 0.01, 55], [lng + 0.01, 55.01], [lng, 55.01], [lng, 55]]] },
  };
}

const primary = feature(71071, 'Star Copper', -130);
const otherProject = feature(235433, 'Star Copper', -128);
const neighbour = feature(900001, 'Other Mining', -129.99);

describe('MCP map selection', () => {
  it('intersects company search with the requested bbox and separates neighbours', async () => {
    const calls = [];
    const search = async (args) => {
      calls.push(args);
      return { type: 'FeatureCollection', features: args.bbox ? [primary, neighbour] : [primary, otherProject] };
    };
    const result = await resolveMapClaims({ jurisdiction: 'bc', search: { query: 'Star Copper', type: 'company' }, location: { bbox: [-130.1, 54.9, -129.8, 55.2] }, claim_numbers: [], neighbours: { show: true } }, search, 'test');
    expect(calls).toHaveLength(2);
    expect(result.primary.features.map((item) => item.properties.TENURE_NUMBER_ID)).toEqual([71071]);
    expect(result.neighbours.features.map((item) => item.properties.TENURE_NUMBER_ID)).toEqual([900001]);
  });

  it('rejects missing exact claim numbers instead of silently drawing a different project', async () => {
    await expect(resolveMapClaims({ jurisdiction: 'bc', search: { query: null, type: 'company' }, location: { bbox: [-130.1, 54.9, -129.8, 55.2] }, claim_numbers: ['71071', '235433'], neighbours: { show: true } }, async () => ({ type: 'FeatureCollection', features: [primary, neighbour] }), 'test'))
      .rejects.toThrow(/235433/);
  });

  it('returns string identifiers, calculated area and centroid', () => {
    const summary = claimSummary(primary);
    expect(summary.claim_number).toBe('71071');
    expect(summary.area_hectares).toBe(1);
    expect(summary.centroid.lat).toBeCloseTo(55.005, 2);
  });

  it('builds a distinct muted neighbour layer, branded primary layer and project callout', () => {
    const checked = validateCreateMapInput({
      map_type: 'investor', title: 'Star Project', jurisdiction: 'bc', claim_numbers: ['71071'],
      basemap: 'satellite', inset: { basemap: 'white' }, include: 'all',
      branding: { primary_color: '#B87333' }, facts_panel: { project: 'Star Project', claims: 1 },
    });
    expect(checked.ok).toBe(true);
    const project = createAgentMapProject(checked.value, { featureCollection: { type: 'FeatureCollection', features: [primary] }, neighbours: { type: 'FeatureCollection', features: [neighbour] }, source: 'BC Mineral Titles' });
    expect(project.layers).toHaveLength(2);
    expect(project.layers[1].style.stroke).toBe('#B87333');
    expect(project.layers[0].style.dashArray).toBe('4 4');
    expect(project.layout.basemap).toBe('satellite');
    expect(project.layout.insetBasemap).toBe('white');
    expect(project.layout.referenceOverlays.geology).toBe(false);
    expect(project.callouts[0].text).toBe('Star Project');
  });

  it('keeps neighbours out of the frame, and the inset mode in step with the inset basemap', () => {
    const build = (body) => {
      const checked = validateCreateMapInput({ jurisdiction: 'bc', claim_numbers: ['71071'], ...body });
      return createAgentMapProject(checked.value, { featureCollection: { type: 'FeatureCollection', features: [primary] }, neighbours: { type: 'FeatureCollection', features: [neighbour] } });
    };
    const investor = build({ map_type: 'investor' });
    expect(investor.layers[0].focus).toBe(false);
    expect(investor.layers[1].focus).toBeUndefined();
    expect(investor.layout.insetMode).toBe('satellite_locator');
    expect(build({ map_type: 'claims' }).layout.insetMode).toBe('province_state');
    expect(build({ map_type: 'investor', inset: { basemap: 'white' } }).layout.insetMode).toBe('province_state');
  });

  it("fits 'all' overlays to the basemap and honours an explicit list", () => {
    const include = (body) => validateCreateMapInput({ jurisdiction: 'bc', claim_numbers: ['71071'], include: 'all', ...body }).value.include;
    // The roads/settlements overlay is an opaque street map: never over imagery, relief or topo by default.
    expect(include({ basemap: 'satellite' })).toEqual(['claims', 'labels', 'rail']);
    expect(include({ basemap: 'terrain' })).toEqual(['claims', 'labels', 'rail', 'geology']);
    expect(include({ basemap: 'white' })).toEqual(['claims', 'roads', 'settlements', 'labels', 'rail', 'geology']);
    expect(include({ basemap: 'satellite', include: ['claims', 'roads'] })).toEqual(['claims', 'roads']);
  });

  it('draws published facts in the project callout, which the editor and export also render', () => {
    const checked = validateCreateMapInput({
      jurisdiction: 'bc', claim_numbers: ['71071'],
      facts_panel: { project: 'Star', commodity: 'Copper', claims: 1, hectares: 1234.4, tickers: ['TSXV: STR'] },
      claims_callout: { source_note: 'Company release, 2026' },
    });
    const project = createAgentMapProject(checked.value, { featureCollection: { type: 'FeatureCollection', features: [primary] } });
    expect(project.layout.factsPanel).toBeUndefined();
    expect(project.callouts[0].text).toBe('Star');
    expect(project.callouts[0].subtext).toBe('Commodity: Copper\nClaims: 1 (1,234 ha)\nTSXV: STR\nCompany release, 2026');
  });

  it('reports the B.C. tenure number, not the staking tag, as the claim number', () => {
    const tagged = { ...primary, properties: { ...primary.properties, TAG_NUMBER: '716678M' } };
    expect(claimSummary(tagged).claim_number).toBe('71071');
  });

  it('keeps only documented, clipped facts and callout fields', () => {
    const checked = validateCreateMapInput({
      jurisdiction: 'bc', claim_numbers: ['71071'],
      facts_panel: { project: { nested: true }, commodity: 'Copper', claims: 3, hectares: 'lots', tickers: ['ABC', 7, ''], injected: 'x' },
      claims_callout: { fields: { status: 'Active', bad: { a: 1 } }, style: 'weird', source_note: 42 },
    });
    expect(checked.ok).toBe(true);
    expect(checked.value.facts_panel).toEqual({ commodity: 'Copper', claims: 3, tickers: ['ABC'] });
    expect(checked.value.claims_callout).toEqual({ show: true, fields: { status: 'Active' }, source_note: null, style: 'brand' });
  });
});

describe('MCP map selection lookup', () => {
  const input = (ids) => ({ jurisdiction: 'bc', search: { query: 'Star Copper', type: 'company' }, location: {}, claim_numbers: ids, neighbours: { show: false } });

  it('looks requested claims up by number instead of re-running a large company search', async () => {
    const calls = [];
    const search = async (args) => {
      calls.push(args);
      return { type: 'FeatureCollection', features: args.type === 'number' ? [primary] : [primary, otherProject] };
    };
    const result = await resolveMapClaims(input(['71071']), search, 'test');
    expect(calls.map((c) => c.type)).toEqual(['number']);
    expect(result.primary.features.map((f) => f.properties.TENURE_NUMBER_ID)).toEqual([71071]);
  });

  it('falls back to the company search when a number lookup misses or fails', async () => {
    const calls = [];
    const search = async (args) => {
      calls.push(args.type);
      if (args.type === 'number') return { type: 'FeatureCollection', features: [] };
      return { type: 'FeatureCollection', features: [primary, otherProject] };
    };
    const result = await resolveMapClaims(input(['71071']), search, 'test');
    expect(calls).toEqual(['number', 'company']);
    expect(result.primary.features).toHaveLength(1);

    const failing = async (args) => {
      if (args.type === 'number') throw new Error('registry down');
      return { type: 'FeatureCollection', features: [primary] };
    };
    expect((await resolveMapClaims(input(['71071']), failing, 'test')).primary.features).toHaveLength(1);
  });

  it('keeps the company search for long claim lists', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => String(71071 + i));
    const calls = [];
    const search = async (args) => { calls.push(args.type); return { type: 'FeatureCollection', features: [] }; };
    await expect(resolveMapClaims(input(ids), search, 'test')).rejects.toThrow(/missing/);
    expect(calls).toEqual(['company']);
  });
});

describe('MCP map selection share budget', () => {
  const bulky = (number, lng) => {
    const f = feature(number, 'Star Copper', lng);
    return { ...f, properties: { ...f.properties, NOTE: 'x'.repeat(2000), EMPTY: null, BLANK: '' } };
  };

  it('drops empty registry fields and rounds coordinates to six places', async () => {
    const f = feature(71071, 'Star Copper', -130.123456789);
    const withEmpty = { ...f, properties: { ...f.properties, EMPTY: null, BLANK: '' } };
    const result = await resolveMapClaims({ jurisdiction: 'bc', search: { query: 'Star Copper', type: 'company' }, location: {}, claim_numbers: [], neighbours: { show: false } }, async () => ({ type: 'FeatureCollection', features: [withEmpty] }), 'test');
    const [out] = result.primary.features;
    expect(out.properties).toEqual({ TENURE_NUMBER_ID: 71071, OWNER_NAME: 'Star Copper', FEATURE_AREA_SQM: 10000 });
    expect(out.geometry.coordinates[0][0]).toEqual([-130.123457, 55]);
    expect(result.oversize).toBe(false);
  });

  it('gives neighbours only the room the selected claims leave, and flags a set too large to share', async () => {
    const many = (count, start, lng) => Array.from({ length: count }, (_, i) => bulky(start + i, lng + i * 0.001));
    const run = (primaryCount) => resolveMapClaims(
      { jurisdiction: 'bc', search: { query: 'Star Copper', type: 'company' }, location: {}, claim_numbers: [], neighbours: { show: true } },
      async (args) => ({ type: 'FeatureCollection', features: args.bbox ? many(100, 900000, -129) : many(primaryCount, 1, -130) }),
      'test',
    );
    const roomy = await run(10);
    expect(roomy.neighbours.features).toHaveLength(100);
    const tight = await run(700);
    expect(tight.oversize).toBe(false);
    expect(tight.neighbours.features.length).toBeLessThan(100);
    expect(tight.neighboursWarning).toMatch(/limited/);
    let lookups = 0;
    const full = await resolveMapClaims(
      { jurisdiction: 'bc', search: { query: 'Star Copper', type: 'company' }, location: {}, claim_numbers: [], neighbours: { show: true } },
      async (args) => { if (args.bbox) lookups += 1; return { type: 'FeatureCollection', features: many(900, 1, -130) }; },
      'test',
    );
    expect(full.oversize).toBe(true);
    expect(lookups).toBe(0);
  });
});
