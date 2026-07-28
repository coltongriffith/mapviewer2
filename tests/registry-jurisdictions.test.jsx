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

  it('never labels a US mode "Company" — claim names are not an ownership record', async () => {
    const { container } = await renderRegistry(true);
    fireEvent.change(container.querySelector('select'), { target: { value: 'us-nv' } });
    await waitFor(() => {
      // The BLM layer has no claimant field, so the mode that resolves against
      // claim names must not present itself as a company search.
      expect(screen.getByRole('button', { name: 'Project / claim name' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Claim #' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Company' })).not.toBeInTheDocument();
      // One claim-name tab, not two: the ladder's first tier IS the literal
      // match, so a separate "exact" tab searched the same field twice.
      expect(screen.queryByRole('button', { name: /Claim name \(exact\)/ })).not.toBeInTheDocument();
    });
  });

  it('keeps the Company label for Canadian registries, which do publish holders', async () => {
    const { container } = await renderRegistry(true);
    fireEvent.change(container.querySelector('select'), { target: { value: 'bc' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Company' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Project / claim name' })).not.toBeInTheDocument();
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
    // The flat list renders in non-company modes; the type chips now render for
    // ANY US result set, because US company results are grouped geographically
    // and the chips can't live inside the flat list.
    fireEvent.click(screen.getByRole('button', { name: 'Claim #' }));
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

describe('claim-name results require confirmation and are never titled as a company', () => {
  const nameMatched = (n) => ({
    features: Array.from({ length: n }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
      properties: {
        TAG_NUMBER: `NV10${i}`, CLAIM_NAME: `AWESOME GOLD NEVADA ${i + 1}`,
        CLAIM_TYPE: 'lode', AREA_IN_HECTARES: 8.3,
      },
    })),
    meta: { provider: 'blm-mlrs', scopingMethod: 'geo_state', scopingDegraded: false },
    resolution: { status: 'resolved', method: 'alias', resolvedAgainst: 'claim_name', company: 'Awesome Gold Corp.' },
  });

  it('blocks the import until the ownership caveat is acknowledged', async () => {
    const onImport = vi.fn();
    useClaimsState.results = nameMatched(4);
    vi.stubEnv('VITE_ENABLE_US_CLAIMS', '1');
    vi.resetModules();
    const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
    render(<RegistrySearch onImport={onImport} onBack={vi.fn()} initialProvince="us-nv" initialQuery="Awesome Gold Corp." />);

    // The caveat is stated, not buried.
    expect(screen.getByText(/ownership not established/i)).toBeInTheDocument();
    expect(screen.getByText(/does not establish who holds the ground/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Select All/));
    const addBtn = screen.getByRole('button', { name: /Confirm the claim-name notice/i });
    expect(addBtn).toBeDisabled();
    fireEvent.click(addBtn);
    expect(onImport).not.toHaveBeenCalled();

    // Acknowledging unlocks it.
    fireEvent.click(screen.getByRole('checkbox', { name: /claim-name matches, not confirmed holdings/i }));
    const unlocked = screen.getByRole('button', { name: /Add 4 claims to map/ });
    expect(unlocked).not.toBeDisabled();
    fireEvent.click(unlocked);
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('titles the layer by the matched claim-name prefix, not "<Company> Claims"', async () => {
    const onImport = vi.fn();
    useClaimsState.results = nameMatched(3);
    vi.stubEnv('VITE_ENABLE_US_CLAIMS', '1');
    vi.resetModules();
    const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
    render(<RegistrySearch onImport={onImport} onBack={vi.fn()} initialProvince="us-nv" initialQuery="Awesome Gold Corp." />);

    fireEvent.click(screen.getByText(/Select All/));
    fireEvent.click(screen.getByRole('checkbox', { name: /claim-name matches/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add 3 claims to map/ }));

    const [items] = onImport.mock.calls[0];
    expect(items[0].name).toBe('AWESOME GOLD NEVADA (claim name)');
    expect(items[0].name).not.toMatch(/Awesome Gold Corp/);
    expect(items[0].name).not.toMatch(/Claims$/);
    // Provenance records the weaker link and the acknowledgement, and carries a
    // source + retrieval date for the export credit.
    expect(items[0].provenance.resolvedAgainst).toBe('claim_name');
    expect(items[0].provenance.resolutionMethod).toBe('alias');
    expect(items[0].provenance.claimNameAcknowledged).toBe(true);
    expect(items[0].provenance.dataSource).toMatch(/BLM MLRS/);
    expect(items[0].provenance.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does not fan a US search out across the other states at all', async () => {
    useClaimsState.search.mockClear();
    useClaimsState.searchOtherProvinces.mockClear();
    useClaimsState.adoptResults.mockClear();

    vi.stubEnv('VITE_ENABLE_US_CLAIMS', '1');
    vi.resetModules();
    const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
    const props = { onImport: vi.fn(), onBack: vi.fn(), initialProvince: 'us-nv', initialQuery: 'Awesome Gold Corp.', autoSearch: true };
    const view = render(<RegistrySearch {...props} />);

    useClaimsState.results = { features: [], meta: {}, resolution: { status: 'unresolved' } };
    view.rerender(<RegistrySearch {...props} />);

    // Sweeping a claim-NAME query across eleven states would surface name
    // coincidences in states nobody asked about. Canada still sweeps.
    await waitFor(() => expect(screen.getByText(/couldn't link/i)).toBeInTheDocument());
    expect(useClaimsState.searchOtherProvinces).not.toHaveBeenCalled();
    expect(useClaimsState.adoptResults).not.toHaveBeenCalled();
  });

  it('still sweeps for Canadian provinces, which do publish holders', async () => {
    useClaimsState.searchOtherProvinces.mockClear();
    vi.stubEnv('VITE_ENABLE_US_CLAIMS', '1');
    vi.resetModules();
    const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
    const props = { onImport: vi.fn(), onBack: vi.fn(), initialProvince: 'bc', initialQuery: 'Goliath Resources', autoSearch: true };
    const view = render(<RegistrySearch {...props} />);
    useClaimsState.results = { features: [], meta: {} };
    view.rerender(<RegistrySearch {...props} />);
    await waitFor(() => expect(useClaimsState.searchOtherProvinces).toHaveBeenCalled());
  });

  it('guards auto-adoption against a claim-name hit even if a sweep produces one', async () => {
    // Defense in depth: the US sweep is off, so this path is unreachable today,
    // but the guard must survive the sweep being restored once company search
    // resolves against claimant records.
    useClaimsState.searchOtherProvinces.mockClear();
    useClaimsState.adoptResults.mockClear();

    vi.stubEnv('VITE_ENABLE_US_CLAIMS', '1');
    vi.resetModules();
    const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
    const props = { onImport: vi.fn(), onBack: vi.fn(), initialProvince: 'bc', initialQuery: 'Awesome Gold Corp.', autoSearch: true };
    const view = render(<RegistrySearch {...props} />);

    useClaimsState.results = { features: [], meta: {} };
    view.rerender(<RegistrySearch {...props} />);
    await waitFor(() => expect(useClaimsState.searchOtherProvinces).toHaveBeenCalled());

    useClaimsState.crossProvinceHits = [
      { province: { value: 'on', label: 'Ontario', modes: ['company', 'number'] }, count: 3, data: nameMatched(3) },
    ];
    view.rerender(<RegistrySearch {...props} />);

    await waitFor(() => expect(screen.getByText(/Ontario — 3 claims found/)).toBeInTheDocument());
    expect(useClaimsState.adoptResults).not.toHaveBeenCalled();
    useClaimsState.crossProvinceHits = null;
  });
});
