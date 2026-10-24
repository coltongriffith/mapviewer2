import { describe, expect, it } from 'vitest';
import { analyzeDuplicateSnapshot } from '../shared/qaqcDuplicates.js';
import { analyzeCrmSnapshot } from '../shared/qaqcCrms.js';
import { buildQaqcReport, layoutQaqcReport, wrapQaqcReportText, QAQC_REPORT_LIMIT_MESSAGE, QAQC_REPORT_LIMITS } from '../shared/qaqcReport.js';

const scope = { propertyId: 'property', batchId: 'import', sampleType: 'field_dup', labId: 'Lab', labBatchId: 'Job', element: 'Au', unit: 'g/t' };
const record = (id, type, value) => ({ sample_id: id, sample_type: type, lab_id: 'Lab', lab_batch_id: 'Job',
  values: { Au: value }, raw_values: { Au: String(value) }, units: { Au: 'g/t' }, bdl: {} });
function duplicates(n = 1) {
  return { scope: { ...scope }, complete: true,
    records: Array.from({ length: n }, (_, i) => ({ id: `sample-${i}`, property_id: 'property', batch_id: 'import', source_row: i + 1,
      parent_version_id: `parent-${i}`, record: { ...record(`DUP-${i}`, 'field_dup', 110), parent_sample_id: `ORIG-${i}` } })),
    parents: Array.from({ length: n }, (_, i) => ({ id: `parent-${i}`, property_id: 'property', batch_id: 'old-import', source_row: i + 1,
      superseded_by_batch: 'replacement-import', record: record(`ORIG-${i}`, 'routine', 90) })) };
}
function standards() {
  const s = { ...scope, crmId: 'CRM-01', crmRevision: '01' }; delete s.sampleType;
  return { scope: s, complete: true, records: [{ id: 'standard-01', property_id: 'property', batch_id: 'import', source_row: 4,
    crm_version_ids: ['other-element', 'crm-old'], record: { ...record('001', 'standard', 0), crm_id: s.crmId, crm_revision: s.crmRevision } }],
  crms: [{ id: 'crm-old', property_id: 'property', batch_id: 'old-crm-import', source_row: 8,
    record: { crm_id: s.crmId, revision: s.crmRevision, element: 'Au', unit: 'g/t', expected: 0, sd: 2, source: 'Supplied synthetic definition' } }] };
}
const charts = { scatter: { available: true, width: 450, height: 340 }, hard: { available: true, width: 450, height: 300 }, crm: { available: true, width: 430, height: 340 } };
function input(snapshot = duplicates(), kind = 'duplicates') {
  const analysis = (kind === 'duplicates' ? analyzeDuplicateSnapshot : analyzeCrmSnapshot)(snapshot);
  snapshot.manifest = { scope: { ...snapshot.scope }, population: 'written_import_rows', currentStateClaimed: false,
    statusRefreshed: true, referenceReadsComplete: true, expectedWrittenCount: snapshot.records.length, loadedWrittenCount: snapshot.records.length,
    submittedCount: snapshot.records.length + 20, selectedCount: analysis.selectedCount, retrievedAt: '2026-01-02T03:04:05Z',
    requestHash: 'request-identifier', rolledBackAt: '2026-01-02T02:00:00Z', provenance: { filename: '<assays>.xlsx', sha256: 'file-identifier', sheet: 'Sheet 🧪', header_row: 3 } };
  return { kind, propertyName: 'Synthetic <property>', snapshot, analysis, generatedAt: '2026-01-02T04:00:00Z', chartAvailability: charts };
}
const measureText = (text, size = 10) => Array.from(text).length * size * 0.5;
const layout = report => layoutQaqcReport(report, { measureText });
const allText = report => JSON.stringify(report);

