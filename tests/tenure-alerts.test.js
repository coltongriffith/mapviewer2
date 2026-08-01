import { describe, it, expect } from 'vitest';
import {
  planExpiryAlerts, planChangeAlerts, reconcileAlerts, alertKey, dueNow, maySend,
  ALERT_TYPE,
} from '../scripts/tenure-alerts/plan.mjs';
import { expiryEmail, changeEmail, notObservedEmail, renderAlert } from '../scripts/tenure-alerts/templates.mjs';

// A duplicate deadline email undermines trust in every other one, and a
// reminder that says "90 days" when there are 20 is worse than no reminder at
// all. These tests are the reason both statements stay true.

const NOW = new Date('2026-08-01T18:00:00Z'); // 2026-08-01 in Vancouver

const membership = (over = {}) => ({
  portfolio_id: 'p1',
  monitoring_enabled: true,
  tenure: {
    id: 't1',
    tenure_number: '1044501',
    tenure_name: 'Crystal Lake North',
    status: 'GOOD',
    good_to_date: '2027-03-14',
    area_hectares: 418.7,
    ...over.tenure,
  },
  ...over,
});

const recipient = (over = {}) => ({
  id: 'r1', email: 'geo@example.com',
  receives_expiry_alerts: true, receives_change_alerts: true, bounced_at: null,
  ...over,
});

describe('planExpiryAlerts — scheduling', () => {
  it('schedules one alert per offset per recipient', () => {
    const rows = planExpiryAlerts(membership(), [90, 30, 7], [recipient()], NOW);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.offset_days)).toEqual([90, 30, 7]);
  });

  it('dates each alert at good-to-date minus the offset', () => {
    const rows = planExpiryAlerts(membership(), [90, 30, 7], [recipient()], NOW);
    expect(rows.find((r) => r.offset_days === 90).scheduled_for).toBe('2026-12-14');
    expect(rows.find((r) => r.offset_days === 30).scheduled_for).toBe('2027-02-12');
    expect(rows.find((r) => r.offset_days === 7).scheduled_for).toBe('2027-03-07');
  });

  it('fans out across recipients', () => {
    const rows = planExpiryAlerts(
      membership(), [90], [recipient(), recipient({ id: 'r2', email: 'b@x.com' })], NOW,
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.recipient_id))).toEqual(new Set(['r1', 'r2']));
  });

  it('records the good-to-date each alert was computed from', () => {
    // This is what makes a moved deadline detectable rather than silently sent.
    const rows = planExpiryAlerts(membership(), [90], [recipient()], NOW);
    expect(rows[0].source_good_to_date).toBe('2027-03-14');
  });
});

describe('planExpiryAlerts — the things it refuses to do', () => {
  it('never back-dates a threshold that has already passed', () => {
    // 20 days out: the 90- and 30-day thresholds are in the past. Sending
    // "90 days remaining" today would be a lie the recipient plans around.
    const rows = planExpiryAlerts(
      membership({ tenure: { good_to_date: '2026-08-21' } }), [90, 30, 7], [recipient()], NOW,
    );
    expect(rows.some((r) => r.offset_days === 90)).toBe(false);
    expect(rows.some((r) => r.offset_days === 30)).toBe(false);
    expect(rows.find((r) => r.offset_days === 7).scheduled_for).toBe('2026-08-14');
  });

  it('leaves no gap when every standard threshold has passed', () => {
    // 3 days out with offsets [90,30,7]: all passed. Without a catch-up the
    // user would be monitoring a claim and never hear a word about it.
    const rows = planExpiryAlerts(
      membership({ tenure: { good_to_date: '2026-08-04' } }), [90, 30, 7], [recipient()], NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduled_for).toBe('2026-08-01');
    // The offset IS the real days remaining, so the email says something true.
    expect(rows[0].offset_days).toBe(3);
  });

  it('schedules nothing for a claim with no published good-to-date', () => {
    expect(planExpiryAlerts(
      membership({ tenure: { good_to_date: null } }), [90, 30], [recipient()], NOW,
    )).toEqual([]);
  });

  it('schedules nothing for a date that has already gone', () => {
    expect(planExpiryAlerts(
      membership({ tenure: { good_to_date: '2026-07-01' } }), [90, 30], [recipient()], NOW,
    )).toEqual([]);
  });

  it('schedules nothing when the user turned reminders off for that claim', () => {
    expect(planExpiryAlerts(
      membership({ monitoring_enabled: false }), [90], [recipient()], NOW,
    )).toEqual([]);
  });

  it('skips a recipient whose address has hard-bounced', () => {
    expect(planExpiryAlerts(
      membership(), [90], [recipient({ bounced_at: '2026-07-01T00:00:00Z' })], NOW,
    )).toEqual([]);
  });

  it('skips a recipient who opted out of expiry reminders', () => {
    expect(planExpiryAlerts(
      membership(), [90], [recipient({ receives_expiry_alerts: false })], NOW,
    )).toEqual([]);
  });

  it('de-duplicates repeated offsets in a policy', () => {
    const rows = planExpiryAlerts(membership(), [90, 90, 30], [recipient()], NOW);
    expect(rows).toHaveLength(2);
  });
});

