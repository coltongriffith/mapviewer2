import { describe, expect, it } from 'vitest';
import { capabilities, validateCreateMapInput } from '../shared/agentSchema.js';

describe('agent map schema', () => {
  it('normalizes a simple company claim-map request', () => {
    const result = validateCreateMapInput({
      map_type: 'claims',
      title: 'Copper Creek Project',
      jurisdiction: 'bc',
      search: { type: 'company', query: 'Example Mining Corp' },
      include: ['claims', 'roads', 'settlements', 'rail'],
    });
    expect(result.ok).toBe(true);
    expect(result.value.search.query).toBe('Example Mining Corp');
    expect(result.value.include).toEqual(['claims', 'roads', 'settlements', 'rail']);
  });

  it('requires either a search term or bbox', () => {
    const result = validateCreateMapInput({ jurisdiction: 'bc', search: { type: 'company' } });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/search\.query|bbox/);
  });

  it('accepts direct GeoJSON for drill maps without a registry search', () => {
    const result = validateCreateMapInput({
      map_type: 'drill',
      title: 'Drill Results',
      jurisdiction: 'bc',
      data: {
        role: 'drillholes',
        source_name: 'Company drill collars',
        geojson: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { hole: 'DDH-01' }, geometry: { type: 'Point', coordinates: [-120, 50] } }],
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.value.data.role).toBe('drillholes');
    expect(result.value.data.geojson.features).toHaveLength(1);
  });

  it('rejects unsupported jurisdiction and style', () => {
    const result = validateCreateMapInput({
      jurisdiction: 'mars',
      style: 'neon',
      search: { query: 'Acme' },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/jurisdiction/);
    expect(result.errors.join(' ')).toMatch(/style/);
  });

  it('advertises mining-specific discovery language and map types', () => {
    const caps = capabilities();
    expect(caps.description.toLowerCase()).toContain('mineral exploration');
    expect(caps.map_types.map((m) => m.id)).toEqual(expect.arrayContaining(['claims', 'investor', 'drill', 'infrastructure', 'ni_43101']));
    expect(caps.jurisdictions.map((j) => j.id)).toContain('bc');
  });
});
