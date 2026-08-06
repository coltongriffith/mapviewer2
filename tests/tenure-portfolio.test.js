import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  reconcileRows, reconciliationSummary, mapColumns, buildScheduleCsv,
  ROW_STATUS, decisionLabel,
} from '../src/utils/tenureCsv.js';
import { normalizeOwnerQuery } from '../api/tenure-search.js';
import { normalizeOwnerName } from '../src/utils/tenureOwners.js';
import {
  ENTITLEMENTS, TIERS, canMonitorMoreTenures, remainingTenureSlots,
  canCreatePortfolio, canAddAlertRecipient, alertOffsetsFor, lockedAlertOffsets,
} from '../src/utils/entitlements.js';

const tenure = (over = {}) => ({
  id: over.id || 'a0000000-0000-4000-8000-000000000001',
  tenure_number: '1044501',
  tenure_name: 'Crystal Lake North',
  status: 'GOOD',
  good_to_date: '2027-03-14',
  area_hectares: 418.7,
  ...over,
});

const row = (line, over = {}) => ({
  line,
  tenureNumber: null, claimName: null, ownerName: null, projectName: null, internalNotes: null,
  ...over,
});

describe('CSV column mapping', () => {
  it('recognises the documented column names', () => {
    const { mapping } = mapColumns(['tenure_number', 'claim_name', 'owner_name', 'project_name']);
    expect(mapping.tenure_number).toBe('tenure_number');
    expect(mapping.claim_name).toBe('claim_name');
    expect(mapping.owner_name).toBe('owner_name');
    expect(mapping.project_name).toBe('project_name');
  });

  it('accepts the spellings real claim schedules use', () => {
    const { mapping } = mapColumns(['Tenure No', 'Claim Name', 'Registered Owner', 'Property']);
    expect(mapping.tenure_number).toBe('Tenure No');
    expect(mapping.claim_name).toBe('Claim Name');
    expect(mapping.owner_name).toBe('Registered Owner');
    expect(mapping.project_name).toBe('Property');
  });

  it('reports columns it did not understand rather than dropping them silently', () => {
    const { unmapped } = mapColumns(['tenure_number', 'NSR royalty', 'vendor']);
    expect(unmapped).toEqual(['NSR royalty', 'vendor']);
  });
});