describe('reconcileAlerts — idempotency and recalculation', () => {
  const planned = () => planExpiryAlerts(membership(), [90, 30, 7], [recipient()], NOW);

  it('inserts everything on a first run', () => {
    const { toInsert, toSupersede } = reconcileAlerts(planned(), []);
    expect(toInsert).toHaveLength(3);
    expect(toSupersede).toEqual([]);
  });

  it('inserts nothing on a second run', () => {
    // THE property that makes a daily cron safe.
    const existing = planned().map((p, i) => ({ ...p, id: `e${i}`, status: 'pending' }));
    const { toInsert, toSupersede } = reconcileAlerts(planned(), existing);
    expect(toInsert).toEqual([]);
    expect(toSupersede).toEqual([]);
  });

  it('does not re-propose an alert that was already SENT', () => {
    // The unique index spans every status. Re-proposing a sent alert would
    // collide on every run forever — and relaxing the key to "fix" that is how
    // you start sending the same deadline twice.
    const existing = planned().map((p, i) => ({ ...p, id: `e${i}`, status: 'sent' }));
    expect(reconcileAlerts(planned(), existing).toInsert).toEqual([]);
  });

  it('never supersedes a sent alert', () => {
    const existing = [{
      ...planned()[0], id: 'old', status: 'sent', source_good_to_date: '2026-01-01',
    }];
    expect(reconcileAlerts(planned(), existing).toSupersede).toEqual([]);
  });

  it('supersedes and replaces pending alerts when the good-to-date moves', () => {
    const oldPlan = planExpiryAlerts(membership(), [90, 30, 7], [recipient()], NOW)
      .map((p, i) => ({ ...p, id: `old${i}`, status: 'pending' }));
    const moved = planExpiryAlerts(
      membership({ tenure: { good_to_date: '2027-06-14' } }), [90, 30, 7], [recipient()], NOW,
    );

    const { toInsert, toSupersede } = reconcileAlerts(moved, oldPlan);
    expect(toSupersede).toHaveLength(3);          // every stale one retired
    expect(toInsert).toHaveLength(3);             // fresh set against the new date
    expect(toInsert.every((r) => r.source_good_to_date === '2027-06-14')).toBe(true);
  });

  it('retires pending alerts when the policy drops a threshold', () => {
    const before = planExpiryAlerts(membership(), [90, 30, 7], [recipient()], NOW)
      .map((p, i) => ({ ...p, id: `x${i}`, status: 'pending' }));
    const after = planExpiryAlerts(membership(), [90, 30], [recipient()], NOW);
    const { toInsert, toSupersede } = reconcileAlerts(after, before);
    expect(toInsert).toEqual([]);
    expect(toSupersede).toHaveLength(1);
  });
});

describe('alertKey', () => {
  it('mirrors the database unique index, including its null coalescing', () => {
    // Postgres treats NULLs as distinct in a unique index. If this function
    // disagreed with the index's coalesce(), the duplicate door reopens.
    const a = alertKey({
      portfolio_id: 'p', tenure_id: 't', recipient_id: 'r',
      alert_type: 'EXPIRY', offset_days: 30, source_good_to_date: null, change_event_id: null,
    });
    const b = alertKey({
      portfolio_id: 'p', tenure_id: 't', recipient_id: 'r',
      alert_type: 'EXPIRY', offset_days: 30,
    });
    expect(a).toBe(b);
  });

  it('separates the same threshold against two different deadlines', () => {
    const base = { portfolio_id: 'p', tenure_id: 't', recipient_id: 'r', alert_type: 'EXPIRY', offset_days: 30 };
    expect(alertKey({ ...base, source_good_to_date: '2027-03-14' }))
      .not.toBe(alertKey({ ...base, source_good_to_date: '2027-06-14' }));
  });

  it('separates two recipients', () => {
    const base = { portfolio_id: 'p', tenure_id: 't', alert_type: 'EXPIRY', offset_days: 30 };
    expect(alertKey({ ...base, recipient_id: 'r1' })).not.toBe(alertKey({ ...base, recipient_id: 'r2' }));
  });
});

