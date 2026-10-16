import { describe, it, expect } from 'vitest';
import {
  isoDate, daysUntil, expiryBand, daysLeftText, displayName, registryFor,
  normalizeClaims, claimGroups, summarize, commonHolder, handoffProject,
} from '../src/utils/mobileClaims.js';

const NOW = new Date(Date.UTC(2026, 9, 16));
const square = (lng, lat) => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]]] });
const feature = (properties, lng = -128, lat = 56) => ({ type: 'Feature', geometry: square(lng, lat), properties });

describe('dates', () => {
  it('reads the registry date forms', () => {
    expect(isoDate('2027-04-11')).toBe('2027-04-11');
    expect(isoDate('2027-04-11T00:00:00Z')).toBe('2027-04-11');
    expect(isoDate(Date.UTC(2027, 3, 11))).toBe('2027-04-11');
    expect(isoDate('')).toBeNull();
    expect(isoDate('not a date')).toBeNull();
  });

  it('counts whole days and bands them', () => {
    expect(daysUntil('2027-04-11', NOW)).toBe(177);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(expiryBand(-1)).toBe('expired');
    expect(expiryBand(0)).toBe('urgent');
    expect(expiryBand(90)).toBe('urgent');
    expect(expiryBand(91)).toBe('soon');
    expect(expiryBand(365)).toBe('soon');
    expect(expiryBand(366)).toBe('later');
    expect(expiryBand(null)).toBe('unknown');
  });

  it('says how long is left in words', () => {
    expect(daysLeftText(177)).toBe('177 days left');
    expect(daysLeftText(1)).toBe('1 day left');
    expect(daysLeftText(0)).toBe('due today');
    expect(daysLeftText(-3)).toBe('expired 3 days ago');
    expect(daysLeftText(2747)).toBe('7.5 years left');
  });
});

describe('names and registries', () => {
  it('title-cases names the registry stores in capitals only', () => {
    expect(displayName('BRIXTON METALS CORPORATION')).toBe('Brixton Metals Corporation');
    expect(displayName('EXAMPLE MINING LTD.')).toBe('Example Mining Ltd.');
    expect(displayName('Teck Resources Limited')).toBe('Teck Resources Limited');
    expect(displayName('')).toBe('');
  });

  it('links a province to the registry a reader can check', () => {
    expect(registryFor('BC')).toMatchObject({ label: 'British Columbia', registry: 'Mineral Titles Online', url: expect.stringContaining('mtonline.gov.bc.ca') });
    expect(registryFor('on').url).toContain('viewer=MLAS.MLAS');
    expect(registryFor('sk').url).toBeNull();
    expect(registryFor('us-nv')).toMatchObject({ label: 'Nevada', registry: 'BLM MLRS' });
    expect(registryFor('zz')).toBeNull();
  });
});

describe('normalizeClaims', () => {
  it('reads registry search fields', () => {
    const layer = {
      id: 'a',
      provenance: { province: 'bc' },
      geojson: { features: [feature({ TENURE_NUMBER_ID: 394474, CLAIM_NAME: 'YJ 2', OWNER_NAME: 'BRIXTON METALS CORPORATION', AREA_IN_HECTARES: '500', GOOD_TO_DATE: '2027-04-11', TITLE_TYPE_DESCRIPTION: 'Mineral' })] },
    };
    const [c] = normalizeClaims([layer], NOW);
    expect(c).toMatchObject({ number: '394474', name: 'YJ 2', holder: 'BRIXTON METALS CORPORATION', areaHa: 500, goodTo: '2027-04-11', days: 177, band: 'soon', type: 'Mineral' });
    expect(c.registry.code).toBe('bc');
  });

  it('reads the company-page fields and their per-claim province', () => {
    const layer = { id: 'b', geojson: { features: [feature({ claim_id: 1021959, claim_name: 'IMGM15', area_ha: 1690, good_to_date: '2034-04-24', province: 'ON' })] } };
    const [c] = normalizeClaims([layer], NOW);
    expect(c).toMatchObject({ number: '1021959', name: 'IMGM15', areaHa: 1690, band: 'later', holder: null });
    expect(c.registry.code).toBe('on');
  });

  it('keeps a claim with no date as unknown and skips features without geometry', () => {
    const layer = { id: 'c', geojson: { features: [feature({ TAG_NUMBER: 'X1' }), { type: 'Feature', geometry: null, properties: {} }] } };
    const claims = normalizeClaims([layer], NOW);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ number: 'X1', band: 'unknown', days: null });
  });
});

