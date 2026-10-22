import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// The Claim # box, as people on the Quebec and Ontario guides used it: a list
// pasted from a claim schedule, a company name in the wrong tab, and a deep
// link from the guide's own search box (?q=…&mode=number).

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
  const view = render(<RegistrySearch onImport={() => {}} onBack={() => {}} initialProvince="qc" {...props} />);
  return { view, RegistrySearch };
}

const box = () => screen.getByRole('textbox');
const submit = () => fireEvent.submit(box().closest('form'));

describe('the Claim # box', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(useClaimsState, { results: null, loading: false, error: null, crossProvinceHits: null, crossProvinceLoading: false });
    vi.clearAllMocks();
  });

  it('sends a pasted list as one search of every number', async () => {
    await renderRegistry();
    fireEvent.click(screen.getByRole('button', { name: 'Claim #' }));
    fireEvent.change(box(), { target: { value: '2351771, 2351772 #2351773' } });
    submit();
    expect(useClaimsState.search).toHaveBeenCalledWith('2351771 2351772 2351773', 'number', 'qc');
  });

  it('turns pasted line breaks into spaces instead of running the numbers together', async () => {
    await renderRegistry();
    fireEvent.paste(box(), { clipboardData: { getData: () => '2351771\n2351772\r\n2351773' } });
    expect(box()).toHaveValue('2351771 2351772 2351773');
    // …and a list switches the tab to Claim # by itself.
    submit();
    expect(useClaimsState.search).toHaveBeenCalledWith('2351771 2351772 2351773', 'number', 'qc');
  });

  it('says so when a list is over the cap', async () => {
    await renderRegistry();
    fireEvent.change(box(), { target: { value: Array.from({ length: 120 }, (_, i) => 2000000 + i).join(' ') } });
    submit();
    const [q, mode] = useClaimsState.search.mock.calls[0];
    expect(mode).toBe('number');
    expect(q.split(' ')).toHaveLength(100);
    expect(screen.getByText(/Searched the first 100 of 120 numbers/)).toBeInTheDocument();
  });

  it('searches a company name typed into Claim # as a company, and says it did', async () => {
    await renderRegistry();
    fireEvent.click(screen.getByRole('button', { name: 'Claim #' }));
    fireEvent.change(box(), { target: { value: 'big ridge gold corp' } });
    submit();
    expect(useClaimsState.search).toHaveBeenCalledWith('big ridge gold corp', 'company', 'qc');
    expect(screen.getByText(/isn't a claim number, so we searched it as a company name/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Company' })).toHaveClass('active');
  });

  it('does not invent a company search where there are no owner names', async () => {
    await renderRegistry({ initialProvince: 'mb' });
    fireEvent.change(box(), { target: { value: 'destiny' } });
    submit();
    expect(useClaimsState.search).not.toHaveBeenCalled();
    expect(screen.getByText(/doesn't publish owner names/)).toBeInTheDocument();
  });

  it('links an absent Quebec number to GESTIM and explains the weekly extract', async () => {
    const { view, RegistrySearch } = await renderRegistry();
    fireEvent.change(box(), { target: { value: '4527312' } });
    submit();
    Object.assign(useClaimsState, { results: { features: [], meta: {} } });
    view.rerender(<RegistrySearch onImport={() => {}} onBack={() => {}} initialProvince="qc" />);
    expect(screen.getByText(/No active claims found for "4527312" in Quebec/)).toBeInTheDocument();
    expect(screen.getByText(/refreshed weekly/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Look it up in GESTIM/ })).toHaveAttribute('href', 'https://gestim.mines.gouv.qc.ca/');
  });

  it('lists the numbers of a list that were not found', async () => {
    const { view, RegistrySearch } = await renderRegistry();
    fireEvent.change(box(), { target: { value: '2351771 2351790' } });
    submit();
    Object.assign(useClaimsState, {
      results: {
        features: [{ type: 'Feature', properties: { TAG_NUMBER: '2351771' }, geometry: null }],
        meta: { numberList: { requested: 2, total: 2, truncated: false, found: ['2351771'], missing: ['2351790'] } },
      },
    });
    view.rerender(<RegistrySearch onImport={() => {}} onBack={() => {}} initialProvince="qc" />);
    expect(screen.getByText(/Found 1 of 2 claim numbers/)).toBeInTheDocument();
    expect(screen.getByText(/Not in our Quebec data: 2351790/)).toBeInTheDocument();
  });
});

describe('deep links (?q=&mode=)', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(useClaimsState, { results: null, loading: false, error: null });
    vi.clearAllMocks();
  });

  it('runs the named tab', async () => {
    await renderRegistry({ initialQuery: '2351771 2351772', autoSearch: true, initialMode: 'number' });
    expect(useClaimsState.search).toHaveBeenCalledWith('2351771 2351772', 'number', 'qc');
    expect(screen.getByRole('button', { name: 'Claim #' })).toHaveClass('active');
  });

  it('keeps the company search a link without a mode has always run', async () => {
    await renderRegistry({ initialQuery: 'Azimut', autoSearch: true });
    expect(useClaimsState.search).toHaveBeenCalledWith('Azimut', 'company', 'qc');
  });

  it('ignores a mode the jurisdiction does not offer', async () => {
    await renderRegistry({ initialProvince: 'mb', initialQuery: 'CB12345', autoSearch: true, initialMode: 'company' });
    expect(useClaimsState.search).toHaveBeenCalledWith('CB12345', 'number', 'mb');
  });
});
