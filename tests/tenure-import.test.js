import { describe, it, expect } from 'vitest';

// Imported rather than read from disk: under jsdom, Vite rewrites
// import.meta.url to an http URL, so fileURLToPath cannot resolve it.
import fixture from './fixtures/bc-tenures/wfs-page.json';

import {
  resolveFields, schemaFingerprint, SchemaError, FIELD_CANDIDATES,
} from '../scripts/tenure-sync/resolveFields.mjs';
import {
  normalizeFeature, normalizeGeometry, geometryHash, REJECT_REASONS,
} from '../scripts/tenure-sync/normalize.mjs';
import {
  evaluateRun, mayReconcile, thresholdsFromEnv, DEFAULTS, VERDICT, summarize,
} from '../scripts/tenure-sync/guardrails.mjs';

const FEATURES = fixture.features;
const SAMPLE = FEATURES[0];
const { fields } = resolveFields(SAMPLE.properties);

// Fixtures, never the live endpoint. A suite that depends on DataBC being up
// fails for reasons unrelated to the code, and then gets ignored.

describe('resolveFields', () => {
  it('resolves the fields this repo has confirmed on the live layer', () => {
    expect(fields.sourceRecordId).toBe('TENURE_NUMBER_ID');
    expect(fields.tenureNumber).toBe('TENURE_NUMBER_ID');
    expect(fields.goodToDate).toBe('GOOD_TO_DATE');
    expect(fields.ownerName).toBe('OWNER_NAME');
    expect(fields.tenureName).toBe('CLAIM_NAME');
    expect(fields.areaHectares).toBe('AREA_IN_HECTARES');
  });

  it('reports fields the layer does not publish instead of inventing them', () => {
    const res = resolveFields(SAMPLE.properties);
    expect(res.missingOptional).toContain('clientNumber');
    expect(res.missingOptional).toContain('ownershipPercentage');
    expect(res.fields.clientNumber).toBeNull();
  });

  it('aborts when a REQUIRED field disappears', () => {
    const props = { ...SAMPLE.properties };
    delete props.GOOD_TO_DATE;
    expect(() => resolveFields(props)).toThrow(SchemaError);
    try {
      resolveFields(props);
    } catch (e) {
      expect(e.missing).toContain('goodToDate');
      // The message must name the field and list what IS there, so the
      // operator can fix the candidate list without a second round trip.
      expect(e.message).toMatch(/goodToDate/);
      expect(e.message).toMatch(/TENURE_NUMBER_ID/);
    }
  });

  it('survives a rename by falling through to the next candidate', () => {
    const props = { ...SAMPLE.properties };
    delete props.GOOD_TO_DATE;
    props.EXPIRY_DATE = '2027-03-14';
    expect(resolveFields(props).fields.goodToDate).toBe('EXPIRY_DATE');
  });

  it('matches field names case-insensitively', () => {
    const props = {};
    for (const [k, v] of Object.entries(SAMPLE.properties)) props[k.toLowerCase()] = v;
    expect(resolveFields(props).fields.goodToDate).toBe('good_to_date');
  });

  it('flags every required field that is gone, not just the first', () => {
    const props = { OBJECTID: 1 };
    try {
      resolveFields(props);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.missing).toEqual(expect.arrayContaining(['goodToDate', 'ownerName']));
    }
  });

  it('refuses to resolve against nothing', () => {
    expect(() => resolveFields(null)).toThrow(SchemaError);
  });
});

describe('schemaFingerprint', () => {
  it('is stable regardless of field order', () => {
    expect(schemaFingerprint(['B', 'A', 'C'])).toBe(schemaFingerprint(['A', 'B', 'C']));
  });

  it('changes when a field appears or disappears', () => {
    const base = schemaFingerprint(['A', 'B']);
    expect(schemaFingerprint(['A', 'B', 'C'])).not.toBe(base);
    expect(schemaFingerprint(['A'])).not.toBe(base);
  });

  it('marks every required candidate list as required', () => {
    const required = Object.entries(FIELD_CANDIDATES)
      .filter(([, v]) => v.required).map(([k]) => k);
    expect(required).toEqual(['sourceRecordId', 'tenureNumber', 'goodToDate', 'ownerName']);
  });
});

