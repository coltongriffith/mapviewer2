import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRpc } from '../src/components/admin/useDashboardData';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), user: { id: 'admin-1' } }));
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: mock.rpc } }));
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: mock.user }) }));
let requests;
beforeEach(() => {
  requests = [];
  mock.user = { id: 'admin-1' };
  mock.rpc.mockImplementation(() => ({ abortSignal: signal => new Promise(resolve => requests.push({ signal, resolve })) }));
});
afterEach(() => { vi.clearAllMocks(); });
const finish = async (index, data, error = null) => act(async () => { requests[index].resolve({ data, error }); });

describe('admin report requests', () => {
  it('does not request disabled tabs; reuses a fresh report on return', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useRpc('report', { days: 7 }, enabled), { initialProps: { enabled: false } });
    expect(mock.rpc).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await finish(0, { count: 4 });
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(result.current.data.count).toBe(4);
  });
  it('aborts superseded ranges and never lets a slow old result overwrite the new report', async () => {
    const { result, rerender } = renderHook(({ days }) => useRpc('report', { days }, true), { initialProps: { days: 7 } });
    rerender({ days: 30 });
    expect(requests[0].signal.aborted).toBe(true);
    expect(result.current.data).toBeNull();
    await finish(1, { count: 30 });
    await finish(0, { count: 7 });
    expect(result.current.data.count).toBe(30);
  });
  it('refreshes without allowing an in-flight earlier request to win', async () => {
    const { result } = renderHook(() => useRpc('report', {}, true));
    act(() => result.current.reload());
    await finish(1, { count: 2 });
    await finish(0, { count: 1 });
    expect(result.current.data.count).toBe(2);
  });
  it('shows failures as errors, then permits retry', async () => {
    const { result } = renderHook(() => useRpc('report', {}, true));
    await finish(0, null, { message: 'Database unavailable' });
    expect(result.current.error).toBe('Database unavailable');
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    act(() => result.current.reload());
    await finish(1, { count: 0 });
    expect(result.current.error).toBeNull();
    expect(result.current.data.count).toBe(0);
  });
  it('never exposes a previous account’s report after an auth change', async () => {
    const { result, rerender } = renderHook(() => useRpc('report', {}, true));
    await finish(0, { private: 'admin-1' });
    mock.user = { id: 'admin-2' };
    rerender();
    expect(result.current.data).toBeNull();
    await finish(1, { private: 'admin-2' });
    await waitFor(() => expect(result.current.data.private).toBe('admin-2'));
  });
  it('cancels work on unmount', () => {
    const { unmount } = renderHook(() => useRpc('report', {}, true));
    unmount();
    expect(requests[0].signal.aborted).toBe(true);
  });
});
