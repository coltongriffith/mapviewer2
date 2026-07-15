import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ── loadSharedMap: narrow RPC lookup ─────────────────────────────────────────

const rpcMock = vi.fn();
vi.mock('../src/lib/supabase', () => ({
  supabase: { rpc: (...args) => rpcMock(...args) },
}));

vi.mock('../src/components/ReadOnlyMapStage', () => ({
  default: () => <div data-testid="stage">stage</div>,
}));
vi.mock('../src/utils/track', () => ({ trackEvent: vi.fn() }));

import { loadSharedMap } from '../src/utils/cloudStorage';
import SharedMapViewer from '../src/components/SharedMapViewer';

beforeEach(() => {
  rpcMock.mockReset();
});

describe('loadSharedMap', () => {
  it('uses the get_shared_map RPC with exactly one share id — no table select', async () => {
    const state = { layers: [], layout: { title: 'Shared' } };
    rpcMock.mockResolvedValue({ data: state, error: null });
    const result = await loadSharedMap('abc123def456');
    expect(rpcMock).toHaveBeenCalledWith('get_shared_map', { share_id: 'abc123def456' });
    expect(result).toEqual(state);
  });

  it('returns null (not-found) for an unknown identifier', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await loadSharedMap('doesnotexist123')).toBeNull();
  });

  it('returns null instead of throwing on RPC errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await loadSharedMap('abc123def456')).toBeNull();
  });

  it('legacy 32-char hex ids remain usable as-is', async () => {
    const legacyId = 'a'.repeat(32);
    rpcMock.mockResolvedValue({ data: { layers: [] }, error: null });
    await loadSharedMap(legacyId);
    expect(rpcMock).toHaveBeenCalledWith('get_shared_map', { share_id: legacyId });
  });
});

// ── SharedMapViewer: load, not-found, stale-response protection ─────────────

describe('SharedMapViewer', () => {
  it('renders a loaded shared map', async () => {
    rpcMock.mockResolvedValue({ data: { layers: [], layout: {} }, error: null });
    render(<SharedMapViewer mapId="abc123def456" onExit={() => {}} user={null} />);
    await waitFor(() => expect(screen.getByTestId('stage')).toBeInTheDocument());
  });

  it('shows not-found for an invalid identifier', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<SharedMapViewer mapId="nope12345" onExit={() => {}} user={null} />);
    await waitFor(() => expect(screen.getByText('Map not found')).toBeInTheDocument());
  });

  it('a stale response for a previous mapId does not clobber the current map', async () => {
    // First map resolves SLOWLY with state A; second resolves fast with B.
    let resolveA;
    const slowA = new Promise((res) => { resolveA = res; });
    rpcMock.mockImplementation((_fn, { share_id }) => {
      if (share_id === 'aaaa1111aaaa') return slowA;
      return Promise.resolve({ data: { layers: [], layout: { title: 'B' } }, error: null });
    });

    const { rerender } = render(<SharedMapViewer mapId="aaaa1111aaaa" onExit={() => {}} user={null} />);
    rerender(<SharedMapViewer mapId="bbbb2222bbbb" onExit={() => {}} user={null} />);
    await waitFor(() => expect(screen.getByTestId('stage')).toBeInTheDocument());

    // Now the stale A completes as not-found — it must NOT flip the view to an error.
    resolveA({ data: null, error: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Map not found')).not.toBeInTheDocument();
    expect(screen.getByTestId('stage')).toBeInTheDocument();
  });
});
