import { describe, it, expect } from 'vitest';
import {
  bcToday, daysRemaining, toIsoDate, addDays, alertDateFor, urgencyBand,
  isActiveStatus, formatDaysRemaining, formatSyncTimestamp, formatGovernmentDate,
  BC_TIMEZONE,
} from '../src/utils/tenureDates.js';

// These tests exist because a one-day error here is a missed mineral-claim
// deadline. Every case below is a way that "just use new Date()" gets it wrong.

describe('bcToday', () => {
  it('resolves the B.C. calendar date, not the UTC one', () => {
    // 05:00 UTC on Aug 1 is 22:00 on July 31 in Vancouver. A user in London
    // refreshing their portfolio at breakfast must not see tomorrow's date.
    expect(bcToday(new Date('2026-08-01T05:00:00Z'))).toBe('2026-07-31');
  });

  it('rolls over at the correct instant during daylight time (UTC-7)', () => {
    expect(bcToday(new Date('2026-08-01T06:59:00Z'))).toBe('2026-07-31');
    expect(bcToday(new Date('2026-08-01T07:00:00Z'))).toBe('2026-08-01');
  });

  it('rolls over at the correct instant during standard time (UTC-8)', () => {
    expect(bcToday(new Date('2026-01-15T07:59:00Z'))).toBe('2026-01-14');
    expect(bcToday(new Date('2026-01-15T08:00:00Z'))).toBe('2026-01-15');
  });

  it('uses the America/Vancouver zone explicitly', () => {
    expect(BC_TIMEZONE).toBe('America/Vancouver');
  });
});

describe('toIsoDate', () => {
  it('accepts a bare date unchanged', () => {
    expect(toIsoDate('2027-03-14')).toBe('2027-03-14');
  });

  it('keeps the UTC calendar date when the source sends midnight-UTC', () => {
    // WFS emits '2027-03-14T00:00:00Z' for what is really a plain date.
    // Converting that to Pacific would walk every good-to-date back a day.
    expect(toIsoDate('2027-03-14T00:00:00Z')).toBe('2027-03-14');
  });

  it('accepts epoch milliseconds', () => {
    expect(toIsoDate(Date.UTC(2027, 2, 14))).toBe('2027-03-14');
  });

  it('rejects impossible calendar dates that still match the pattern', () => {
    expect(toIsoDate('2027-02-31')).toBeNull();
    expect(toIsoDate('2027-13-01')).toBeNull();
  });

  it('returns null rather than a guess for empty input', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
  });
});

describe('daysRemaining', () => {
  const now = new Date('2026-08-01T18:00:00Z'); // 11:00 in Vancouver

  it('counts calendar days to the deadline', () => {
    expect(daysRemaining('2026-08-31', now)).toBe(30);
  });

  it('returns 0 on the day itself, not 1', () => {
    expect(daysRemaining('2026-08-01', now)).toBe(0);
  });

  it('goes negative once the date has passed', () => {
    expect(daysRemaining('2026-07-25', now)).toBe(-7);
  });

  it('returns null — never 0 — when there is no usable date', () => {
    // "0 days remaining" on a claim with no published date would read as
    // "expires today", which is a fabricated emergency.
    expect(daysRemaining(null, now)).toBeNull();
    expect(daysRemaining('', now)).toBeNull();
  });

  it('is unaffected by the spring-forward transition', () => {
    // March 8 2026 is the DST change. Naive 24h arithmetic loses an hour here
    // and can round a 14-day gap to 13.
    expect(daysRemaining('2026-03-15', new Date('2026-03-01T20:00:00Z'))).toBe(14);
  });

  it('is unaffected by the fall-back transition', () => {
    expect(daysRemaining('2026-11-08', new Date('2026-11-01T19:00:00Z'))).toBe(7);
  });

  it('spans a year boundary correctly', () => {
    expect(daysRemaining('2027-01-01', new Date('2026-12-25T20:00:00Z'))).toBe(7);
  });

  it('handles a leap day', () => {
    expect(daysRemaining('2028-03-01', new Date('2028-02-28T20:00:00Z'))).toBe(2);
  });
});

