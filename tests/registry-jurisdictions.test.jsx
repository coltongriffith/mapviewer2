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

  it('switching to a US state shows Claim Name + Claim # modes (no Company)', async () => {
    const { container } = await renderRegistry(true);
    fireEvent.change(container.querySelector('select'), { target: { value: 'us-nv' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Claim Name' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Claim #' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Company' })).not.toBeInTheDocument();
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
  it('uses a supported mode (name) for US states instead of company', async () => {
    useClaimsState.search.mockClear();
    const { container } = await renderRegistry(true, {
      initialProvince: 'us-nv', initialQuery: 'Goldie', autoSearch: true,
    });
    // US jurisdictions have no company mode — the server would 400. The
    // auto-search must fall back to the state's first supported mode.
    expect(useClaimsState.search).toHaveBeenCalledWith('Goldie', 'name', 'us-nv');
    expect(container.querySelector('select').value).toBe('us-nv');
  });
});

describe('US results: type chips + disclaimer', () => {
  it('filters the flat list by claim type and shows the BLM disclaimer', async () => {
    useClaimsState.results = {
      features: [usClaim(1, 'lode'), usClaim(2, 'lode'), usClaim(3, 'placer')],
      meta: { provider: 'blm-mlrs', truncated: false },
    };
    const { container } = await renderRegistry(true, { initialProvince: 'us-nv' });
    // Non-company mode renders the flat list; default mode for US is 'name'.
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