describe('normalizeFeature', () => {
  const opts = { observedAt: '2026-08-01T12:00:00Z' };

  it('normalizes a well-formed tenure', () => {
    const r = normalizeFeature(FEATURES[0], fields, opts);
    expect(r.ok).toBe(true);
    expect(r.tenure.source_record_id).toBe('1044501');
    expect(r.tenure.tenure_number).toBe('1044501');
    expect(r.tenure.tenure_name).toBe('Crystal Lake North');
    expect(r.tenure.status).toBe('GOOD');
    expect(r.tenure.area_hectares).toBe(418.7);
    expect(r.tenure.jurisdiction).toBe('BC');
  });

  it('keeps a midnight-UTC good-to-date on its own calendar day', () => {
    const r = normalizeFeature(FEATURES[0], fields, opts);
    expect(r.tenure.good_to_date).toBe('2027-03-14');
    expect(r.tenure.issue_date).toBe('2019-04-11');
  });

  it('stores null — not a placeholder — for a field the source omitted', () => {
    const r = normalizeFeature(FEATURES[3], fields, opts);
    expect(r.ok).toBe(true);
    expect(r.tenure.good_to_date).toBeNull();
    expect(r.tenure.termination_date).toBeNull();
    expect(r.tenure.owner_count).toBeNull();
  });

  it('preserves the raw source record for debugging and future fields', () => {
    const r = normalizeFeature(FEATURES[0], fields, opts);
    expect(r.tenure.raw_source_data.MAP_UNIT_NO).toBe('093K');
  });

  it('rejects rather than stores a feature with unusable geometry', () => {
    const r = normalizeFeature(FEATURES[4], fields, opts);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REJECT_REASONS.BAD_GEOMETRY);
    expect(r.sourceRecordId).toBe('1044505');
  });

  it('rejects a feature with no stable source id', () => {
    const f = { properties: { OWNER_NAME: 'X' }, geometry: FEATURES[0].geometry };
    const r = normalizeFeature(f, fields, opts);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REJECT_REASONS.NO_SOURCE_ID);
  });

  it('rejects a non-feature without throwing', () => {
    expect(normalizeFeature(null, fields, opts).ok).toBe(false);
    expect(normalizeFeature({}, fields, opts).ok).toBe(false);
  });
});

describe('normalizeFeature — owners', () => {
  const opts = { observedAt: '2026-08-01T12:00:00Z' };

  it('produces one owner row from a single flat owner field', () => {
    const { owners } = normalizeFeature(FEATURES[0], fields, opts);
    expect(owners).toHaveLength(1);
    expect(owners[0].owner_name).toBe('GOLIATH RESOURCES LTD.');
    expect(owners[0].normalized_owner_name).toBe('goliath resources');
    expect(owners[0].is_primary_owner).toBe(true);
  });

  it('splits a jointly-held title on an unambiguous separator', () => {
    const { owners } = normalizeFeature(FEATURES[1], fields, opts);
    expect(owners.map((o) => o.owner_name))
      .toEqual(['Goliath Resources Limited', 'Beta Minerals Inc']);
  });

  it('never claims the province published discrete co-owners when it did not', () => {
    // The split above was derived by us from one combined string. Saying
    // 'multi_field' here would present our inference as a government record.
    const { owners } = normalizeFeature(FEATURES[1], fields, opts);
    for (const o of owners) expect(o.ownership_representation).toBe('single_field');
  });

  it('leaves client number and percentage null when there are several owners', () => {
    // A single flat client number cannot be attributed to one of two names.
    const withClient = {
      ...FEATURES[1],
      properties: { ...FEATURES[1].properties, CLIENT_NUMBER: '123456' },
    };
    const f2 = resolveFields(withClient.properties).fields;
    const { owners } = normalizeFeature(withClient, f2, opts);
    expect(owners).toHaveLength(2);
    for (const o of owners) expect(o.government_client_number).toBeNull();
  });

  it('attaches a client number when there is exactly one owner', () => {
    const withClient = {
      ...FEATURES[0],
      properties: { ...FEATURES[0].properties, CLIENT_NUMBER: '123456' },
    };
    const f2 = resolveFields(withClient.properties).fields;
    const { owners } = normalizeFeature(withClient, f2, opts);
    expect(owners[0].government_client_number).toBe('123456');
  });
});