describe('selected comparison evidence capture', () => {
  it('captures every selected assessed/excluded row, historical refs and separate counts, omitting unselected rows', () => {
    const s = duplicates(61); s.records[30].record.bdl.Au = 0.05; s.records[30].record.raw_values.Au = 'ND';
    s.records.push({ ...s.records[0], id: 'UNSELECTED-SECRET', source_row: 62, record: { ...s.records[0].record, lab_id: 'Other' } });
    const report = buildQaqcReport(input(s)), text = allText(report);
    expect(report.records).toHaveLength(61); expect(report.records.map(r => r.id)).toEqual(s.records.slice(0, 61).map(r => r.id));
    expect(report.references).toHaveLength(61); expect(text).not.toContain('UNSELECTED-SECRET');
    expect(text).toContain('Submitted rows: 82'); expect(text).toContain('Written records in this import: 62');
    expect(text).toContain('Selected controls: 61'); expect(text).toContain('Assessed controls: 60'); expect(text).toContain('Unassessed controls: 1');
    expect(text).toContain('Raw laboratory text: ND'); expect(text).toContain('Known numeric detection bound: 0.05');
    expect(text).toContain('old-import'); expect(text).not.toContain('replacement-import');
    expect(text).toContain('Historical import rolled back at:'); expect(text).toContain('Import-source worksheet: Sheet 🧪');
    expect(text).toContain('Analytical date range not recorded.');
  });
  it('owns every returned value across mutations after capture and retains raw literal Unicode/numbers', () => {
    const source = input(); source.snapshot.records[0].record.raw_values.Au = '<b>110.000</b> 🧪';
    source.analysis = analyzeDuplicateSnapshot(source.snapshot);
    const report = buildQaqcReport(source), frozen = JSON.stringify(report);
    source.snapshot.records[0].record.raw_values.Au = 'MUTATED'; source.snapshot.scope.unit = 'MUTATED';
    source.snapshot.manifest.provenance.filename = 'MUTATED'; source.analysis.points[0].original.raw = 'MUTATED';
    expect(JSON.stringify(report)).toBe(frozen); expect(frozen).toContain('<b>110.000</b> 🧪');
  });
  it('records requested pins without exposing foreign/mismatched parent text', () => {
    const s = duplicates(); s.parents[0].property_id = 'foreign'; s.parents[0].record.raw_values.Au = 'FOREIGN-SECRET';
    const report = buildQaqcReport(input(s));
    expect(report.references).toEqual([]); expect(allText(report)).not.toContain('FOREIGN-SECRET');
    expect(allText(report)).toContain('Requested parent version: parent-0');
    expect(report.charts.every(c => !c.available)).toBe(true);
    expect(allText(report)).toContain('percentage unavailable (no assessed controls)');
  });
  it('distinguishes one-zero log omission from both-zero undefined HARD', () => {
    const s = duplicates(2); s.parents.forEach(p => { p.record.values.Au = 0; p.record.raw_values.Au = '0.000'; });
    s.records[1].record.values.Au = 0;
    const report = buildQaqcReport(input(s));
    expect(report.charts.find(c => c.key === 'scatter').available).toBe(false);
    expect(report.charts.find(c => c.key === 'hard').available).toBe(true);
    expect(allText(report)).toContain('HARD (%): 100'); expect(allText(report)).toContain('zero_sum');
    expect(allText(report)).toContain('HARD ≤20%: 0/1; percentage 0%');
  });
  it('distinguishes a supplied empty raw string from a missing raw result without substituting text', () => {
    const s = duplicates(2); s.records[0].record.raw_values.Au = ''; delete s.records[1].record.raw_values.Au;
    const report = buildQaqcReport(input(s));
    expect(report.records[0].lines).toContain('Raw laboratory text (empty string): ');
    expect(report.records[1].lines).toContain('Raw laboratory text: Unavailable');
    expect(report.records.every(r => r.lines.at(-1).includes('missing_raw'))).toBe(true);
  });
  it('preserves CRM zero, negative bands, exact IDs, candidate distinction and supplied source without invented dates', () => {
    const s = standards(), report = buildQaqcReport(input(s, 'standards')), text = allText(report);
    expect(text).toContain('Numeric value: 0'); expect(text).toContain('Exact z score: 0'); expect(text).toContain('Reference line — lower3: -6');
    expect(text).toContain('Candidate version: other-element'); expect(text).toContain('not a list of missing selected-element definitions');
    expect(report.references.map(r => r.id)).toEqual(['crm-old']); expect(text).toContain('Supplied reference source: Supplied synthetic definition');
    expect(text).toContain('within2'); expect(text).not.toContain('pass:');
  });
  it('keeps ambiguous/foreign CRM pins as unassessed without source text; no chart for disagreeing approved definitions', () => {
    const s = standards(); s.crms[0].property_id = 'foreign'; s.crms[0].record.source = 'FOREIGN-SECRET';
    const report = buildQaqcReport(input(s, 'standards'));
    expect(report.references).toEqual([]); expect(allText(report)).not.toContain('FOREIGN-SECRET'); expect(report.charts[0].available).toBe(false);
    const disagree = standards(); disagree.records.push({ ...disagree.records[0], id: 'standard-02', source_row: 5, crm_version_ids: ['crm-other'] });
    disagree.crms.push({ ...disagree.crms[0], id: 'crm-other', record: { ...disagree.crms[0].record, expected: 1 } });
    const output = buildQaqcReport(input(disagree, 'standards'));
    expect(output.records).toHaveLength(2); expect(output.charts[0].available).toBe(false); expect(output.charts[0].unavailableReason).toContain('disagree');
  });
  it('rejects incomplete/mixed scopes, tampered analysis, inconsistent manifest counts and absent expected charts', () => {
    const cases = [x => { x.snapshot.complete = false; }, x => { x.snapshot.manifest.scope.unit = 'ppm'; },
      x => { x.analysis.points[0].original.raw = 'injected'; }, x => { x.snapshot.manifest.loadedWrittenCount = 0; },
      x => { x.snapshot.manifest.referenceReadsComplete = false; }, x => { x.chartAvailability = {}; }];
    for (const mutate of cases) { const x = input(); mutate(x); expect(() => buildQaqcReport(x)).toThrow(/Cannot create/); }
    expect(() => buildQaqcReport(input(duplicates(0)))).toThrow(/no selected controls/);
  });
  it('treats object key order as irrelevant while validating exact analysis', () => {
    const x = input(); x.analysis.scope = Object.fromEntries(Object.entries(x.analysis.scope).reverse());
    expect(buildQaqcReport(x).records).toHaveLength(1);
  });
  it('caps text and all requested candidate pins, with no partial result', () => {
    const x = input(); x.propertyName = 'x'.repeat(QAQC_REPORT_LIMITS.fieldCharacters + 1);
    expect(() => buildQaqcReport(x)).toThrow(QAQC_REPORT_LIMIT_MESSAGE);
    const s = standards(); s.records[0].crm_version_ids = Array.from({ length: 65 }, (_, i) => `pin-${i}`);
    expect(() => buildQaqcReport(input(s, 'standards'))).toThrow(QAQC_REPORT_LIMIT_MESSAGE);
  });
});

