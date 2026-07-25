import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// RegistrySearch with the US feature flag on/off. useClaims is mocked so no
// network is involved; fetch is stubbed defensively anyway.

vi.mock('../src/utils/track', () => ({ trackSearch: vi.fn(), trackEvent: vi.fn() }));

const useClaimsState = {
  results: null, loading: false, error: null,
  crossProvinceHits: null, crossProvinceLoading: false,
  search: vi.fn(), reset: vi.fn(), searchOtherProvinces: vi.fn(), adoptResults: vi.fn(),
};
vi.mock('../src/hooks/useClaims', () => ({ useClaims: () => useClaimsState }));

const usClaim = (i, type) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
  properties: {
    TAG_NUMBER: `NV10${i}`, CLAIM_NAME: `GOLDIE #${i}`, CLAIM_TYPE: type,
    TITLE_TYPE_DESCRIPTION: type.toUpperCase(), STATUS: 'ACTIVE',
    AREA_IN_HECTARES: 8.3, SOURCE_SYSTEM: 'BLM MLRS', GEOM_GENERALIZED: true,
  },
});

async function renderRegistry(flagOn, props = {}) {
  vi.stubEnv('VITE_ENABLE_US_CLAIMS', flagOn ? '1' : '');
  vi.resetModules();
  const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
  return render(<RegistrySearch onImport={vi.fn()} onBack={vi.fn()} {...props} />);
}

beforeEach(() => {
  localStorage.clear();
  useClaimsState.results = null;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('jurisdiction selector', () => {
  it('hides US states when the flag is off and keeps all 7 Canadian provinces', async () => {
    const { container } = await renderRegistry(false);
    const options = [...container.querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(expect.arrayContaining(['bc', 'on', 'qc', 'sk', 'mb', 'nl', 'yt']));
    expect(options.some((v) => v.startsWith('us-'))).toBe(false);
  });

  it('shows the US federal optgroup with 11 states when the flag is on', async () => {
    const { container } = await renderRegistry(true);
    const groups = [...container.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toContain('Canada');
    expect(groups.some((l) => l.includes('United States'))).toBe(true);
    const usOptions = [...container.querySelectorAll('option')].filter((o) => o.value.startsWith('us-'));
    expect(usOptions).toHaveLength(11);
    expect(usOptions.some((o) => o.value === 'us-ak')).toBe(false); // no Alaska in v1
  });

  it('switching to a US state shows Company + Claim Name + Claim # modes', async () => {
    const { container } = await renderRegistry(true);
    fireEvent.change(container.querySelector('select'), { target: { value: 'us-nv' } });
    await waitFor(() => {
      // Company search resolves a parent through its US-subsidiary aliases
      // server-side (api/_lib/us-aliases.js), so it is offered for US states.
      expect(screen.getByRole('button', { name: 'Company' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Claim Name' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Claim #' })).toBeInTheDocument();
    });
  });

  it('US states show company-lookup guidance with the BLM Customer Info Report link', async () => {
    const { container } = await renderRegistry(true);
    fireEvent.change(container.querySelector('select'), { target: { value: 'us-ut' } });
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Customer Info Report/i });
      expect(link).toHaveAttribute('href', expect.stringContaining('reports.blm.gov'));
      expect(screen.getByText(/name claims after themselves/i)).toBeInTheDocument();
    });
  });
});

describe('deep-link auto-search', () => {
  it('auto-adopts the strongest cross-province hit when the deep-linked province is empty', async () => {
    useClaimsState.search.mockClear();
    useClaimsState.searchOtherProvinces.mockClear();
    useClaimsState.adoptResults.mockClear();

    vi.stubEnv('VITE_ENABLE_US_CLAIMS', '');
    vi.resetModules();
    const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
    const props = { onImport: vi.fn(), onBack: vi.fn(), initialProvince: 'bc', initialQuery: 'Goliath Resources', autoSearch: true };
    const view = render(<RegistrySearch {...props} />);

    // Mount effect fired the deep-link search against the page's province.
    expect(useClaimsState.search).toHaveBeenCalledWith('Goliath Resources', 'company', 'bc');

    // BC resolves empty → the cross-province sweep must start.
    useClaimsState.results = { features: [], meta: {} };
    view.rerender(<RegistrySearch {...props} />);
    await waitFor(() => expect(useClaimsState.searchOtherProvinces).toHaveBeenCalled());

    // Sweep lands hits → the strongest one is adopted automatically (no click).
    const onData = { features: [usClaim(1, 'lode')], meta: {} };
    useClaimsState.crossProvinceHits = [
      { province: { value: 'sk', label: 'Saskatchewan', modes: ['company', 'number'] }, count: 2, data: { features: [], meta: {} } },
      { province: { value: 'on', label: 'Ontario', modes: ['company', 'number'] }, count: 14, data: onData },
    ];
    view.rerender(<RegistrySearch {...props} />);
    await waitFor(() => expect(useClaimsState.adoptResults).toHaveBeenCalledWith(onData));
    expect(view.container.querySelector('select').value).toBe('on');
    useClaimsState.crossProvinceHits = null;
  });
});

describe('US deep-link auto-search', () => {
  it('uses company mode for a US parent-company deep link', async () => {
    useClaimsState.search.mockClear();
    const { container } = await renderRegistry(true, {
      initialProvince: 'us-nv', initialQuery: 'Goldie Gold Corp', autoSearch: true,
    });
    // A company deep link must reach the server's alias ladder, which is what
    // finds Nevada ground held under a US subsidiary of the parent.
    expect(useClaimsState.search).toHaveBeenCalledWith('Goldie Gold Corp', 'company', 'us-nv');
    expect(container.querySelector('select').value).toBe('us-nv');
  });
});