describe('dueNow', () => {
  const rows = [
    { id: 'a', scheduled_for: '2026-07-25' },   // overdue — a missed run
    { id: 'b', scheduled_for: '2026-08-01' },   // today
    { id: 'c', scheduled_for: '2026-08-02' },   // future
  ];

  it('catches up on anything overdue rather than dropping it', () => {
    // GitHub's scheduler is best-effort and skips runs. A missed day must
    // delay a reminder, not lose it.
    expect(dueNow(rows, NOW).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('maySend — the suppression rule', () => {
  const expiry = { alert_type: ALERT_TYPE.EXPIRY };
  const change = { alert_type: ALERT_TYPE.CHANGE };
  const absence = { alert_type: ALERT_TYPE.NOT_OBSERVED };
  const clean = { alertsSafe: true, portfolioPaused: false, globalPause: false };

  it('sends everything after a clean import', () => {
    expect(maySend(expiry, clean).send).toBe(true);
    expect(maySend(change, clean).send).toBe(true);
  });

  it('holds change notices when the last import was not trustworthy', () => {
    // A change notice is a claim about what the province did. If the import
    // was incomplete, we do not actually know that anything happened.
    const held = maySend(change, { ...clean, alertsSafe: false });
    expect(held.send).toBe(false);
    expect(held.reason).toMatch(/incomplete/);
    expect(maySend(absence, { ...clean, alertsSafe: false }).send).toBe(false);
  });

  it('STILL SENDS expiry reminders after a failed import', () => {
    // The asymmetry is deliberate. A good-to-date already read from a
    // successful import does not become wrong because a later sync failed.
    // Going quiet about a real deadline because of a problem at our end is the
    // worse of the two failures.
    expect(maySend(expiry, { ...clean, alertsSafe: false }).send).toBe(true);
  });

  it('honours a per-portfolio pause', () => {
    expect(maySend(expiry, { ...clean, portfolioPaused: true }).send).toBe(false);
  });

  it('honours the global kill switch, including for expiry', () => {
    expect(maySend(expiry, { ...clean, globalPause: true }).send).toBe(false);
  });
});

describe('planChangeAlerts', () => {
  const change = { id: 'c1', event_type: 'GOOD_TO_DATE_CHANGED', severity: 'critical' };

  it('raises one notice per change per recipient', () => {
    const rows = planChangeAlerts(membership(), change, [recipient()], {}, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].alert_type).toBe(ALERT_TYPE.CHANGE);
    expect(rows[0].change_event_id).toBe('c1');
  });

  it('uses the distinct NOT_OBSERVED type for an absent title', () => {
    // A different type because it needs a different, far more cautious email.
    const rows = planChangeAlerts(
      membership(), { id: 'c2', event_type: 'TENURE_NO_LONGER_OBSERVED' }, [recipient()], {}, NOW,
    );
    expect(rows[0].alert_type).toBe(ALERT_TYPE.NOT_OBSERVED);
  });

  it('respects a policy with change notices switched off', () => {
    expect(planChangeAlerts(
      membership(), change, [recipient()], { change_events_enabled: false }, NOW,
    )).toEqual([]);
  });

  it('skips recipients who opted out of change notices', () => {
    expect(planChangeAlerts(
      membership(), change, [recipient({ receives_change_alerts: false })], {}, NOW,
    )).toEqual([]);
  });
});

describe('email templates', () => {
  const context = {
    tenure: membership().tenure,
    owners: [{ owner_name: 'GOLIATH RESOURCES LTD.' }],
    portfolioName: 'Crystal Lake',
    membership: { maintenance_decision: 'INTEND_TO_MAINTAIN', internal_project_name: 'Crystal Lake' },
    lastSyncedAt: '2026-08-01T11:00:00Z',
    now: new Date('2027-02-12T18:00:00Z'),   // exactly 30 days out
  };

  it('uses the specified subject shape', () => {
    expect(expiryEmail(context).subject).toBe('Crystal Lake North reaches its good-to-date in 30 days');
  });

  it('phrases today and tomorrow in words rather than "in 0 days"', () => {
    expect(expiryEmail({ ...context, now: new Date('2027-03-14T18:00:00Z') }).subject)
      .toMatch(/good-to-date today/);
    expect(expiryEmail({ ...context, now: new Date('2027-03-13T18:00:00Z') }).subject)
      .toMatch(/good-to-date tomorrow/);
  });

  it('carries everything the spec requires', () => {
    const { html, text } = expiryEmail(context);
    for (const body of [html, text]) {
      expect(body).toMatch(/1044501/);                      // tenure number
      expect(body).toMatch(/Crystal Lake North/);           // claim name
      expect(body).toMatch(/GOLIATH RESOURCES LTD/);        // registered owner
      expect(body).toMatch(/2027-03-14/);                   // good-to-date
      expect(body).toMatch(/30 days remaining/);            // days remaining
      expect(body).toMatch(/tenure-monitor/);               // review link
      expect(body).toMatch(/mtonline\.gov\.bc\.ca/);        // verification link
      expect(body).toMatch(/last synchronized/i);           // sync timestamp
      expect(body).toMatch(/not a legal notice/i);          // disclaimer
    }
    expect(html).toMatch(/\?tenure=1044501/);               // open-in-editor link
  });

  it('never claims Exploration Maps will maintain the claim', () => {
    const { html, text } = expiryEmail(context);
    for (const body of [html, text]) {
      expect(body).toMatch(/does not file|do not file/i);
      expect(body).not.toMatch(/we will (renew|maintain|file|pay)/i);
    }
  });

  it('states the recorded decision so the reminder is actionable', () => {
    expect(expiryEmail(context).html).toMatch(/Intend to maintain/);
  });

  it('says the owner is unpublished rather than leaving it blank', () => {
    expect(expiryEmail({ ...context, owners: [] }).html)
      .toMatch(/Not published in the B\.C\. source/);
  });

  it('describes a change without asserting more than was observed', () => {
    const { subject, html } = changeEmail({
      tenure: context.tenure,
      change: { event_type: 'OWNER_REMOVED', previous_value: 'Alpha Mining Ltd', current_value: null },
      portfolioName: 'Crystal Lake',
      lastSyncedAt: context.lastSyncedAt,
    });
    expect(subject).toMatch(/a registered owner was removed/);
    expect(html).toMatch(/Confirm it in the official registry/);
  });

  it('refuses to describe a missing record as expired, lapsed or available', () => {
    // THE most carefully worded email in the product. Telling somebody their
    // claim is gone when it is not could send them to restake ground they
    // already hold.
    const { subject, html, text } = notObservedEmail({
      tenure: context.tenure, portfolioName: 'Crystal Lake', lastSyncedAt: context.lastSyncedAt,
    });
    expect(subject).toMatch(/not found in the latest B\.C\. dataset/);
    for (const body of [html, text]) {
      expect(body).toMatch(/not.{0,30}confirmation that the title has lapsed/i);
      expect(body).toMatch(/Verify its status in MTO/i);
    }
    // The end-state words may appear ONLY inside the negation above. Strip that
    // clause and there must be nothing left claiming the title has ended —
    // telling somebody their claim is gone when it is not could send them to
    // restake ground they already hold.
    for (const body of [html, text]) {
      // Whitespace is flexible because the HTML and plain-text bodies wrap the
      // same sentence at different points.
      const withoutNegation = body.replace(
        /confirmation\s+that\s+the\s+title\s+has\s+lapsed,\s+been\s+terminated,\s+or\s+become\s+available/is,
        '',
      );
      expect(withoutNegation).not.toMatch(/lapsed|expired|terminated|released|available for staking|open ground/i);
    }
  });

  it('routes each alert type to its own template', () => {
    expect(renderAlert({ alert_type: 'EXPIRY' }, context).subject).toMatch(/good-to-date/);
    expect(renderAlert({ alert_type: 'NOT_OBSERVED' }, context).subject).toMatch(/not found/);
    expect(renderAlert(
      { alert_type: 'CHANGE' },
      { ...context, change: { event_type: 'STATUS_CHANGED', previous_value: 'GOOD', current_value: 'PENDING' } },
    ).subject).toMatch(/status changed/);
  });
});
