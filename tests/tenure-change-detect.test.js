import { describe, it, expect } from 'vitest';
import {
  detectChanges, detectOwnerChanges, shouldSnapshot, notObservedEvent,
  reappearedEvent, EVENT, SEVERITY, AREA_TOLERANCE_RATIO,
} from '../scripts/tenure-sync/changeDetect.mjs';
import {
  normalizeOwnerName, classifyOwnerMatch, groupOwnerCandidates, splitOwnerField,
  ownerMatchPrompt, MATCH_CONFIDENCE,
} from '../src/utils/tenureOwners.js';

const BASE = {
  source_record_id: '1044501',
  tenure_number: '1044501',
  tenure_name: 'Crystal Lake North',
  tenure_type: 'Mineral',
  tenure_subtype: 'Claim',
  status: 'GOOD',
  issue_date: '2019-04-11',
  good_to_date: '2027-03-14',
  termination_date: null,
  area_hectares: 418.7,
  geometry_hash: 'aaaaaaaa',
};

const owner = (name, pct = null) => ({
  owner_name: name,
  normalized_owner_name: normalizeOwnerName(name),
  ownership_percentage: pct,
});

const types = (events) => events.map((e) => e.event_type);

describe('detectChanges — a new tenure', () => {
  it('emits nothing for a title we have never seen', () => {
    // Every record on the first import would otherwise produce a dozen events
    // and bury the real signal on day two.
    expect(detectChanges(null, BASE)).toEqual([]);
  });

  it('emits nothing when nothing moved', () => {
    expect(detectChanges(BASE, { ...BASE })).toEqual([]);
  });
});

describe('detectChanges — the deadline', () => {
  it('reports a good-to-date change', () => {
    const events = detectChanges(BASE, { ...BASE, good_to_date: '2028-03-14' });
    expect(types(events)).toContain(EVENT.GOOD_TO_DATE_CHANGED);
    expect(events[0].previous_value).toBe('2027-03-14');
    expect(events[0].current_value).toBe('2028-03-14');
  });

  it('treats an EARLIER date as critical — the user has less time than they were told', () => {
    const events = detectChanges(BASE, { ...BASE, good_to_date: '2026-09-01' });
    expect(events[0].severity).toBe(SEVERITY.CRITICAL);
    expect(events[0].metadata.moved_earlier).toBe(true);
  });

  it('treats a later date as notable, not critical', () => {
    const events = detectChanges(BASE, { ...BASE, good_to_date: '2029-01-01' });
    expect(events[0].severity).toBe(SEVERITY.NOTABLE);
  });

  it('reports a vanished date as a data discrepancy, never as a change', () => {
    // "The province stopped publishing this" is a different fact from "the
    // deadline moved", and only one of them should reach a user as a change.
    const events = detectChanges(BASE, { ...BASE, good_to_date: null });
    expect(types(events)).toContain(EVENT.SOURCE_DATA_DISCREPANCY);
    expect(types(events)).not.toContain(EVENT.GOOD_TO_DATE_CHANGED);
    expect(events[0].metadata.field).toBe('good_to_date');
  });
});

describe('detectChanges — status and termination', () => {
  it('reports a status change', () => {
    const events = detectChanges(BASE, { ...BASE, status: 'PENDING' });
    expect(types(events)).toContain(EVENT.STATUS_CHANGED);
  });

  it('raises TENURE_TERMINATED when the status becomes terminal', () => {
    const events = detectChanges(BASE, { ...BASE, status: 'CANCELLED' });
    expect(types(events)).toContain(EVENT.TENURE_TERMINATED);
    expect(events.find((e) => e.event_type === EVENT.TENURE_TERMINATED).severity)
      .toBe(SEVERITY.CRITICAL);
  });

  it('does not re-raise termination for a title that was already terminal', () => {
    const prev = { ...BASE, status: 'CANCELLED' };
    const events = detectChanges(prev, { ...BASE, status: 'FORFEITED' });
    expect(types(events)).toContain(EVENT.STATUS_CHANGED);
    expect(types(events)).not.toContain(EVENT.TENURE_TERMINATED);
  });

  it('catches a termination date appearing even when the status has not caught up', () => {
    const events = detectChanges(BASE, { ...BASE, termination_date: '2026-08-01' });
    expect(types(events)).toContain(EVENT.TENURE_TERMINATED);
  });
});