describe('claimGroups and summarize', () => {
  const layer = {
    id: 'g',
    geojson: {
      features: [
        feature({ claim_id: 1, good_to_date: '2027-04-11', area_ha: 10, province: 'BC' }, -131, 59),
        feature({ claim_id: 2, good_to_date: '2034-04-24', area_ha: 20, province: 'BC' }, -130.9, 59.1),
        feature({ claim_id: 3, good_to_date: '2034-04-24', area_ha: 30, province: 'BC' }, -130.2, 58.4),
        feature({ claim_id: 4, good_to_date: '2025-01-01', area_ha: 40, province: 'ON' }, -84, 48),
      ],
    },
  };
  const claims = normalizeClaims([layer], NOW);

  it('opens on the biggest group and leaves far-off ground out of it', () => {
    const groups = claimGroups(claims);
    expect(groups.map((g) => g.length)).toEqual([3, 1]);
    expect(groups[1][0].number).toBe('4');
  });

  it('totals the claims and finds the earliest date still to come', () => {
    const s = summarize(claims);
    expect(s).toMatchObject({ count: 4, totalHa: 100, expired: 1, places: 'British Columbia and Ontario' });
    expect(s.earliest.number).toBe('1');
  });

  it('names the holder only when every claim shares one', () => {
    const one = normalizeClaims([{ id: 'h', geojson: { features: [feature({ OWNER_NAME: 'A CORP' }), feature({ OWNER_NAME: 'A CORP' })] } }], NOW);
    const two = normalizeClaims([{ id: 'h', geojson: { features: [feature({ OWNER_NAME: 'A CORP' }), feature({ OWNER_NAME: 'B CORP' })] } }], NOW);
    expect(commonHolder(one)).toBe('A Corp');
    expect(commonHolder(two)).toBeNull();
  });
});

describe('handoffProject', () => {
  const project = {
    layers: [{ id: 'claims', geojson: { features: [] } }, { id: 'old', geojson: { features: [] } }],
    layout: { title: 'Project Map', subtitle: 'Technical Results', primaryLayerId: 'old', exportRatio: null },
    ratioMapStates: { landscape: { center: { lat: 1, lng: 1 }, zoom: 3 } },
    mapView: { center: { lat: 0, lng: 0 }, zoom: 2 },
  };
  const view = { center: { lat: 56, lng: -128 }, zoom: 9, width: 390, height: 600 };

  it('keeps the viewer\'s claims on a landscape page framed where the phone was', () => {
    const out = handoffProject(project, { layerIds: ['claims'], view, title: 'Example Mining Ltd.', subtitle: '2 mineral claims · British Columbia', insetRegion: { name: 'British Columbia' } });
    expect(out.layers.map((l) => l.id)).toEqual(['claims']);
    expect(out.ratioMapStates).toBeUndefined();
    expect(out.mapView).toEqual({ center: view.center, zoom: 9, screenW: 390, screenH: 600 });
    expect(out.layout).toMatchObject({
      exportRatio: 'landscape', title: 'Example Mining Ltd.', subtitle: '2 mineral claims · British Columbia',
      primaryLayerId: 'claims', autoInsetRegion: { name: 'British Columbia' },
    });
  });

  it('leaves a title, subtitle and page shape the author chose', () => {
    const custom = { ...project, layout: { ...project.layout, title: 'Thorn Project', subtitle: 'Q3 update', exportRatio: 'square' } };
    const out = handoffProject(custom, { layerIds: ['claims'], view, title: 'X', subtitle: 'Y' });
    expect(out.layout).toMatchObject({ title: 'Thorn Project', subtitle: 'Q3 update', exportRatio: 'square' });
    expect(project.ratioMapStates).toBeDefined();
  });
});
