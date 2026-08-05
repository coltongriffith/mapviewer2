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
import { reconcileRows, ROW_STATUS } from '../src/utils/tenureCsv.js';

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

// ── The live B.C. schema, as of the 2026-08-05 --discover run ──────────────
//
// These are the 34 field names the layer actually publishes, copied verbatim
// from the workflow log. The fixtures elsewhere in this file are shapes; this
// one is a record of reality, and it exists because the first discover run
// found four fields I had documented as "not confirmed to exist" sitting right
// there under names my candidate lists did not contain.
//
// The most expensive of those was CLIENT_NUMBER_ID. Client-number search is a
// shipped, user-visible feature, and it had nothing to match on — silently, for
// as long as the docs kept asserting the province did not publish the field.
const LIVE_BC_FIELDS = {
  AREA_IN_HECTARES: 25,
  CASH_IN_LIEU_EVENT_COUNT: 2,
  CLAIM_NAME: 'VAL NO.12',
  CLIENT_NUMBER_ID: 141999,
  COMPLAINTS_EVENT_COUNT: null,
  ENTRY_TIMESTAMP: '2004-09-30Z',
  ENTRY_USERID: 'MIDA_LOAD',
  FEATURE_AREA_SQM: 170928.5361,
  FEATURE_CODE: null,
  FEATURE_LENGTH_M: 1647.8104,
  GOOD_TO_DATE: '2030-03-30Z',
  ISSUE_DATE: '1966-03-18Z',
  NUMBER_OF_OWNERS: 1,
  OBJECTID: 59639053,
  OWNERSHIP_TRANSFER_EVENT_COUNT: 2,
  OWNER_NAME: 'GIBRALTAR MINES LTD.',
  PERCENT_OWNERSHIP: 100,
  PROTECTED_IND: 'N',
  REDUCTION_EVENT_COUNT: null,
  REVISION_NUMBER: 0,
  SE_ANNO_CAD_DATA: null,
  STATEMENT_OF_WORK_EVENT_COUNT: 18,
  TAG_NUMBER: '656243M',
  TENURE_NUMBER_ID: 207716,
  TENURE_SUB_TYPE_CODE: 'C',
  TENURE_SUB_TYPE_DESCRIPTION: 'CLAIM',
  TENURE_TYPE_CODE: 'M',
  TENURE_TYPE_DESCRIPTION: 'Mineral',
  TERMINATION_DATE: null,
  TERMINATION_TYPE_DESCRIPTION: null,
  TITLE_TYPE_CODE: 'MC2',
  TITLE_TYPE_DESCRIPTION: 'Two Post Claim',
  UPDATE_TIMESTAMP: '2004-09-30Z',
  UPDATE_USERID: 'MIDA_LOAD',
};

describe('the real B.C. layer schema', () => {
  it('resolves all four required fields', () => {
    const { fields } = resolveFields(LIVE_BC_FIELDS);
    expect(fields.sourceRecordId).toBe('TENURE_NUMBER_ID');
    expect(fields.tenureNumber).toBe('TENURE_NUMBER_ID');
    expect(fields.goodToDate).toBe('GOOD_TO_DATE');
    expect(fields.ownerName).toBe('OWNER_NAME');
  });

  it('resolves the four fields the first discover run caught me missing', () => {
    const { fields } = resolveFields(LIVE_BC_FIELDS);
    expect(fields.clientNumber).toBe('CLIENT_NUMBER_ID');
    expect(fields.workEventCount).toBe('STATEMENT_OF_WORK_EVENT_COUNT');
    expect(fields.transferEventCount).toBe('OWNERSHIP_TRANSFER_EVENT_COUNT');
    expect(fields.sourceUpdatedAt).toBe('UPDATE_TIMESTAMP');
  });

  it('resolves ownership as real government data, not our inference', () => {
    const { fields } = resolveFields(LIVE_BC_FIELDS);
    expect(fields.ownershipPercentage).toBe('PERCENT_OWNERSHIP');
    expect(fields.ownerCount).toBe('NUMBER_OF_OWNERS');
    expect(fields.terminationDate).toBe('TERMINATION_DATE');
  });

  it('still reports status and mapUnit as genuinely absent', () => {
    // Not every gap was a bad guess. The layer publishes no status column at
    // all — active vs terminated lives in TERMINATION_DATE — and claiming
    // otherwise would be the fabrication this whole mechanism exists to avoid.
    const { fields, missingOptional } = resolveFields(LIVE_BC_FIELDS);
    expect(fields.status).toBeNull();
    expect(fields.mapUnit).toBeNull();
    expect(missingOptional).toEqual(expect.arrayContaining(['status', 'mapUnit']));
    expect(missingOptional).not.toContain('clientNumber');
  });

  it('a null status is treated as monitorable, not as "not in good standing"', () => {
    // The safety property behind the absence above: with no status column,
    // every claim would otherwise reconcile as inactive and the CSV importer
    // would decline to pre-select any of them.
    const { entries } = reconcileRows(
      [{ tenureNumber: '207716', line: 1 }],
      new Map([[1, [{ id: 't1', tenure_number: '207716', status: null }]]]),
    );
    expect(entries[0].status).toBe(ROW_STATUS.MATCHED);
  });
});
