import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStorageUsage } from '../src/hooks/useStorageUsage';
const { measure } = vi.hoisted(() => ({ measure: vi.fn(() => 100) }));
vi.mock('../src/utils/projectStorage', () => ({ estimateStorageUsedBytes: measure }));
beforeEach(() => { vi.useFakeTimers(); measure.mockClear(); });
afterEach(() => vi.useRealTimers());
it('does not rescan megabytes of storage when the editor merely rerenders', () => {
  const { rerender } = renderHook(() => useStorageUsage(true));
  for (let i = 0; i < 20; i++) rerender();
  expect(measure).toHaveBeenCalledTimes(1);
});
it('coalesces related writes and cleans up pending work on unmount', () => {
  const { result, unmount } = renderHook(() => useStorageUsage(true));
  act(() => { for (let i = 0; i < 3; i++) window.dispatchEvent(new Event('project-storage-updated')); });
  expect(measure).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(500));
  expect(measure).toHaveBeenCalledTimes(2);
  expect(result.current).toBe(100);
  act(() => window.dispatchEvent(new Event('project-storage-updated')));
  unmount();
  act(() => vi.advanceTimersByTime(500));
  expect(measure).toHaveBeenCalledTimes(2);
});
it('does no work for a signed-in user with the local-storage warning disabled', () => {
  renderHook(() => useStorageUsage(false));
  expect(measure).not.toHaveBeenCalled();
});
