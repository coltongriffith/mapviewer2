import { analyzeDuplicateSnapshot } from './qaqcDuplicates.js';
import { analyzeCrmSnapshot, CRM_RULES } from './qaqcCrms.js';
import { analyzeBlankSnapshot } from './qaqcBlanks.js';

export const QAQC_REPORT_LIMIT_MESSAGE = 'This comparison exceeds the PDF limit; no report was downloaded. Review the complete evidence in the app.';
export const QAQC_REPORT_PAGE = Object.freeze({ width: 792, height: 612, margin: 36, fontSize: 10, lineHeight: 14, maxPages: 100 });
export const QAQC_REPORT_LIMITS = Object.freeze({ rows: 5000, references: 5000, textCharacters: 2 * 1024 * 1024, fieldCharacters: 32768, pdfBytes: 32 * 1024 * 1024 });
const fail = detail => { throw new Error(`${detail} ${QAQC_REPORT_LIMIT_MESSAGE}`); };
const invalid = detail => { throw new Error(`Cannot create this comparison PDF: ${detail}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isInteger(value) && value >= 0;
const CRM_CATEGORIES = Object.freeze({ within2: 'Within/on ±2 supplied SD', outside2Within3: 'Outside ±2, within/on ±3 supplied SD', outside3: 'Outside ±3 supplied SD' });
const CRM_CONTROL = Object.freeze({ fail: 'Fail', warning: 'Warning (outside ±2 supplied SD)', none: 'No rule triggered' });
const order = (a, b) => a.sourceRow - b.sourceRow || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

/** Synchronous capture of selected evidence only. No mutable input is retained.
 * Existing analyzers verify supplied screen analysis; no PDF-specific statistics.
 */
export function buildQaqcReport({ kind, propertyName, snapshot, analysis, generatedAt, chartAvailability = {} } = {}) {
  if (!['duplicates', 'standards', 'blanks'].includes(kind)) invalid('choose duplicates, standards or blanks.');
  if (!snapshot?.complete || !analysis?.complete || !object(snapshot.manifest)) invalid('a complete historical snapshot is required.');
  const canonical = kind === 'duplicates' ? analyzeDuplicateSnapshot(snapshot) : kind === 'standards' ? analyzeCrmSnapshot(snapshot)
    : analyzeBlankSnapshot({ ...snapshot, multiplier: analysis.multiplier });
  if (!equal(canonical, analysis)) invalid('the analysis does not match the captured snapshot.');
  const m = snapshot.manifest, s = canonical.scope;
  if (!equal(m.scope, s) || m.population !== 'written_import_rows' || m.currentStateClaimed !== false
    || m.statusRefreshed !== true || m.referenceReadsComplete !== true
    || !count(m.expectedWrittenCount) || m.expectedWrittenCount !== snapshot.records.length
    || m.loadedWrittenCount !== snapshot.records.length || !count(m.submittedCount) || m.submittedCount < m.expectedWrittenCount
    || m.selectedCount !== canonical.selectedCount || canonical.selectedCount !== canonical.eligibleCount + canonical.excludedCount) {
    invalid('scope, completeness or population counts do not agree.');
  }
  if (!canonical.selectedCount) invalid('there are no selected controls.');
  if (canonical.selectedCount > QAQC_REPORT_LIMITS.rows) fail('More than 5,000 selected controls.');
  let characters = 0;
  const text = value => {
    if (value !== undefined && value !== null && !['string', 'number', 'boolean'].includes(typeof value)) invalid('an evidence field is not literal text or a scalar.');
    const output = value === undefined || value === null ? 'Unavailable' : String(value);
    characters += output.length;
    if (output.length > QAQC_REPORT_LIMITS.fieldCharacters || characters > QAQC_REPORT_LIMITS.textCharacters) fail('Evidence text is too large.');
    return output;
  };
  const line = (label, value) => `${label}: ${text(value)}`;
  const p = object(m.provenance) ? m.provenance : {};
  const title = `QA/QC comparison snapshot — ${kind}`;
  const metadata = [line('Property', propertyName || undefined), line('Property ID', s.propertyId), line('Writing import', s.batchId),
    line('Laboratory', s.labId), line('Laboratory job', s.labBatchId), line('Element', s.element), line('Exact unit', s.unit),
    ...(kind === 'duplicates' ? [line('Duplicate type', s.sampleType)] : kind === 'blanks' ? [line('Sample type', s.sampleType), line('Blank threshold', `${text(canonical.multiplier)} × detection limit`)]
      : [line('CRM ID', s.crmId), line('CRM revision', s.crmRevision)]),
    line('Source filename', p.filename), line('File SHA-256 identifier', p.sha256), line('Request fingerprint', m.requestHash),
    line('Snapshot retrieved at', m.retrievedAt), line('PDF generated at', generatedAt),
    m.rolledBackAt ? line('Historical import rolled back at', m.rolledBackAt) : 'Historical import status at retrieval: not rolled back.',
    ...(p.sheet !== undefined ? [line('Import-source worksheet', p.sheet)] : []),
    ...(p.header_row !== undefined ? [line('Import-source header row', p.header_row)] : [])];
  const limitations = [
    `${kind === 'duplicates' ? 'Descriptive historical' : 'Historical'} written-version subset; not laboratory approval, a full submitted file, whole laboratory job, analytical run or current-property inventory.`,
    'Unchanged records from a reimport remain attached to earlier writing imports. Only the selected comparison is included.',
    'Analytical date range not recorded. Retrieval time and source row do not establish analytical sequence.',
    'Hashes identify supplied sources; they do not independently verify a certificate, original file or laboratory method.',
    kind === 'duplicates' ? 'No analytical sequence or consecutive-result assessment. Blanks and CRM rules are outside this selected comparison.'
      : kind === 'standards' ? 'Shewhart rules use submitted-row (import) order, not analytical order: outside ±3 supplied SD fails; two consecutive assessed standards outside ±2 supplied SD on the same side both fail; one outside ±2 is a warning. Unassessed standards are skipped.'
      : `A blank fails when its reported value exceeds ${text(canonical.multiplier)} × the recorded detection limit. Below-detection blanks pass and remain censored. Without a recorded limit a blank is unassessed. Submitted-row order; no analytical order implied.`,
    'Raw laboratory text and numeric censoring bounds are retained separately. No detection bound, zero or DL/2 is substituted as a measurement.',
    'Numbers in evidence use round-trip strings; chart axis labels may be rounded.'
  ];
  const summary = [line('Submitted rows', m.submittedCount), line('Written records in this import', m.expectedWrittenCount),
    line('Selected controls', canonical.selectedCount), line('Assessed controls', canonical.eligibleCount), line('Unassessed controls', canonical.excludedCount),
    ...Object.entries(canonical.excludedByReason).filter(([, n]) => n).map(([reason, n]) => line(`Unassessed — ${reason}`, n))];
  const fraction = (label, stat) => `${label}: ${stat.count}/${stat.total}; percentage ${stat.percent === null ? 'unavailable (no assessed controls)' : `${text(stat.percent)}%`}.`;
  const charts = [], references = new Map(), pins = new Set();
  const chart = (key, heading, caption, expected, reason) => {
    const availability = chartAvailability[key];
    if (expected && (!availability?.available || !Number.isFinite(availability.width) || !Number.isFinite(availability.height)
      || availability.width <= 0 || availability.height <= 0)) invalid(`the ${heading} chart was not captured.`);
    charts.push({ key, title: heading, caption, available: expected,
      width: expected ? availability.width : 0, height: expected ? availability.height : 0,
      unavailableReason: expected ? null : reason });
  };
  if (kind === 'duplicates') {
    summary.push(fraction('HARD ≤10%', canonical.summaries.within10), fraction('HARD ≤20%', canonical.summaries.within20),
      'HARD summaries are cumulative and overlap; do not add them.', line('Positive pairs on log scatter', canonical.summaries.logCount),
      line('Assessed pairs omitted from log scatter because one value is zero', canonical.summaries.logExcludedCount));
    chart('scatter', 'Duplicate scatter', ['Equal logarithmic axes. Bands are ±10/20/30% relative to the original; they are not HARD thresholds.',
      `Plotted positive pairs: ${canonical.summaries.logCount}; assessed zero-pair omissions: ${canonical.summaries.logExcludedCount}.`],
    canonical.summaries.logCount > 0, 'No assessed pair has two positive values; no log scatter is available.');
    chart('hard', 'Ranked HARD', ['HARD = 100 × abs(original − duplicate) / (original + duplicate). No substituted censored values.',
      `Cumulative denominator: ${canonical.eligibleCount} assessed pairs. Ties use stable immutable record ID ordering.`],
    canonical.eligibleCount > 0, 'No assessed pairs; ranked HARD is unavailable.');
  } else if (kind === 'standards') {
    summary.push(fraction('Within/on ±2 supplied SD', canonical.summaries.within2),
      fraction('Outside ±2 but within/on ±3 supplied SD', canonical.summaries.outside2Within3),
      fraction('Outside ±3 supplied SD', canonical.summaries.outside3), 'The three supplied-SD categories are disjoint and descriptive.',
      fraction('Shewhart rule failures', canonical.rules.fail), fraction('Shewhart warnings only', canonical.rules.warning), fraction('No Shewhart rule triggered', canonical.rules.none),
      ...canonical.points.filter(p => p.control.status === 'fail').map(p => `Failure: source row ${text(p.sourceRow)}, sample ${text(p.sampleId)} — ${p.control.rules.map(r => CRM_RULES[r]).join('; ')}.`));
    const consistent = new Set(canonical.points.map(row => JSON.stringify(row.bands))).size === 1;
    chart('crm', 'CRM reference comparison', [
      'Linear scale, including zero observations and negative mathematical lower bands. Solid: supplied expected value; short dashes: ±2 supplied SD warning lines; long dashes: ±3 supplied SD. Squares: Shewhart rule failures.',
      'Submitted-row gaps are retained. Consecutive means adjacent in import order; no analytical order or trend is implied.',
      ...(consistent ? [line('Supplied expected value', canonical.points[0].reference.expected), line('Supplied SD', canonical.points[0].reference.sd)] : [])
    ], canonical.eligibleCount > 0 && consistent, canonical.eligibleCount ? 'The pinned definitions disagree within this group; no combined reference plot is shown.' : 'No assessed standards; the reference chart is unavailable.');
  }
  if (kind === 'blanks') {
    const dl = canonical.detectionLimits;
    summary.push(fraction(`Above ${text(canonical.multiplier)} × detection limit (fail)`, canonical.summaries.fail), fraction('At or below threshold (pass)', canonical.summaries.pass),
      fraction('Passing below-detection (censored) blanks', canonical.summaries.censored),
      line('Distinct recorded detection limits for this laboratory job, element and unit', dl.values.length ? dl.values.join(', ') : 'none'),
      ...canonical.failures.map(p => `Failure: source row ${text(p.sourceRow)}, sample ${text(p.sampleId)} — reported ${text(p.observed.raw)} ${text(p.unit)}; threshold ${text(p.threshold)}.`));
    for (const source of dl.sources) references.set(source.recordId, { id: text(source.recordId), heading: `Detection-limit source version: ${text(source.recordId)}`,
      lines: [line('Sample ID', source.sampleId), line('Sample type', source.sampleType), line('Writing import', source.batchId), line('Submitted source row', source.sourceRow),
        line('Raw laboratory text', source.raw), line('Recorded detection limit', source.limit)] });
    const limits = new Set(canonical.points.map(p => p.detectionLimit));
    chart('blank', 'Blank threshold comparison', [
      `Linear scale from zero. Solid: recorded detection limit; dashed: ${text(canonical.multiplier)} × detection limit threshold. Open circles: below detection, plotted at the recorded limit; squares: above threshold.`,
      'Submitted-row gaps are retained; no analytical order or trend is implied.',
      ...(limits.size === 1 ? [line('Recorded detection limit', [...limits][0]), line('Threshold', canonical.points[0].threshold)] : [])
    ], canonical.eligibleCount > 0 && limits.size === 1, canonical.eligibleCount ? 'Assessed blanks use different recorded detection limits; no combined chart is shown.' : 'No assessed blanks; the threshold chart is unavailable.');
  }
  const byId = new Map(snapshot.records.map(row => [row.id, row]));
  function reference(ref, type) {
    if (!ref) return null;
    if (!references.has(ref.recordId)) {
      const lines = type === 'original' ? sourceLines(ref) : [line('Definition import', ref.batchId), line('Source row', ref.sourceRow),
        line('CRM ID', ref.crmId), line('CRM revision', ref.revision), line('Element', ref.element), line('Exact unit', ref.unit),
        line('Supplied expected value', ref.expected), line('Supplied SD', ref.sd), line('Supplied reference source', ref.source)];
      references.set(ref.recordId, { id: text(ref.recordId), heading: `${type === 'original' ? 'Original sample' : 'CRM definition'} version: ${text(ref.recordId)}`, lines });
    }
    return ref.recordId;
  }
  function sourceLines(source) {
    return [line('Sample ID', source.sampleId), line('Writing import', source.batchId), line('Submitted source row', source.sourceRow),
      line(source.raw === '' ? 'Raw laboratory text (empty string)' : 'Raw laboratory text', source.raw), line(source.censored ? 'Stored numeric value (censored; not a measurement)' : 'Numeric value', source.value),
      line('Exact unit', source.unit), `Censored: ${source.censored ? 'yes' : 'no'}.`, line('Known numeric detection bound', source.detectionLimit)];
  }
  const records = [...canonical.points, ...canonical.excluded].sort(order).map(row => {
    const source = byId.get(row.id), lines = sourceLines(kind === 'duplicates' ? row.duplicate : row.observed);
    if (kind === 'blanks') {
      lines.push(line('Detection limit used', row.detectionLimit), line('Detection limit source', row.detectionLimitSource === 'result' ? 'this result' : row.detectionLimitSource === 'job' ? 'recorded laboratory-job limit (appendix)' : undefined));
      if (row.status !== 'unassessed') lines.push(line('Threshold', row.threshold), line('Multiple of detection limit', row.censored ? 'below detection' : row.ratio),
        `Blank outcome: ${row.outcome === 'fail' ? 'FAIL — above threshold' : row.censored ? 'pass (below detection; censored)' : 'pass'}.`);
    } else if (kind === 'duplicates') {
      if (source.parent_version_id) pins.add(source.parent_version_id);
      lines.push(line('Requested parent sample ID', source.record.parent_sample_id), line('Requested parent version', source.parent_version_id),
        line('Validated original (reference appendix)', reference(row.original, 'original')));
      if (row.status !== 'unassessed') lines.push(line('HARD (%)', row.hard), `Plotted on logarithmic axes: ${row.logEligible ? 'yes' : 'no (one value is zero)'}.`);
    } else {
      const candidates = source.crm_version_ids;
      if (candidates != null && !Array.isArray(candidates)) invalid('candidate definition pins are malformed.');
      if (candidates?.length > 64) fail('A selected sample has more than 64 candidate definition pins.');
      for (const id of candidates || []) { if (typeof id !== 'string' || !id.trim()) invalid('a candidate definition pin is malformed.'); pins.add(id); }
      lines.push('Requested candidate CRM versions (may include other elements; not a list of missing selected-element definitions):',
        ...(candidates?.length ? candidates.map(id => line('Candidate version', id)) : ['Unavailable']),
        line('Validated selected-tuple definition (reference appendix)', reference(row.reference, 'crm')));
      if (row.status !== 'unassessed') lines.push(line('Exact z score', row.z), line('Descriptive category', CRM_CATEGORIES[row.category]),
        `Shewhart result: ${CRM_CONTROL[row.control.status]}${row.control.rules.length ? ` — ${row.control.rules.map(r => CRM_RULES[r]).join('; ')}` : ''}.`,
        ...Object.entries(row.bands).map(([key, value]) => line(`Reference line — ${key}`, value)));
    }
    lines.push(row.status === 'unassessed' ? `Unassessed — ${text(row.reason)}: ${text(row.message)}` : kind === 'duplicates' ? 'Assessed descriptive comparison.' : 'Assessed comparison.');
    return { id: text(row.id), heading: `Sample version: ${text(row.id)}`, lines };
  });
  if (references.size > QAQC_REPORT_LIMITS.references || pins.size > QAQC_REPORT_LIMITS.references) fail('More than 5,000 requested or validated reference versions.');
  return { kind, title, header: [line('Property ID', s.propertyId), line('Writing import', s.batchId)],
    metadata, limitations, summary, charts, records, references: [...references.values()] };
}

/** Measured literal wrapping. Joining each paragraph's returned lines restores
 * every character, including whitespace and long identifiers. No HTML parsing.
 */
export function wrapQaqcReportText(value, width, measureText, fontSize = 10, bold = false) {
  const text = String(value);
  if (text.length > QAQC_REPORT_LIMITS.fieldCharacters) fail('A report field is too long.');
  const output = [];
  for (const paragraph of text.split('\n')) {
    const chars = Array.from(paragraph);
    if (!chars.length) { output.push(''); continue; }
    let start = 0;
    while (start < chars.length) {
      let low = 1, high = chars.length - start, fit = 0;
      while (low <= high) {
        const n = Math.floor((low + high) / 2), measured = measureText(chars.slice(start, start + n).join(''), fontSize, bold);
        if (!Number.isFinite(measured) || measured < 0) invalid('text measurement failed.');
        if (measured <= width) { fit = n; low = n + 1; } else high = n - 1;
      }
      if (!fit) fail('A character cannot fit at readable size.');
      if (start + fit < chars.length) {
        const lastSpace = chars.slice(start, start + fit).lastIndexOf(' ');
        if (lastSpace >= Math.floor(fit / 2)) fit = lastSpace + 1;
      }
      output.push(chars.slice(start, start + fit).join('')); start += fit;
    }
  }
  return output;
}

/** Full preflight. Text y is its TOP baseline; Arial body10pt, line14pt.
 * Pages contain only owned draw commands. Renderer must enforce pdfBytes and
 * cancel stale exports; no rendering/network/dependency is performed here.
 */
export function layoutQaqcReport(report, { measureText } = {}) {
  if (typeof measureText !== 'function' || !report?.title || !Array.isArray(report.records)) invalid('report and text measurement are required.');
  const { width, height, margin, lineHeight, maxPages } = QAQC_REPORT_PAGE;
  const bodyWidth = width - 2 * margin, bottom = height - margin - 22;
  let characters = 0;
  const wrap = (value, size = 10, bold = false) => {
    characters += String(value).length;
    if (characters > QAQC_REPORT_LIMITS.textCharacters) fail('Report text is too large.');
    return wrapQaqcReportText(value, bodyWidth, measureText, size, bold);
  };
  const header = [report.title, ...report.header].flatMap(text => wrap(text, 10, true));
  const top = margin + header.length * lineHeight + 12;
  if (bottom - top < 150) fail('The repeated scope header leaves too little readable page space.');
  const pages = [];
  let page, y;
  const command = (text, size = 10, bold = false) => { page.commands.push({ kind: 'text', x: margin, y, text, fontSize: size, bold }); y += lineHeight; };
  const newPage = () => {
    if (pages.length >= maxPages) fail('More than 100 pages are required.');
    page = { commands: [] }; pages.push(page); y = margin;
    header.forEach(text => command(text, 10, true)); y = top;
  };
  const ensure = amount => { if (y + amount > bottom) newPage(); };
  newPage();
  const paragraph = (value, size = 10, bold = false) => {
    for (const text of wrap(value, size, bold)) { ensure(lineHeight); command(text, size, bold); }
  };
  const section = heading => { ensure(3 * lineHeight); y += 8; paragraph(heading, 14, true); y += 6; };
  section('Scope and provenance'); report.metadata.forEach(text => paragraph(text));
  section('Population and interpretation'); report.limitations.forEach(text => paragraph(text));
  section('Summary'); report.summary.forEach(text => paragraph(text));
  for (const chart of report.charts) {
    const heading = wrap(chart.title, 14, true);
    const caption = [...(chart.available ? [] : [chart.unavailableReason]), ...chart.caption].flatMap(text => wrap(text));
    let w = 0, h = 0;
    if (chart.available) {
      const scale = Math.min(bodyWidth / chart.width, 300 / chart.height);
      w = chart.width * scale; h = chart.height * scale;
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) invalid('chart dimensions are invalid.');
    }
    // Captions contain denominators and supplied reference values. Keep them
    // with their chart instead of orphaning a value on the following page.
    const blockHeight = 14 + (heading.length + caption.length) * lineHeight + (chart.available ? h + 8 : 0);
    if (blockHeight > bottom - top) fail('A chart and its complete caption cannot fit at readable size.');
    ensure(blockHeight); y += 8; heading.forEach(text => command(text, 14, true)); y += 6;
    if (chart.available) {
      page.commands.push({ kind: 'chart', key: chart.key, x: margin + (bodyWidth - w) / 2, y, width: w, height: h }); y += h + 8;
    }
    caption.forEach(text => command(text));
  }
  const blocks = (heading, rows, empty) => {
    section(heading);
    if (!rows.length) { paragraph(empty); return; }
    for (const row of rows) {
      const first = wrap(row.heading, 10, true), continued = wrap(`${row.heading} (continued)`, 10, true);
      if (Math.max(first.length, continued.length) * lineHeight > bottom - top - 2 * lineHeight) fail('A record identity cannot fit on a readable page.');
      ensure((first.length + 1) * lineHeight); first.forEach(text => command(text, 10, true));
      for (const value of row.lines) for (const text of wrap(value)) {
        if (y + lineHeight > bottom) { newPage(); continued.forEach(value => command(value, 10, true)); }
        command(text);
      }
      y += 8;
    }
  };
  blocks('Selected evidence — all assessed and unassessed controls', report.records);
  blocks(report.kind === 'blanks' ? 'Recorded detection-limit sources' : 'Validated pinned-reference appendix', report.references,
    report.kind === 'blanks' ? 'No numeric detection limit is recorded for this laboratory job, element and unit in this import.' : 'No validated reference details are available. Requested pins remain with each selected sample.');
  for (let i = 0; i < pages.length; i++) pages[i].commands.push({ kind: 'text', x: margin, y: height - margin, text: `Page ${i + 1} of ${pages.length}`, fontSize: 10, bold: false });
  return { width, height, pages };
}