describe('addDays / alertDateFor', () => {
  it('adds across a month boundary', () => {
    expect(addDays('2026-03-01', 14)).toBe('2026-03-15');
  });

  it('adds across a year boundary', () => {
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });

  it('computes the alert date as good-to-date minus the offset', () => {
    expect(alertDateFor('2027-03-14', 90)).toBe('2026-12-14');
    expect(alertDateFor('2027-03-14', 30)).toBe('2027-02-12');
    expect(alertDateFor('2027-03-14', 7)).toBe('2027-03-07');
  });

  it('treats a negative offset as the same number of days before', () => {
    expect(alertDateFor('2027-03-14', -30)).toBe(alertDateFor('2027-03-14', 30));
  });

  it('returns null for an unusable date rather than inventing one', () => {
    expect(alertDateFor(null, 30)).toBeNull();
  });
});

describe('urgencyBand', () => {
  it('maps day counts to the documented bands', () => {
    expect(urgencyBand(-1).id).toBe('expired');
    expect(urgencyBand(0).id).toBe('critical');
    expect(urgencyBand(7).id).toBe('critical');
    expect(urgencyBand(8).id).toBe('urgent');
    expect(urgencyBand(30).id).toBe('urgent');
    expect(urgencyBand(31).id).toBe('soon');
    expect(urgencyBand(90).id).toBe('soon');
    expect(urgencyBand(91).id).toBe('watch');
    expect(urgencyBand(180).id).toBe('watch');
    expect(urgencyBand(181).id).toBe('ok');
  });

  it('has its own band for a missing date instead of guessing', () => {
    expect(urgencyBand(null).id).toBe('unknown');
    expect(urgencyBand(null).label).toMatch(/verify in mto/i);
  });

  it('treats a non-active status as expired regardless of the printed date', () => {
    expect(urgencyBand(400, 'CANCELLED').id).toBe('expired');
    expect(urgencyBand(400, 'GOOD').id).toBe('ok');
  });

  it('carries a non-colour indicator for every band', () => {
    // WCAG 1.4.1: urgency must never be conveyed by colour alone.
    for (const days of [-1, 0, 20, 60, 120, 400, null]) {
      const band = urgencyBand(days);
      expect(band.icon).toBeTruthy();
      expect(band.label).toBeTruthy();
    }
  });
});

describe('isActiveStatus', () => {
  it('recognises the statuses that mean good standing', () => {
    expect(isActiveStatus('GOOD')).toBe(true);
    expect(isActiveStatus('good standing')).toBe(true);
  });

  it('denies by default on unknown or absent wording', () => {
    // Showing an extra "verify in MTO" prompt is a far cheaper mistake than
    // presenting a lapsed title as held.
    expect(isActiveStatus('')).toBe(false);
    expect(isActiveStatus(null)).toBe(false);
    expect(isActiveStatus('SOMETHING NEW')).toBe(false);
    expect(isActiveStatus('CANCELLED')).toBe(false);
  });
});

describe('display helpers', () => {
  it('phrases days remaining in plain language', () => {
    expect(formatDaysRemaining(0)).toBe('Today');
    expect(formatDaysRemaining(1)).toBe('Tomorrow');
    expect(formatDaysRemaining(30)).toBe('30 days');
    expect(formatDaysRemaining(-1)).toBe('1 day ago');
    expect(formatDaysRemaining(null)).toBe('Date unavailable');
  });

  it('says a field is unpublished rather than showing a blank', () => {
    expect(formatGovernmentDate(null)).toMatch(/not published/i);
    expect(formatGovernmentDate('2027-03-14')).toBe('2027-03-14');
  });

  it('renders sync timestamps in Pacific time with the zone named', () => {
    expect(formatSyncTimestamp('2026-08-01T18:32:00Z')).toBe('2026-08-01 11:32 PDT');
    expect(formatSyncTimestamp('2026-01-15T18:32:00Z')).toBe('2026-01-15 10:32 PST');
    expect(formatSyncTimestamp('nonsense')).toBe('never');
  });
});