describe('normalizeGeometry', () => {
  it('accepts polygons and multipolygons', () => {
    expect(normalizeGeometry(FEATURES[0].geometry).type).toBe('Polygon');
    expect(normalizeGeometry({
      type: 'MultiPolygon',
      coordinates: [FEATURES[0].geometry.coordinates],
    }).type).toBe('MultiPolygon');
  });

  it('rounds coordinates to 6 decimal places', () => {
    const g = normalizeGeometry(FEATURES[0].geometry);
    expect(g.coordinates[0][0]).toEqual([-121.570123, 53.070123]);
  });

  it('rejects a ring that cannot enclose an area', () => {
    expect(normalizeGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] })).toBeNull();
  });

  it('rejects geometry types a tenure cannot be', () => {
    expect(normalizeGeometry({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(normalizeGeometry(null)).toBeNull();
  });

  it('rejects coordinates outside WGS84 — a projection failure, not a claim', () => {
    expect(normalizeGeometry({
      type: 'Polygon',
      coordinates: [[[1234567, 5432100], [1234568, 5432100], [1234568, 5432101], [1234567, 5432100]]],
    })).toBeNull();
  });

  it('rejects non-finite coordinates', () => {
    expect(normalizeGeometry({
      type: 'Polygon',
      coordinates: [[[NaN, 0], [1, 1], [1, 0], [NaN, 0]]],
    })).toBeNull();
  });
});

describe('geometryHash', () => {
  it('is stable for identical geometry', () => {
    expect(geometryHash(FEATURES[0].geometry)).toBe(geometryHash(FEATURES[0].geometry));
  });

  it('differs when the boundary moves', () => {
    expect(geometryHash(FEATURES[0].geometry)).not.toBe(geometryHash(FEATURES[1].geometry));
  });

  it('returns null for absent geometry', () => {
    expect(geometryHash(null)).toBeNull();
  });
});

describe('guardrails — the circuit breaker', () => {
  const clean = {
    recordsReceived: 50_000,
    recordsRejected: 12,
    geometryFailures: 4,
    truncated: false,
    schemaFingerprint: 'abc123',
    mode: 'full',
  };
  const baseline = { records_processed: 49_500, schema_fingerprint: 'abc123' };

  it('passes a healthy run', () => {
    const e = evaluateRun(clean, baseline);
    expect(e.verdict).toBe(VERDICT.OK);
    expect(e.alertsSafe).toBe(true);
    expect(e.reasons).toEqual([]);
  });

  it('aborts on an empty response', () => {
    const e = evaluateRun({ ...clean, recordsReceived: 0 }, baseline);
    expect(e.verdict).toBe(VERDICT.ABORT);
    expect(e.reasons.join(' ')).toMatch(/zero records/i);
  });

  it('aborts when pagination did not complete', () => {
    // Partial data is indistinguishable, row by row, from mass deletion.
    const e = evaluateRun({ ...clean, truncated: true }, baseline);
    expect(e.verdict).toBe(VERDICT.ABORT);
    expect(e.reasons.join(' ')).toMatch(/pagination/i);
  });

  it('aborts on a sharp drop against the last good run', () => {
    const e = evaluateRun({ ...clean, recordsReceived: 20_000 }, baseline);
    expect(e.verdict).toBe(VERDICT.ABORT);
    expect(e.reasons.join(' ')).toMatch(/fell to/i);
  });

  it('tolerates a modest drop', () => {
    expect(evaluateRun({ ...clean, recordsReceived: 46_000 }, baseline).verdict).toBe(VERDICT.OK);
  });

  it('aborts when too many records fail to parse', () => {
    const e = evaluateRun({ ...clean, recordsRejected: 5_000 }, baseline);
    expect(e.verdict).toBe(VERDICT.ABORT);
    expect(e.reasons.join(' ')).toMatch(/rejected/i);
  });

  it('aborts when too much geometry is unusable', () => {
    const e = evaluateRun({ ...clean, recordsRejected: 5_000, geometryFailures: 5_000 }, baseline);
    expect(e.reasons.join(' ')).toMatch(/geometry/i);
  });

  it('aborts a full run that is implausibly small even with no baseline', () => {
    const e = evaluateRun({ ...clean, recordsReceived: 12 }, null);
    expect(e.verdict).toBe(VERDICT.ABORT);
  });

  it('does not apply province-wide size rules to a targeted run', () => {
    // A targeted refresh of 40 monitored tenures is supposed to be small.
    const e = evaluateRun({
      ...clean, recordsReceived: 40, recordsRejected: 0, geometryFailures: 0, mode: 'targeted',
    }, baseline);
    expect(e.verdict).toBe(VERDICT.OK);
  });

  it('passes but withholds change alerts when the field list moved', () => {
    // A NEW field appearing breaks nothing, so the run may proceed — but a
    // fingerprint change is how a silent schema migration announces itself,
    // so change notices wait for a human to look.
    const e = evaluateRun({ ...clean, schemaFingerprint: 'different' }, baseline);
    expect(e.verdict).toBe(VERDICT.OK);
    expect(e.alertsSafe).toBe(false);
    expect(e.report.schema_fingerprint_changed).toBe(true);
    expect(summarize(e)).toMatch(/field list changed/i);
  });

  it('reports every reason, not only the first', () => {
    const e = evaluateRun({
      ...clean, recordsReceived: 100, recordsRejected: 90, truncated: true,
    }, baseline);
    expect(e.reasons.length).toBeGreaterThan(2);
  });

  it('never marks an aborted run safe for alerts', () => {
    expect(evaluateRun({ ...clean, recordsReceived: 0 }, baseline).alertsSafe).toBe(false);
  });

  it('says plainly that an aborted run wrote nothing', () => {
    const e = evaluateRun({ ...clean, recordsReceived: 0 }, baseline);
    expect(summarize(e)).toMatch(/aborted without writing/i);
  });
});

describe('mayReconcile', () => {
  const ok = { verdict: VERDICT.OK, alertsSafe: true };

  it('allows reconciliation only after a clean, complete, full run', () => {
    expect(mayReconcile(ok, 'full')).toBe(true);
  });

  it('refuses after a targeted run', () => {
    // "Not seen in a run that only asked about 40 tenures" carries no
    // information about the other 200,000.
    expect(mayReconcile(ok, 'targeted')).toBe(false);
  });

  it('refuses when the run was not trustworthy', () => {
    expect(mayReconcile({ verdict: VERDICT.ABORT, alertsSafe: false }, 'full')).toBe(false);
    expect(mayReconcile({ verdict: VERDICT.OK, alertsSafe: false }, 'full')).toBe(false);
  });
});

describe('thresholdsFromEnv', () => {
  it('falls back to the defaults', () => {
    expect(thresholdsFromEnv({})).toEqual(DEFAULTS);
  });

  it('lets an operator loosen a threshold during a known data event', () => {
    expect(thresholdsFromEnv({ TENURE_SYNC_MIN_RECORD_RATIO: '0.4' }).minRecordRatio).toBe(0.4);
  });

  it('ignores unparseable overrides rather than disabling the guardrail', () => {
    expect(thresholdsFromEnv({ TENURE_SYNC_MIN_RECORD_RATIO: 'off' }).minRecordRatio)
      .toBe(DEFAULTS.minRecordRatio);
  });
});