describe('US results: type chips + disclaimer', () => {
  it('filters the flat list by claim type and shows the BLM disclaimer', async () => {
    useClaimsState.results = {
      features: [usClaim(1, 'lode'), usClaim(2, 'lode'), usClaim(3, 'placer')],
      meta: { provider: 'blm-mlrs', truncated: false },
    };
    await renderRegistry(true, { initialProvince: 'us-nv' });
    // The flat list (and the type chips) render in non-company modes; US now
    // defaults to Company, so switch to Claim Name first.
    fireEvent.click(screen.getByRole('button', { name: 'Claim Name' }));
    await waitFor(() => expect(screen.getByText('GOLDIE #1')).toBeInTheDocument());
    expect(screen.getByText('GOLDIE #3')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Placer'));
    await waitFor(() => {
      expect(screen.queryByText('GOLDIE #1')).not.toBeInTheDocument();
      expect(screen.getByText('GOLDIE #3')).toBeInTheDocument();
    });

    expect(screen.getByText(/not legal surveys/i)).toBeInTheDocument();
  });
});

describe('auto-adopted jurisdiction attribution', () => {
  it('renders attribution, ranks by area not count, and carries it onto the imported layer', async () => {
    useClaimsState.search.mockClear();
    useClaimsState.searchOtherProvinces.mockClear();
    useClaimsState.adoptResults.mockClear();
    const onImport = vi.fn();

    vi.stubEnv('VITE_ENABLE_US_CLAIMS', '1');
    vi.resetModules();
    const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
    const props = { onImport, onBack: vi.fn(), initialProvince: 'bc', initialQuery: 'Awesome Gold Corp.', autoSearch: true };
    const view = render(<RegistrySearch {...props} />);

    // BC (the deep link's guess) comes back empty → cross-jurisdiction sweep.
    useClaimsState.results = { features: [], meta: {} };
    view.rerender(<RegistrySearch {...props} />);
    await waitFor(() => expect(useClaimsState.searchOtherProvinces).toHaveBeenCalled());

    // Ontario has more claims; Nevada has far more ground. Area must win.
    const bigArea = (n, ha) => ({
      features: Array.from({ length: n }, (_, i) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
        properties: { TAG_NUMBER: `T${i}`, CLAIM_NAME: `AWESOME GOLD NEVADA ${i}`, AREA_IN_HECTARES: ha, CLAIM_TYPE: 'lode' },
      })),
      meta: { provider: 'blm-mlrs', scopingMethod: 'serial_prefix', scopingDegraded: true, scopingNote: 'Scoped by case-serial prefix because the BLM state fields are unavailable.' },
    });
    const nvData = bigArea(4, 500);   // 2,000 ha over 4 claims
    useClaimsState.crossProvinceHits = [
      { province: { value: 'on', label: 'Ontario', modes: ['company', 'number'] }, count: 40, data: bigArea(40, 8.4) },
      { province: { value: 'us-nv', label: 'Nevada', modes: ['company', 'name', 'number'] }, count: 4, data: nvData },
    ];
    view.rerender(<RegistrySearch {...props} />);

    await waitFor(() => expect(useClaimsState.adoptResults).toHaveBeenCalledWith(nvData));
    expect(view.container.querySelector('select').value).toBe('us-nv');

    // The switch attributes itself, naming both jurisdictions.
    useClaimsState.results = nvData;
    view.rerender(<RegistrySearch {...props} />);
    await waitFor(() => expect(
      screen.getByText('Showing Nevada — no British Columbia claims found for Awesome Gold Corp.')
    ).toBeInTheDocument());

    // Degraded scoping is warned about in the results panel too.
    expect(screen.getByText(/Approximate state scoping/i)).toBeInTheDocument();

    // …and both qualifications ride along with the import into the editor.
    // Company mode: US records have no claimant, so the single holder bucket is
    // labelled with the resolved company and its claims group normally.
    fireEvent.click(screen.getByText(/Select All/));
    fireEvent.click(screen.getByRole('button', { name: /Add 4 claims to map/ }));

    expect(onImport).toHaveBeenCalledTimes(1);
    const [items] = onImport.mock.calls[0];
    expect(items[0].provenance.autoAdopted.message).toMatch(/^Showing Nevada — no British Columbia/);
    expect(items[0].provenance.autoAdopted.requestedProvince).toBe('bc');
    expect(items[0].provenance.scopingMethod).toBe('serial_prefix');
    expect(items[0].provenance.scopingWarning.detail).toMatch(/serial/i);
    useClaimsState.crossProvinceHits = null;
  });

  it('a manual "Switch & view" click adopts without attribution (behaviour unchanged)', async () => {
    useClaimsState.adoptResults.mockClear();
    useClaimsState.results = { features: [], meta: {} };
    useClaimsState.crossProvinceHits = [
      { province: { value: 'on', label: 'Ontario', modes: ['company', 'number'] }, count: 3, data: { features: [usClaim(1, 'lode')], meta: {} } },
    ];
    // No autoSearch → nothing was auto-adopted, so the row is a manual choice.
    await renderRegistry(true, { initialProvince: 'bc', initialQuery: 'Awesome Gold Corp.' });
    fireEvent.click(screen.getByText(/Ontario — 3 claims found/));
    await waitFor(() => expect(useClaimsState.adoptResults).toHaveBeenCalled());
    expect(screen.queryByText(/^Showing Ontario —/)).not.toBeInTheDocument();
    useClaimsState.crossProvinceHits = null;
  });
});