describe('CSV reconciliation', () => {
  it('matches a row with exactly one hit', () => {
    const rows = [row(2, { tenureNumber: '1044501' })];
    const { entries, counts, autoAddIds } = reconcileRows(
      rows, new Map([[2, [tenure()]]]),
    );
    expect(entries[0].status).toBe(ROW_STATUS.MATCHED);
    expect(counts[ROW_STATUS.MATCHED]).toBe(1);
    expect(autoAddIds).toHaveLength(1);
  });

  it('never auto-selects an ambiguous row', () => {
    // Picking one of several candidates for the user is how somebody ends up
    // monitoring a claim they do not own — and not monitoring the one they do.
    const rows = [row(2, { ownerName: 'Goliath' })];
    const { entries, autoAddIds } = reconcileRows(rows, new Map([[2, [
      tenure({ id: 'a0000000-0000-4000-8000-000000000001' }),
      tenure({ id: 'a0000000-0000-4000-8000-000000000002', tenure_number: '1044502' }),
    ]]]));
    expect(entries[0].status).toBe(ROW_STATUS.MULTIPLE);
    expect(autoAddIds).toEqual([]);
  });

  it('reports a row that matched nothing instead of discarding it', () => {
    const { entries, counts } = reconcileRows(
      [row(2, { tenureNumber: '9999999' })], new Map([[2, []]]),
    );
    expect(entries[0].status).toBe(ROW_STATUS.NOT_FOUND);
    expect(entries[0].detail).toMatch(/MTO/);
    expect(counts[ROW_STATUS.NOT_FOUND]).toBe(1);
  });

  it('flags a row with nothing to search on, naming its line', () => {
    const { entries } = reconcileRows([row(7)], new Map());
    expect(entries[0].status).toBe(ROW_STATUS.INVALID);
    expect(entries[0].row.line).toBe(7);
  });

  it('catches a duplicate tenure number within one file', () => {
    const rows = [row(2, { tenureNumber: '1044501' }), row(3, { tenureNumber: '1044501' })];
    const { entries } = reconcileRows(rows, new Map([[2, [tenure()]], [3, [tenure()]]]));
    expect(entries[0].status).toBe(ROW_STATUS.MATCHED);
    expect(entries[1].status).toBe(ROW_STATUS.DUPLICATE);
  });

  it('marks a title already in the portfolio rather than adding it twice', () => {
    const t = tenure();
    const { entries, autoAddIds } = reconcileRows(
      [row(2, { tenureNumber: '1044501' })], new Map([[2, [t]]]), new Set([t.id]),
    );
    expect(entries[0].status).toBe(ROW_STATUS.ALREADY_MONITORED);
    expect(autoAddIds).toEqual([]);
  });

  it('separates a matched-but-inactive title from one in good standing', () => {
    const { entries, autoAddIds } = reconcileRows(
      [row(2, { tenureNumber: '1044503' })],
      new Map([[2, [tenure({ status: 'CANCELLED' })]]]),
    );
    expect(entries[0].status).toBe(ROW_STATUS.INACTIVE);
    // Importable, but the user opts in — it is not silently mixed in with the
    // claims they still hold.
    expect(autoAddIds).toEqual([]);
    expect(entries[0].detail).toMatch(/CANCELLED/);
  });

  it('accounts for every row exactly once', () => {
    // The property that makes "nothing is silently discarded" true.
    const rows = [
      row(2, { tenureNumber: '1044501' }),
      row(3, { tenureNumber: '9999999' }),
      row(4, {}),
      row(5, { tenureNumber: '1044501' }),
      row(6, { ownerName: 'Ambiguous' }),
    ];
    const { entries, counts } = reconcileRows(rows, new Map([
      [2, [tenure()]],
      [3, []],
      [5, [tenure()]],
      [6, [tenure({ id: 'x1' }), tenure({ id: 'x2' })]],
    ]));
    expect(entries).toHaveLength(rows.length);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(rows.length);
  });

  it('summarizes a mixed result in one honest line', () => {
    const counts = {
      [ROW_STATUS.MATCHED]: 26, [ROW_STATUS.NOT_FOUND]: 4,
      [ROW_STATUS.MULTIPLE]: 0, [ROW_STATUS.INACTIVE]: 0,
      [ROW_STATUS.DUPLICATE]: 0, [ROW_STATUS.ALREADY_MONITORED]: 0,
      [ROW_STATUS.INVALID]: 0,
    };
    expect(reconciliationSummary(counts)).toBe('26 matched, 4 not found');
  });
});

describe('claim schedule export', () => {
  const rows = [{
    tenure: tenure(),
    owners: [{ owner_name: 'GOLIATH RESOURCES LTD.' }],
    internalProjectName: 'Crystal Lake',
    maintenanceDecision: 'INTEND_TO_MAINTAIN',
    internalNotes: 'Assessment filed',
    monitoringEnabled: true,
  }];

  it('carries the last-sync timestamp and the MTO notice inside the file', () => {
    // A spreadsheet gets forwarded, printed, and read months later, long after
    // whatever screen it came from is gone. The caveats have to travel with it.
    const csv = buildScheduleCsv(rows, {
      portfolioName: 'Crystal Lake',
      lastSyncedAt: '2026-08-01T11:00:00Z',
      now: new Date('2026-08-01T18:00:00Z'),
    });
    expect(csv).toMatch(/last synchronized: 2026-08-01T11:00:00.000Z/);
    expect(csv).toMatch(/verify in MTO/i);
    expect(csv).toMatch(/Open Government Licence/);
  });

  it('computes days remaining in Pacific time, not the exporter’s timezone', () => {
    const csv = buildScheduleCsv(rows, { now: new Date('2027-02-12T18:00:00Z') });
    expect(csv).toMatch(/"30"/);
  });

  it('says a date is unavailable rather than exporting a 0', () => {
    const csv = buildScheduleCsv(
      [{ ...rows[0], tenure: tenure({ good_to_date: null }) }],
      { now: new Date('2026-08-01T18:00:00Z') },
    );
    expect(csv).toMatch(/Date unavailable/);
  });

  it('labels an unset decision rather than exporting a raw enum', () => {
    expect(decisionLabel(undefined)).toBe('Undecided');
    expect(decisionLabel('INTEND_TO_ALLOW_LAPSE')).toBe('Intend to allow lapse');
  });
});

