import { describe, expect, it } from 'vitest';
import { createAgentMapProject } from '../shared/agentMapBuilder.js';

const fc = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { OWNER_NAME: 'Example Mining Corp', TAG_NUMBER: '123456' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-120, 50], [-119.9, 50], [-119.9, 50.1], [-120, 50.1], [-120, 50]]],
      },
    },
  ],
  meta: { provider: 'fixture' },
};

describe('agent map builder', () => {
  it('creates a normal ExplorationMaps project payload', () => {
    const project = createAgentMapProject({
      map_type: 'claims',
      title: 'Copper Creek Project',
      subtitle: null,
      jurisdiction: 'bc',
      search: { type: 'company', query: 'Example Mining Corp' },
      location: { bbox: null },
      include: ['claims', 'roads', 'settlements', 'rail'],
      style: 'investor_clean',
      company: { name: 'Example Mining Corp' },
    }, {
      featureCollection: fc,
      source: 'BC Mineral Titles',
    });

    expect(project.layout.title).toBe('Copper Creek Project');
    expect(project.layout.mode).toBe('regional_claims');
    expect(project.layout.themeId).toBe('investor_clean');
    expect(project.layout.referenceOverlays.context).toBe(true);
    expect(project.layout.referenceOverlays.rail).toBe(true);
    expect(project.layers).toHaveLength(1);
    expect(project.layers[0].role).toBe('claims');
    expect(project.layers[0].geojson.features).toHaveLength(1);
    expect(project.layers[0].provenance.source).toBe('BC Mineral Titles');
    expect(project.layout.primaryLayerId).toBe(project.layers[0].id);
  });

  it('applies the existing infrastructure template/mode', () => {
    const project = createAgentMapProject({
      map_type: 'infrastructure',
      title: 'Access Map',
      jurisdiction: 'bc',
      search: { type: 'company', query: 'Example Mining Corp' },
      location: { bbox: null },
      include: ['claims', 'roads', 'settlements', 'geology'],
      style: 'investor_clean',
      company: { name: null },
    }, { featureCollection: fc });

    expect(project.layout.mode).toBe('access_location');
    expect(project.layout.referenceOverlays.context).toBe(true);
    expect(project.layout.referenceOverlays.geology).toBe(true);
  });
});