describe('complete measured landscape-letter layout', () => {
  it('measures every literal character without stripping whitespace, parsing HTML or truncating identifiers', () => {
    const paragraphs = ['<script>literal</script>   🧪 地質 ' + 'A'.repeat(90), ' spaced  words '];
    const wrapped = paragraphs.map(text => wrapQaqcReportText(text, 77, measureText));
    expect(wrapped.map(lines => lines.join(''))).toEqual(paragraphs);
    wrapped.flat().forEach(line => expect(measureText(line)).toBeLessThanOrEqual(77));
    expect(() => wrapQaqcReportText('a', 1, measureText)).toThrow(QAQC_REPORT_LIMIT_MESSAGE);
    expect(() => wrapQaqcReportText('a', 77, () => NaN)).toThrow(/measurement failed/);
  });
  it('includes first/middle/last of more than50 rows and every appendix, with repeated identity on continuation', () => {
    const report = buildQaqcReport(input(duplicates(61))), result = layout(report);
    expect(result).toMatchObject({ width: 792, height: 612 }); expect(result.pages.length).toBeGreaterThan(3);
    const text = result.pages.flatMap(p => p.commands.filter(c => c.kind === 'text').map(c => c.text)).join('\n');
    for (const id of ['sample-0', 'sample-30', 'sample-60', 'parent-60']) expect(text).toContain(id);
    expect(text).toContain('(continued)');
    result.pages.forEach((page, i) => {
      expect(page.commands.some(c => c.text === `Page ${i + 1} of ${result.pages.length}`)).toBe(true);
      page.commands.forEach(c => {
        expect(c.y).toBeGreaterThanOrEqual(36); expect(c.y + (c.height || c.fontSize)).toBeLessThanOrEqual(590);
        if (c.kind === 'text') expect(measureText(c.text, c.fontSize)).toBeLessThanOrEqual(720);
      });
    });
  });
  it('wraps1000-character reference source literally and identifies longer continued source blocks', () => {
    const s = standards(); const literal = '地質<script> & 🧪  '.repeat(100);
    s.crms[0].record.source = literal;
    const report = buildQaqcReport(input(s, 'standards'));
    const result = layout(report), appendix = result.pages.flatMap(p => p.commands).filter(c => c.kind === 'text').map(c => c.text);
    expect(appendix.join('')).toContain('Supplied reference source: ' + literal);
    expect(report.references[0].lines.at(-1)).toBe('Supplied reference source: ' + literal);
  });
  it('accepts exactly100pages and rejects101 before returning any partial layout', () => {
    // One measured line per large evidence record, tuned to a single page each;
    // derive the boundary instead of relying on incidental introductory height.
    const report = buildQaqcReport(input()); report.charts = []; report.metadata = []; report.limitations = []; report.summary = []; report.references = [];
    report.records = [{ id: 'one', heading: 'Sample version: one', lines: Array(2900).fill('Evidence') }];
    let low = 1, high = 4000, exact = null;
    while (low <= high) {
      const n = Math.floor((low + high) / 2); report.records[0].lines = Array(n).fill('Evidence');
      try { const result = layout(report); if (result.pages.length === 100) exact = n; low = n + 1; } catch (error) {
        expect(error.message).toContain(QAQC_REPORT_LIMIT_MESSAGE); high = n - 1;
      }
    }
    expect(exact).not.toBeNull(); report.records[0].lines = Array(exact).fill('Evidence'); expect(layout(report).pages).toHaveLength(100);
    report.records[0].lines.push('Evidence'); expect(() => layout(report)).toThrow(QAQC_REPORT_LIMIT_MESSAGE);
  });
  it('preserves supplied chart aspect and bounds without recomputing points', () => {
    const result = layout(buildQaqcReport(input()));
    const commands = result.pages.flatMap(p => p.commands).filter(c => c.kind === 'chart');
    expect(commands.map(c => c.key)).toEqual(['scatter', 'hard']);
    commands.forEach(c => { expect(c.width / c.height).toBeCloseTo(charts[c.key].width / charts[c.key].height, 12); expect(c.height).toBeLessThanOrEqual(300); });
  });
});