describe('owner query normalization agrees across the client and the API', () => {
  // api/tenure-search.js keeps its own copy because api/ is a separate
  // serverless bundle with no build step over src/. If the two ever disagree,
  // owner search silently returns nothing — so they are pinned here.
  const cases = [
    'GOLIATH RESOURCES LTD.',
    'Goliath Resources Limited',
    'Métaux Rares Inc',
    'Smith & Jones Exploration Corp.',
    'Teck Resources Limited',
    'New Found Gold Corp',
    'Northern Prospecting Co.',
  ];

  for (const name of cases) {
    it(`folds "${name}" identically`, () => {
      expect(normalizeOwnerQuery(name)).toBe(normalizeOwnerName(name));
    });
  }

  it('yields an empty key for a name that is only a suffix', () => {
    expect(normalizeOwnerQuery('Ltd.')).toBe('');
  });
});

describe('Tenure Monitor entitlements', () => {
  const free = ENTITLEMENTS[TIERS.FREE];
  const pro = ENTITLEMENTS[TIERS.PRO];

  it('matches the limits the database enforces', () => {
    // Mirrors public.tenure_plan_limits() in migration 20260801000003. If these
    // drift, users are shown a limit the server does not apply, or walk into
    // one it does with no explanation.
    expect(free.max_monitored_tenures).toBe(10);
    expect(free.max_portfolios).toBe(1);
    expect(free.max_alert_recipients).toBe(1);
    expect(free.alert_offsets_days).toEqual([90, 30, 1]);

    expect(pro.max_monitored_tenures).toBe(50);
    expect(pro.max_portfolios).toBe(Infinity);
    expect(pro.max_alert_recipients).toBe(2);
    expect(pro.alert_offsets_days).toEqual([90, 30, 7, 1]);
  });

  it('gives every plan the final 1-day reminder', () => {
    // Not a Pro feature. Going quiet about a real deadline is the failure this
    // product exists to prevent — the same reasoning that makes expiry alerts
    // send even when an import is untrusted (plan.mjs maySend). The 7-day
    // offset carries the Pro distinction instead.
    //
    // This must stay in step with tenure_plan_limits() in migration
    // 20260807000001: tenure_policy_offsets_guard intersects every saved policy
    // against the DATABASE ladder, so a 1 present only here would be ticked in
    // the settings screen and silently stripped on save.
    for (const tier of [TIERS.FREE, TIERS.PRO, TIERS.COMPANY]) {
      expect(ENTITLEMENTS[tier].alert_offsets_days).toContain(1);
    }
    expect(ENTITLEMENTS[TIERS.ANONYMOUS].alert_offsets_days).toEqual([]);
  });

  it('lets an anonymous visitor search but not monitor', () => {
    const anon = ENTITLEMENTS[TIERS.ANONYMOUS];
    expect(anon.max_monitored_tenures).toBe(0);
    expect(anon.max_portfolios).toBe(0);
  });

  it('gates monitoring at the plan limit', () => {
    expect(canMonitorMoreTenures(free, 9)).toBe(true);
    expect(canMonitorMoreTenures(free, 10)).toBe(false);
    expect(canMonitorMoreTenures(free, 11)).toBe(false);
  });

  it('reports remaining slots, never a negative number', () => {
    expect(remainingTenureSlots(free, 3)).toBe(7);
    expect(remainingTenureSlots(free, 10)).toBe(0);
    expect(remainingTenureSlots(free, 40)).toBe(0);
    expect(remainingTenureSlots(pro, 0)).toBe(50);
  });

  it('gates portfolios and recipients', () => {
    expect(canCreatePortfolio(free, 0)).toBe(true);
    expect(canCreatePortfolio(free, 1)).toBe(false);
    expect(canCreatePortfolio(pro, 40)).toBe(true);
    expect(canAddAlertRecipient(free, 1)).toBe(false);
    expect(canAddAlertRecipient(pro, 1)).toBe(true);
  });

  it('orders reminder thresholds longest lead time first', () => {
    expect(alertOffsetsFor(pro)).toEqual([90, 30, 7, 1]);
    expect(alertOffsetsFor(free)).toEqual([90, 30, 1]);
  });

  it('names the thresholds an upgrade would unlock', () => {
    // Shown as locked rather than hidden: a free user should be able to see a
    // 7-day reminder exists. Only the 7 — free now has the 1-day itself, so
    // advertising it as an upgrade would be selling something already owned.
    expect(lockedAlertOffsets(free)).toEqual([7]);
    expect(lockedAlertOffsets(pro)).toEqual([]);
  });

  it('carries a Company shape that is defined but not sold', () => {
    const company = ENTITLEMENTS[TIERS.COMPANY];
    expect(company.max_monitored_tenures).toBe(500);
    expect(company.alert_offsets_days).toContain(1);
  });
});

