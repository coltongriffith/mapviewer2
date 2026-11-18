import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { readSearchQuery, parseMapSheet, parseLatLng } from '../src/utils/searchIntent.js';

// Every query below is one that came back empty in production (Oct–Nov 2026
// search_events): a place typed into a box that searches holders and numbers.

describe('reading what a claim search query is', () => {
  it('reads coordinates in either order and with hemisphere letters', () => {
    expect(parseLatLng('49.494891, -117.290039')).toEqual({ lat: 49.494891, lng: -117.290039 });
    expect(parseLatLng('-117.29 49.49')).toEqual({ lat: 49.49, lng: -117.29 });
    expect(parseLatLng('49.49 N, 117.29 W')).toEqual({ lat: 49.49, lng: -117.29 });
    // Outside the registries' part of the world, or not decimal: not a place.
    expect(parseLatLng('12.5, 3.2')).toBeNull();
    expect(parseLatLng('2351771 2351772')).toBeNull();
  });

  it('puts NTS sheets at their centre', () => {
    // 103I is Terrace, BC: 54–55° N, 128–130° W.
    expect(parseMapSheet('103I')).toMatchObject({ label: '103I', lat: 54.5, lng: -129, radiusKm: 50 });
    // 033A08: the 1:50k sheet in the north-east quarter of 033A's second row.
    expect(parseMapSheet('33A08')).toMatchObject({ label: '033A08', lat: 52.375, lng: -72.25, radiusKm: 20 });
    expect(parseMapSheet('103I 09')).toMatchObject({ label: '103I09' });
    expect(parseMapSheet('062P01-SW-East')).toMatchObject({ label: '062P01' });
  });

  it('reads Ontario cell IDs as their sheet, including I typed as 1', () => {
    expect(parseMapSheet('41I11C177')).toMatchObject({ kind: 'cell', label: '041I11' });
    expect(parseMapSheet('41111C177')).toMatchObject({ kind: 'cell', label: '041I11' });
    // 052A05 is Thunder Bay.
    const tb = parseMapSheet('52A05F357');
    expect(tb.lat).toBeCloseTo(48.375);
    expect(tb.lng).toBeCloseTo(-89.75);
  });

  it('leaves claim numbers and names alone', () => {
    ['1019406', '5059672', '1110361 1110372', 'MC00022810', 'MB13075', 'NV101234567', '62413-0198']
      .forEach((q) => expect(readSearchQuery(q).type).toBe('number'));
    ['Chapel', 'Allegiance Resources Corp', 'Quebec Innovative Materials Co']
      .forEach((q) => expect(readSearchQuery(q).type).toBe('text'));
  });
});

vi.mock('../src/utils/track', () => ({ trackSearch: vi.fn(), trackEvent: vi.fn() }));
const useClaimsState = {
  results: null, loading: false, error: null,
  crossProvinceHits: null, crossProvinceLoading: false,
  search: vi.fn(), reset: vi.fn(), searchOtherProvinces: vi.fn(), adoptResults: vi.fn(),
};
vi.mock('../src/hooks/useClaims', () => ({ useClaims: () => useClaimsState, NETWORK_ERROR: 'network' }));

async function renderRegistry(props = {}) {
  vi.resetModules();
  const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
  return render(<RegistrySearch onImport={() => {}} onBack={() => {}} {...props} />);
}
const box = () => screen.getByRole('textbox');
const searchFor = (value) => { fireEvent.change(box(), { target: { value } }); fireEvent.submit(box().closest('form')); };

describe('the search panel', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(useClaimsState, { results: null, loading: false, error: null, crossProvinceHits: null, crossProvinceLoading: false });
    vi.clearAllMocks();
  });

  it('offers a nearby search for a map sheet instead of an empty holder search', async () => {
    const onSearchNear = vi.fn();
    await renderRegistry({ initialProvince: 'qc', onSearchNear });
    searchFor('33A08');
    expect(useClaimsState.search).not.toHaveBeenCalled();
    expect(screen.getByText(/looks like an NTS map sheet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show claims within 20 km' }));
    expect(onSearchNear).toHaveBeenCalledWith(expect.objectContaining({ lat: 52.375, lng: -72.25, radiusKm: 20, province: 'qc' }));
  });

  it('offers a nearby search for coordinates, and can still search them as typed', async () => {
    const onSearchNear = vi.fn();
    await renderRegistry({ initialProvince: 'bc', onSearchNear });
    searchFor('49.494891, -117.290039');
    expect(screen.getByText(/looks like coordinates/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search it as typed' }));
    expect(useClaimsState.search).toHaveBeenCalledWith('49.494891, -117.290039', 'company', 'bc');
  });

  it('searches places as typed where no nearby search is wired up', async () => {
    await renderRegistry({ initialProvince: 'qc' });
    searchFor('33A08');
    expect(useClaimsState.search).toHaveBeenCalled();
  });

  it('searches a claim number typed in the company tab as a number', async () => {
    await renderRegistry({ initialProvince: 'qc' });
    fireEvent.click(screen.getByRole('button', { name: 'Company' }));
    searchFor('5059672');
    expect(useClaimsState.search).toHaveBeenCalledWith('5059672', 'number', 'qc');
    expect(screen.getByText(/looks like a claim number, so we searched it as one/)).toBeInTheDocument();
  });

  it('offers a location search when a holder search for a place-like name is empty', async () => {
    const onPickArea = vi.fn();
    const view = await renderRegistry({ initialProvince: 'on', onPickArea });
    searchFor('Chapel');
    expect(useClaimsState.search).toHaveBeenCalledWith('Chapel', 'company', 'on');
    useClaimsState.results = { features: [], meta: {} };
    const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
    view.rerender(<RegistrySearch onImport={() => {}} onBack={() => {}} initialProvince="on" onPickArea={onPickArea} />);
    fireEvent.click(screen.getByRole('button', { name: 'Is it a place? Search by location' }));
    expect(onPickArea).toHaveBeenCalledWith({ province: 'on', query: 'Chapel' });
  });
});

describe('the lookup card summary', () => {
  it('drops the 100% marker from a sole Ontario holder', async () => {
    const { lookupSummary } = await import('../src/components/ClaimLookupCard.jsx');
    const layer = { id: 'l1', provenance: { province: 'on' }, geojson: { features: [{
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-81, 46], [-80.99, 46], [-80.99, 46.01], [-81, 46]]] },
      properties: { TENURE_NUMBER_ID: '109399', HOLDER: '(100) AGNICO EAGLE MINES LIMITED', GOOD_TO_DATE: '2029-04-23' },
    }] } };
    expect(lookupSummary([layer]).headline).not.toMatch(/^\(100\)/);
    expect(lookupSummary([layer]).headline).toMatch(/Agnico Eagle Mines Limited/i);
  });
});
