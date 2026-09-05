import { describe, it, expect } from 'vitest';
import { dashboardWindow, dayWindow, pacificDate } from '../src/components/admin/dateWindow';

describe('Pacific calendar windows', () => {
  it('ends at the last completed Pacific midnight in summer', () => {
    expect(dashboardWindow(7, new Date('2026-09-05T18:00:00Z'))).toEqual({
      p_start: '2026-08-29T07:00:00.000Z', p_end: '2026-09-05T07:00:00.000Z',
    });
  });
  it('handles a UTC date ahead of the local date', () => {
    expect(pacificDate(new Date('2026-09-05T02:00:00Z'))).toBe('2026-09-04');
  });
  it('uses a 23-hour day when daylight saving starts', () => {
    const w = dayWindow('2026-03-08');
    expect(w).toEqual({ p_start: '2026-03-08T08:00:00.000Z', p_end: '2026-03-09T07:00:00.000Z' });
  });
  it('uses a 25-hour day when daylight saving ends', () => {
    expect(dayWindow('2025-11-02')).toEqual({ p_start: '2025-11-02T07:00:00.000Z', p_end: '2025-11-03T08:00:00.000Z' });
  });
  it('uses permanent B.C. UTC-7 after March 2026', () => {
    expect(dayWindow('2026-11-01')).toEqual({ p_start: '2026-11-01T07:00:00.000Z', p_end: '2026-11-02T07:00:00.000Z' });
  });
  it('does not drift by an hour across a DST-spanning reporting period', () => {
    expect(dashboardWindow(30, new Date('2025-11-10T18:00:00Z'))).toEqual({ p_start: '2025-10-11T07:00:00.000Z', p_end: '2025-11-10T08:00:00.000Z' });
  });
});