// ── "Changed recently" means the same thing in the stat and the filter ─────
//
// The summary pill counts distinct tenures with a change event in the LAST 30
// DAYS (tenure_portfolio_summary, migration 20260801000003). The change feed
// the filter reads is fetched at 90 days, because the table's last-change
// column and the map's change colouring are both better with more history.
//
// Those two numbers disagreed. Clicking "2 changed recently" — or arriving on
// that filter from the dashboard, which promises the number out loud — could
// open a list of five: two from the last month and three from the two before
// it. A dashboard row that names a count and then shows a different one is
// worse than not offering the shortcut.
describe('the changed-recently window', () => {
  const DAY = 86_400_000;
  const now = new Date('2026-08-06T12:00:00Z');
  const ago = (days) => new Date(now.getTime() - days * DAY).toISOString();

  // Mirrors changedWithinWindow in TenureMonitorPage.jsx.
  const within = (change, days = 30) => {
    if (!change?.detected_at) return false;
    const at = new Date(change.detected_at).getTime();
    if (Number.isNaN(at)) return false;
    return now.getTime() - at <= days * DAY;
  };

  it('accepts a change inside the window and rejects one outside it', () => {
    expect(within({ detected_at: ago(1) })).toBe(true);
    expect(within({ detected_at: ago(29) })).toBe(true);
    expect(within({ detected_at: ago(31) })).toBe(false);
    expect(within({ detected_at: ago(89) })).toBe(false);
  });

  it('rejects a tenure with no change and an unparseable date', () => {
    expect(within(undefined)).toBe(false);
    expect(within({})).toBe(false);
    expect(within({ detected_at: 'not a date' })).toBe(false);
  });

  it('uses the same 30 days the SQL counts over', () => {
    // Read from both sides so the constant cannot drift from the migration
    // that defines it. If somebody widens one, this fails rather than the
    // pill quietly starting to disagree with the list again.
    const sql = readFileSync('supabase/migrations/20260801000003_tenure_quota_and_admin.sql', 'utf8');
    const changedBlock = sql.slice(sql.indexOf("'changed_recently'"), sql.indexOf("'changed_recently'") + 400);
    const sqlDays = Number(/interval '(\d+) days'/.exec(changedBlock)?.[1]);
    expect(sqlDays, 'the changed_recently window is not where this test expects it').toBe(30);

    const page = readFileSync('src/components/tenure/TenureMonitorPage.jsx', 'utf8');
    const uiDays = Number(/CHANGED_RECENTLY_DAYS\s*=\s*(\d+)/.exec(page)?.[1]);
    expect(uiDays, 'the UI filter window disagrees with the SQL the pill counts over').toBe(sqlDays);

    // And the filter must actually apply it — reading the feed's membership
    // alone is what produced the mismatch in the first place.
    expect(page, 'the changed filter no longer applies the window')
      .toContain("if (filter === 'changed') {");
    expect(page).toContain('changedWithinWindow(changesByTenure.get(r.tenure.id), now)');
  });
});