describe('detectChanges — area and geometry', () => {
  it('ignores area drift below the tolerance', () => {
    // Provincial area figures are recomputed upstream and wobble in the last
    // decimal without anything happening on the ground.
    const nudged = BASE.area_hectares * (1 + AREA_TOLERANCE_RATIO / 2);
    expect(types(detectChanges(BASE, { ...BASE, area_hectares: nudged })))
      .not.toContain(EVENT.AREA_CHANGED);
  });

  it('reports a real area change', () => {
    const events = detectChanges(BASE, { ...BASE, area_hectares: 300 });
    expect(types(events)).toContain(EVENT.AREA_CHANGED);
    expect(events.find((e) => e.event_type === EVENT.AREA_CHANGED).metadata.change_ratio)
      .toBeGreaterThan(AREA_TOLERANCE_RATIO);
  });

  it('reports a boundary change by fingerprint', () => {
    const events = detectChanges(BASE, { ...BASE, geometry_hash: undefined, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
    expect(types(events)).toContain(EVENT.GEOMETRY_CHANGED);
  });

  it('does not report geometry when the fingerprint is unchanged', () => {
    const geom = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const prev = { ...BASE, geometry_hash: undefined, geometry: geom };
    const curr = { ...BASE, geometry_hash: undefined, geometry: geom };
    expect(types(detectChanges(prev, curr))).not.toContain(EVENT.GEOMETRY_CHANGED);
  });
});

describe('detectOwnerChanges', () => {
  it('reports a new owner', () => {
    const events = detectOwnerChanges([owner('Goliath Resources Ltd')],
      [owner('Goliath Resources Ltd'), owner('Beta Minerals Inc')]);
    expect(types(events)).toEqual([EVENT.OWNER_ADDED]);
    expect(events[0].current_value).toBe('Beta Minerals Inc');
    expect(events[0].severity).toBe(SEVERITY.CRITICAL);
  });

  it('reports a departed owner', () => {
    const events = detectOwnerChanges(
      [owner('Goliath Resources Ltd'), owner('Beta Minerals Inc')],
      [owner('Goliath Resources Ltd')],
    );
    expect(types(events)).toEqual([EVENT.OWNER_REMOVED]);
  });

  it('reports a transfer as a removal plus an addition, not an inferred "transferred"', () => {
    // The province tells us who is on the title today. It does not tell us a
    // transfer happened, and synthesizing one would be asserting a fact about
    // a transaction we never observed.
    const events = detectOwnerChanges([owner('Alpha Mining Ltd')], [owner('Beta Minerals Inc')]);
    expect(types(events).sort()).toEqual([EVENT.OWNER_ADDED, EVENT.OWNER_REMOVED].sort());
  });

  it('is not fooled by a legal-suffix rewrite', () => {
    // "GOLIATH RESOURCES LTD." becoming "Goliath Resources Limited" is a
    // formatting change in the registry, not a change of ownership.
    expect(detectOwnerChanges(
      [owner('GOLIATH RESOURCES LTD.')],
      [owner('Goliath Resources Limited')],
    )).toEqual([]);
  });

  it('reports a percentage change', () => {
    const events = detectOwnerChanges([owner('Alpha Mining Ltd', 50)], [owner('Alpha Mining Ltd', 75)]);
    expect(types(events)).toEqual([EVENT.OWNERSHIP_PERCENTAGE_CHANGED]);
  });

  it('treats an empty owner set as a discrepancy, not as mass divestment', () => {
    // THE case this guard exists for: the source drops the owner field for a
    // page, and without this every affected customer is told their claims
    // changed hands.
    const events = detectOwnerChanges(
      [owner('Alpha Mining Ltd'), owner('Beta Minerals Inc')], [],
    );
    expect(types(events)).toEqual([EVENT.SOURCE_DATA_DISCREPANCY]);
    expect(types(events)).not.toContain(EVENT.OWNER_REMOVED);
  });

  it('says nothing when a title we had no owners for still has none', () => {
    expect(detectOwnerChanges([], [])).toEqual([]);
  });
});

describe('detectChanges — owner integration', () => {
  it('finds an ownership transfer even when no other field moved', () => {
    // A pure transfer changes nothing else. If owner diffing were conditional
    // on some other field having moved, this would be silently missed — and
    // it is one of the headline reasons to monitor a portfolio at all.
    const events = detectChanges(BASE, { ...BASE }, {
      previousOwners: [owner('Alpha Mining Ltd')],
      currentOwners: [owner('Beta Minerals Inc')],
    });
    expect(types(events).sort()).toEqual([EVENT.OWNER_ADDED, EVENT.OWNER_REMOVED].sort());
  });
});

describe('snapshots and absence', () => {
  it('snapshots only when something material happened', () => {
    expect(shouldSnapshot([])).toBe(false);
    expect(shouldSnapshot([{ event_type: EVENT.STATUS_CHANGED }])).toBe(true);
  });

  it('words an absence cautiously — never as an expiry', () => {
    const e = notObservedEvent(2);
    expect(e.event_type).toBe(EVENT.TENURE_NO_LONGER_OBSERVED);
    expect(e.current_value).toMatch(/absent from 2 consecutive successful imports/);
    expect(JSON.stringify(e)).not.toMatch(/expired|lapsed|released|available/i);
  });

  it('records a reappearance', () => {
    expect(reappearedEvent(3).event_type).toBe(EVENT.TENURE_REAPPEARED);
  });
});

describe('owner name normalization', () => {
  it('folds legal suffixes, case, punctuation and accents', () => {
    expect(normalizeOwnerName('GOLIATH RESOURCES LTD.')).toBe('goliath resources');
    expect(normalizeOwnerName('Goliath Resources Limited')).toBe('goliath resources');
    expect(normalizeOwnerName('Métaux Rares Inc')).toBe('metaux rares');
    expect(normalizeOwnerName('Smith & Jones Exploration Corp.')).toBe('smith and jones exploration');
  });

  it('returns an empty key rather than a wildcard for a name that folds away', () => {
    // '' must be treated by callers as "no usable key", never as match-all.
    expect(normalizeOwnerName('LTD.')).toBe('');
    expect(normalizeOwnerName(null)).toBe('');
  });
});

describe('owner candidate matching', () => {
  it('calls an identical folded name an exact match', () => {
    expect(classifyOwnerMatch('Goliath Resources Limited', 'GOLIATH RESOURCES LTD.').confidence)
      .toBe(MATCH_CONFIDENCE.EXACT);
  });

  it('calls a containment a possible match, not an exact one', () => {
    // "Goliath Resources Canada" may be a subsidiary or an unrelated company.
    // The user decides; we only rank.
    expect(classifyOwnerMatch('Goliath Resources', 'Goliath Resources Canada Ltd').confidence)
      .toBe(MATCH_CONFIDENCE.POSSIBLE);
  });

  it('returns null when the names share nothing', () => {
    expect(classifyOwnerMatch('Teck Resources', 'Barrick Gold')).toBeNull();
  });

  it('returns null when either side has no usable key', () => {
    expect(classifyOwnerMatch('Ltd.', 'Anything Ltd')).toBeNull();
  });

  it('groups candidates so only exact matches are safe to pre-select', () => {
    const grouped = groupOwnerCandidates('Goliath Resources', [
      { owner_name: 'GOLIATH RESOURCES LTD.', tenure_number: '1' },
      { owner_name: 'Goliath Resources Canada Ltd', tenure_number: '2' },
      { owner_name: 'Goliath Holdings Corp', tenure_number: '3' },
      { owner_name: 'Barrick Gold', tenure_number: '4' },
    ]);
    expect(grouped.exact.map((r) => r.tenure_number)).toEqual(['1']);
    expect(grouped.possible.map((r) => r.tenure_number)).toContain('2');
    expect(grouped.weak.map((r) => r.tenure_number)).toContain('4');
    expect(grouped.total).toBe(4);
  });

  it('asks the user to choose rather than announcing it found their claims', () => {
    const prompt = ownerMatchPrompt(28, ['Goliath Resources']);
    expect(prompt).toMatch(/We found 28 titles/);
    expect(prompt).toMatch(/Select the titles that belong in this portfolio/);
    expect(prompt).not.toMatch(/your claims/i);
  });
});

describe('splitOwnerField', () => {
  it('does not split on a comma — "Acme Resources, Inc." is one owner', () => {
    expect(splitOwnerField('Acme Resources, Inc.')).toEqual(['Acme Resources, Inc.']);
  });

  it('splits on unambiguous separators', () => {
    expect(splitOwnerField('Acme Ltd; Beta Inc')).toEqual(['Acme Ltd', 'Beta Inc']);
    expect(splitOwnerField('Acme / Beta')).toEqual(['Acme', 'Beta']);
  });

  it('returns an empty array for an empty field', () => {
    expect(splitOwnerField('')).toEqual([]);
    expect(splitOwnerField(null)).toEqual([]);
  });
});
