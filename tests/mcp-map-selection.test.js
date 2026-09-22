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
});
