import { describe, it, expect } from 'vitest';
import {
  tenureKind, isApplication, kindBadge, kindLabel, TENURE_KIND,
} from '../src/utils/tenureKind';
import {
  isPlaceholderDate, daysRemaining, urgencyBand, formatGovernmentDate,
} from '../src/utils/tenureDates';
import { planExpiryAlerts } from '../scripts/tenure-alerts/plan.mjs';
import { expiryEmail } from '../scripts/tenure-alerts/templates.mjs';

// Applications versus granted titles.
//
// The B.C. layer publishes both in one feature class. The 2026-08 full sync
// put 2,549 applications in the mirror alongside 39,767 granted claims, leases
// and licences, and until tenureKind existed nothing downstream told them
// apart. These tests pin the distinction at every point it can be lost.

describe('classifying a tenure record', () => {
  it('reads the province\'s own subtype', () => {
    expect(tenureKind({ tenure_subtype: 'APPLICATION' })).toBe(TENURE_KIND.APPLICATION);
    expect(tenureKind({ tenure_subtype: 'CLAIM' })).toBe(TENURE_KIND.GRANTED);
    expect(tenureKind({ tenure_subtype: 'LEASE' })).toBe(TENURE_KIND.GRANTED);
    expect(tenureKind({ tenure_subtype: 'LICENSE' })).toBe(TENURE_KIND.GRANTED);
  });

  it('never uses the title type as the discriminator', () => {
    // THE TRAP THIS PINS. "Mineral Cell Title Submission" is carried by 25,401
    // granted CLAIMs and by 1,725 APPLICATIONs alike — the word "Submission"
    // describes how a claim was staked, not whether it was granted. Anything
    // that reached for the title type would call two-thirds of the province's
    // live mineral claims an application.
    const granted = { tenure_subtype: 'CLAIM', raw_source_data: { TITLE_TYPE_DESCRIPTION: 'Mineral Cell Title Submission' } };
    const pending = { tenure_subtype: 'APPLICATION', raw_source_data: { TITLE_TYPE_DESCRIPTION: 'Mineral Cell Title Submission' } };
    expect(isApplication(granted)).toBe(false);
    expect(isApplication(pending)).toBe(true);
  });

  it('treats an unrecognised subtype as unknown rather than granted', () => {
    // Defaulting an unfamiliar value to "granted" would quietly reintroduce the
    // exact confusion this module removes, the next time the province adds a
    // category.
    expect(tenureKind({ tenure_subtype: 'RESERVATION' })).toBe(TENURE_KIND.UNKNOWN);
    expect(tenureKind({ tenure_subtype: null })).toBe(TENURE_KIND.UNKNOWN);
    expect(tenureKind(null)).toBe(TENURE_KIND.UNKNOWN);
  });

  it('badges only the exceptional kinds', () => {
    // A badge on every granted claim teaches people to stop reading badges.
    expect(kindBadge({ tenure_subtype: 'CLAIM' })).toBeNull();
    expect(kindBadge({ tenure_subtype: 'APPLICATION' })?.label).toBe('Application');
    expect(kindBadge({ tenure_subtype: 'RESERVATION' })?.id).toBe('unknown');
  });

  it('names the instrument rather than flattening it', () => {
    expect(kindLabel({ tenure_subtype: 'CLAIM' })).toBe('Granted — claim');
    expect(kindLabel({ tenure_subtype: 'LEASE' })).toBe('Granted — lease');
    expect(kindLabel({ tenure_subtype: 'LICENSE' })).toBe('Granted — licence');
    expect(kindLabel({ tenure_subtype: 'APPLICATION' })).toBe('Application');
  });
});

describe('an expiry reminder for an application', () => {
  const base = {
    tenure_number: '1136904',
    tenure_name: 'Ashnola5',
    good_to_date: '2026-09-04',
    area_hectares: 2111,
  };
  const context = (subtype) => ({
    tenure: { ...base, tenure_subtype: subtype },
    owners: [{ owner_name: 'Example Resources Ltd.' }],
    portfolioName: 'Test',
    membership: {},
    lastSyncedAt: '2026-08-05T11:00:00Z',
    now: new Date('2026-08-05T18:00:00Z'),
  });

  it('does not call the date a good-to-date', () => {
    // "Ashnola5 reaches its good-to-date in 30 days" reads as a maintenance
    // deadline on ground you hold. On an application it is not that, and
    // somebody could spend money defending ground they have not been granted.
    const mail = expiryEmail(context('APPLICATION'));
    expect(mail.subject).not.toMatch(/good-to-date/i);
    expect(mail.subject).toMatch(/application/i);
    expect(mail.html).not.toMatch(/must be maintained to stay in good/i);
    expect(mail.text).not.toMatch(/must be maintained to stay in good/i);
  });

  it('says what an application is, in both parts of the mail', () => {
    const mail = expiryEmail(context('APPLICATION'));
    for (const part of [mail.html, mail.text]) {
      expect(part).toMatch(/not held ground/i);
      expect(part).toMatch(/MTO/);
    }
  });

  it('leaves a granted claim\'s wording exactly as it was', () => {
    const mail = expiryEmail(context('CLAIM'));
    expect(mail.subject).toBe('Ashnola5 reaches its good-to-date in 30 days');
    expect(mail.html).toMatch(/must be maintained to stay in good/i);
    expect(mail.text).not.toMatch(/not held ground/i);
  });

  it('says "1 day remaining" in the plain-text part, not "1 days"', () => {
    // The 1-day reminder is the most urgent mail this product sends, and the
    // text/plain alternative is what reaches a phone with HTML blocked.
    const mail = expiryEmail({
      ...context('CLAIM'),
      tenure: { ...base, tenure_subtype: 'CLAIM', good_to_date: '2026-08-06' },
    });
    expect(mail.text).toContain('1 day remaining');
    expect(mail.text).not.toContain('1 days remaining');
  });
});

describe('placeholder government dates', () => {
  it('recognises the sentinels the feed actually carries', () => {
    expect(isPlaceholderDate('1900-01-01')).toBe(true);
    expect(isPlaceholderDate('9999-12-31')).toBe(true);
    expect(isPlaceholderDate('2027-03-14')).toBe(false);
    expect(isPlaceholderDate(null)).toBe(false);
  });

  it('spares real nineteenth-century titles', () => {
    // B.C.'s oldest genuine issue date in the mirror is 1891-07-29. A "before
    // 1950" heuristic would have discarded real records to catch three fake
    // ones, so the rule is an exact set rather than a cutoff.
    expect(isPlaceholderDate('1891-07-29')).toBe(false);
  });

  it('reads as no date rather than as a date from 1900', () => {
    const now = new Date('2026-08-05T18:00:00Z');
    expect(daysRemaining('1900-01-01', now)).toBeNull();
    expect(urgencyBand(daysRemaining('1900-01-01', now)).id).toBe('unknown');
    expect(formatGovernmentDate('1900-01-01')).toBe('Not published in the B.C. source');
  });

  it('schedules no reminder off one', () => {
    // The counting-down path already declined it (a 46,000-day-old date is
    // "past"), but so did the catch-up path that exists to make sure a claim
    // is never silently skipped. This pins that it stays declined for the
    // right reason — no usable date — rather than by accident.
    const rows = planExpiryAlerts(
      { portfolio_id: 'p1', tenure: { id: 't1', good_to_date: '1900-01-01' } },
      [90, 30, 1],
      [{ id: 'r1' }],
      new Date('2026-08-05T18:00:00Z'),
    );
    expect(rows).toEqual([]);
  });
});
