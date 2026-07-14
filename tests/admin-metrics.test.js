import { describe, it, expect } from 'vitest';
import {
  formatDelta, formatRate, classifyUser, bucketDays, toPacificDate, SMALL_N,
} from '../src/components/admin/metrics.js';

describe('formatDelta (F4 small-number honesty)', () => {
  it('renders nothing when both windows are zero', () => {
    expect(formatDelta(0, 0)).toBeNull();
  });
  it('shows "+N new" when prior is zero', () => {
    expect(formatDelta(3, 0)).toMatchObject({ kind: 'new', text: '+3 new' });
  });
  it('shows an absolute change (not a percentage) when prior < 8', () => {
    const d = formatDelta(7, 5);
    expect(d.kind).toBe('abs');
    expect(d.text).toBe('+2 (was 5)');
    expect(d.text).not.toMatch(/%/);
    expect(d.tone).toBe('neutral');
  });
  it('shows a percentage only when prior ≥ 8', () => {
    expect(formatDelta(15, 10)).toMatchObject({ kind: 'pct', text: '▲ 50%', tone: 'good' });
    expect(formatDelta(20, 30)).toMatchObject({ kind: 'pct', text: '▼ 33%', tone: 'bad' });
  });
  it('flat when equal', () => {
    expect(formatDelta(4, 4)).toMatchObject({ kind: 'flat', tone: 'neutral' });
  });
  it('respects goodDirection=down (fewer is better, e.g. failures)', () => {
    // failures fell 20→10: good
    expect(formatDelta(10, 20, 'down').tone).toBe('good');
    // failures rose 10→20: bad
    expect(formatDelta(20, 10, 'down').tone).toBe('bad');
  });
  it('never divides by a tiny prior', () => {
    expect(formatDelta(50, 1).text).not.toMatch(/%/);
    expect(formatDelta(50, 1).text).toBe('+49 (was 1)');
  });
  it('always carries a "cur vs prior" title', () => {
    expect(formatDelta(12, 10).title).toBe('12 vs 10 prior period');
  });
});

describe('formatRate', () => {
  it('is "X of N" with no percentage below SMALL_N', () => {
    expect(formatRate(3, 7).text).toBe('3 of 7');
    expect(formatRate(3, 7).text).not.toMatch(/%/);
  });
  it('adds a percentage at or above SMALL_N', () => {
    expect(formatRate(5, 12).text).toBe('5 of 12 (42%)');
    expect(SMALL_N).toBe(8);
  });
  it('handles an empty cohort without NaN', () => {
    expect(formatRate(0, 0).text).toBe('—');
  });
});

describe('classifyUser (mirrors the SQL CASE)', () => {
  const now = new Date('2026-07-20T12:00:00Z').getTime();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();

  it('new = <7d old and not activated', () => {
    expect(classifyUser({ activated: false, created_at: iso(3) }, now)).toBe('new');
  });
  it('never_activated = ≥7d old and not activated', () => {
    expect(classifyUser({ activated: false, created_at: iso(10) }, now)).toBe('never_activated');
  });
  it('power = activated with value on ≥3 days in 30', () => {
    expect(classifyUser({ activated: true, created_at: iso(40), active_days_30: 3, last_event_at: iso(1) }, now)).toBe('power');
  });
  it('active = activated with a value event in 14d (below power)', () => {
    expect(classifyUser({ activated: true, created_at: iso(40), active_days_30: 1, value_14: 1, last_event_at: iso(2) }, now)).toBe('active');
  });
  it('dormant = activated but no active event in 14+ days', () => {
    expect(classifyUser({ activated: true, created_at: iso(60), active_days_30: 0, value_14: 0, last_event_at: iso(20) }, now)).toBe('dormant');
  });
  it('boundary: exactly 7d old and unactivated is never_activated', () => {
    expect(classifyUser({ activated: false, created_at: iso(7) }, now)).toBe('never_activated');
  });
  it('activated with zero recent activity and no last event is dormant', () => {
    expect(classifyUser({ activated: true, created_at: iso(90), active_days_30: 0, value_14: 0, last_event_at: null }, now)).toBe('dormant');
  });
});

describe('bucketDays (tz-aware zero-fill)', () => {
  it('fills gaps between two dates inclusive', () => {
    const out = bucketDays([{ d: '2026-07-02', value: 5 }], '2026-07-01', '2026-07-04');
    expect(out.map((r) => r.d)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']);
    expect(out.map((r) => r.value)).toEqual([0, 5, 0, 0]);
  });
  it('produces the correct number of buckets across a DST boundary week', () => {
    // US/Canada DST began 2026-03-08. A full week around it is still 7 days.
    const out = bucketDays([], '2026-03-05', '2026-03-11');
    expect(out).toHaveLength(7);
  });
});

describe('toPacificDate', () => {
  it('an evening-UTC instant lands on the correct BC calendar date', () => {
    // 2026-07-09 06:30 UTC = 2026-07-08 23:30 America/Vancouver (PDT, -7)
    expect(toPacificDate('2026-07-09T06:30:00Z')).toBe('2026-07-08');
    // 2026-07-09 07:30 UTC = 2026-07-09 00:30 Pacific → next day
    expect(toPacificDate('2026-07-09T07:30:00Z')).toBe('2026-07-09');
  });
});
