import React, { useEffect, useMemo, useRef, useState } from 'react';
import { discoverBlankGroups, loadBlankSnapshot } from '../../utils/drillQaqcSnapshot';
import { analyzeBlankSnapshot, BLANK_MULTIPLIER } from '../../../shared/qaqcBlanks';
import QaqcChartDownload from './QaqcChartDownload';
import QaqcReportDownload from './QaqcReportDownload';
import { chartProvenance } from '../../utils/qaqcChartPng';

const number = value => value == null ? '—' : value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6) ? value.toExponential(3) : Number(value).toLocaleString(undefined, { maximumSignificantDigits: 5 });
const short = group => `Blanks · ${group.labId} / ${group.labBatchId} · ${group.element} (${group.unit})`;
const MULTIPLIERS = Array.from({ length: BLANK_MULTIPLIER.max - BLANK_MULTIPLIER.min + 1 }, (_, i) => BLANK_MULTIPLIER.min + i);
const outcome = row => row.outcome === 'fail' ? 'Fail: above threshold' : row.censored ? 'Pass (below detection; censored)' : 'Pass';

function ThresholdPlot({ points, rows, unit, multiplier }) {
  if (!points.length) return <p>No assessed blanks are available for the threshold plot.</p>;
  const limits = [...new Set(points.map(p => p.detectionLimit))];
  if (limits.length !== 1) return <p role="alert">Assessed blanks use different recorded detection limits. Review the evidence table; no combined threshold plot is shown.</p>;
  const dl = limits[0], threshold = points[0].threshold;
  const plotted = p => p.censored ? p.detectionLimit : p.observed.value;
  // Normalize first so tiny or large magnitudes keep finite SVG coordinates.
  const magnitude = Math.max(threshold, ...points.map(plotted)) || 1, top = 1.08;
  const first = Math.min(...rows.map(p => p.sourceRow)), last = Math.max(...rows.map(p => p.sourceRow));
  const x = value => first === last ? 240 : 75 + (value - first) / (last - first) * 330;
  const y = value => 295 - value / magnitude / top * 270;
  return <svg viewBox="0 0 480 360" style={{ display: 'block', width: '100%', maxWidth: 760, margin: '0 auto' }} role="img" aria-label={`Blank threshold plot, ${points.length} assessed blanks in ${unit}, by submitted row. Threshold ${multiplier} times the recorded detection limit. Data available in the blanks table.`}>
    <rect x="75" y="25" width="330" height="270" fill="none" stroke="currentColor" />
    {[0, magnitude * top / 2, magnitude * top].map((tick, i) => <text key={i} x="69" y={y(tick) + 4} textAnchor="end" fontSize="11" fill="currentColor">{number(tick)}</text>)}
    {[...new Set([first, Math.round((first + last) / 2), last])].map(tick => <text key={tick} x={x(tick)} y="314" textAnchor="middle" fontSize="11" fill="currentColor">{tick}</text>)}
    <g><line x1="75" x2="405" y1={y(dl)} y2={y(dl)} stroke="#64748b" /><title>Recorded detection limit: {dl} {unit}</title></g>
    <g><line x1="75" x2="405" y1={y(threshold)} y2={y(threshold)} stroke="currentColor" strokeDasharray="8 4" /><title>Threshold {multiplier} × detection limit: {threshold} {unit}</title></g>
    {points.map(p => { const title = <title>{p.sampleId}: {p.observed.raw} {unit}; {outcome(p)}</title>, cx = x(p.sourceRow), cy = y(plotted(p));
      return p.outcome === 'fail' ? <rect key={p.id} x={cx - 4.5} y={cy - 4.5} width="9" height="9" fill="#2563eb" stroke="currentColor" data-outcome="fail">{title}</rect>
        : p.censored ? <circle key={p.id} cx={cx} cy={cy} r="3.5" fill="none" stroke="#2563eb" strokeWidth="1.5" data-outcome="censored">{title}</circle>
          : <circle key={p.id} cx={cx} cy={cy} r="3.5" fill="#2563eb" fillOpacity="0.7" data-outcome="pass">{title}</circle>; })}
    <text x="240" y="345" textAnchor="middle" fill="currentColor" fontSize="12">Submitted row (not analysis order)</text>
    <text transform="translate(15 160) rotate(-90)" textAnchor="middle" fill="currentColor" fontSize="12" data-export-label={unit.length > 20 ? 'Reported value (unit below)' : undefined}>Reported value ({unit})</text>
  </svg>;
}

function Results({ snapshot, propertyName, captureCurrent }) {
  const [multiplier, setMultiplier] = useState(BLANK_MULTIPLIER.default);
  const analysis = useMemo(() => analyzeBlankSnapshot({ ...snapshot, multiplier }), [snapshot, multiplier]);
  const [page, setPage] = useState(0);
  const rows = useMemo(() => [...analysis.points, ...analysis.excluded].sort((a, b) => a.sourceRow - b.sourceRow || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [analysis]);
  const manifest = snapshot.manifest, dl = analysis.detectionLimits;
  const provenance = chartProvenance(analysis, manifest, propertyName);
  const chart = useRef(null);
  const single = analysis.points.length > 0 && new Set(analysis.points.map(p => p.detectionLimit)).size === 1;
  const percent = summary => summary.percent == null ? ' (percentage unavailable)' : ` (${number(summary.percent)}%)`;
  return <div className="ws-stack">
    <label className="ws-field">Blank threshold<select value={multiplier} onChange={event => setMultiplier(Number(event.target.value))}>{MULTIPLIERS.map(n => <option key={n} value={n}>{n} × detection limit{n === BLANK_MULTIPLIER.default ? ' (default)' : ''}</option>)}</select></label>
    <QaqcReportDownload kind="blanks" snapshot={snapshot} analysis={analysis} propertyName={propertyName} chartRefs={{ blank: chart }} captureCurrent={captureCurrent} />
    <p><strong>{analysis.eligibleCount} assessed / {analysis.selectedCount} selected blanks</strong> · {analysis.excludedCount} unassessed.</p>
    <p>{manifest.submittedCount} rows submitted; {manifest.loadedWrittenCount} records written by this import. {manifest.rolledBackAt ? 'This import has been rolled back; these are its historical records.' : 'Historical import snapshot; newer versions may exist.'}</p>
    <p className="dash-muted">A blank fails when its reported value is above {multiplier} × the recorded detection limit. Below-detection blanks pass and stay censored; no value is substituted. A blank with no recorded detection limit is unassessed. Detected blanks use the single limit recorded on below-detection results for this laboratory job, element and unit in this import.</p>
    <figure ref={chart} style={{ margin: 0 }}><h4>Blank threshold comparison</h4><ThresholdPlot points={analysis.points} rows={rows} unit={analysis.scope.unit} multiplier={multiplier} /><figcaption>Solid line: recorded detection limit. Dashed line: {multiplier} × detection limit threshold. Filled circles: pass; open circles: below detection, plotted at the recorded limit; squares: above threshold. Points are in submitted-row order with gaps retained; no analytical order is implied.</figcaption><QaqcChartDownload chart={chart} available={single} title="Blank threshold comparison" filename={`qaqc-blanks-${analysis.scope.batchId}.png`} captureCurrent={captureCurrent} lines={[`Recorded detection limit: ${analysis.points[0]?.detectionLimit} ${analysis.scope.unit}; threshold ${multiplier} × detection limit = ${analysis.points[0]?.threshold} ${analysis.scope.unit}.`, 'Linear scale from zero. Solid: recorded detection limit; dashed: threshold. Filled circles: pass; open circles: below detection, plotted at the limit (censored); squares: above threshold. Submitted-row gaps retained; no analytical order implied.', `Above threshold: ${analysis.summaries.fail.count}/${analysis.summaries.fail.total}; pass: ${analysis.summaries.pass.count}/${analysis.summaries.pass.total}, including ${analysis.summaries.censored.count} below detection.`, ...provenance]} /></figure>
    <ul aria-label="Blank threshold summary"><li>Above threshold (fail): {analysis.summaries.fail.count}/{analysis.summaries.fail.total}{percent(analysis.summaries.fail)}</li><li>At or below threshold (pass): {analysis.summaries.pass.count}/{analysis.summaries.pass.total}{percent(analysis.summaries.pass)}</li><li>Passing below-detection (censored): {analysis.summaries.censored.count}/{analysis.summaries.censored.total}</li></ul>
    {analysis.failures.length > 0 && <section aria-label="Blanks above threshold"><h4 style={{ margin: 0 }}>Failures</h4><ul>{analysis.failures.map(p => <li key={p.id}>Row {p.sourceRow} · {p.sampleId}: {p.observed.raw} {p.unit} is {number(p.ratio)} × the detection limit {p.detectionLimit} {p.unit} (threshold {number(p.threshold)} {p.unit})</li>)}</ul></section>}
    <details><summary>Recorded detection limits ({dl.values.length ? dl.values.join(', ') : 'none'} {analysis.scope.unit})</summary><p>{dl.sources.length} below-detection results in this laboratory job, element and unit record a numeric limit. {dl.values.length > 1 ? 'They differ, so detected blanks are unassessed.' : ''}</p><ul>{dl.sources.slice(0, 20).map(source => <li key={source.recordId} style={{ overflowWrap: 'anywhere' }}>Row {source.sourceRow} · {source.sampleId} ({source.sampleType}): {source.raw ?? 'Unavailable'} · limit {source.limit} · record {source.recordId}</li>)}</ul>{dl.sources.length > 20 && <p>{dl.sources.length - 20} more sources are listed in the comparison PDF.</p>}</details>
    {analysis.excludedCount > 0 && <details><summary>Why {analysis.excludedCount} blanks are unassessed</summary><ul>{Object.entries(analysis.excludedByReason).filter(([, count]) => count).map(([reason, count]) => <li key={reason}>{analysis.excluded.find(row => row.reason === reason).message} ({count})</li>)}</ul></details>}
    <div className="ws-table-wrap" tabIndex="0" role="region" aria-label="Scrollable blanks comparison table"><table className="ws-table" aria-label="Blanks comparison data">
      <caption>Raw reported values in submitted-row order. Below-detection values receive no substituted value.</caption>
      <thead><tr><th>Submitted row / sample</th><th>Reported result</th><th>Detection limit</th><th>Comparison</th></tr></thead>
      <tbody>{rows.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.id}>
        <td>{row.sourceRow} · {row.sampleId}<details><summary>Record provenance</summary><p style={{ overflowWrap: 'anywhere' }}>Sample record: {row.id}<br />Import: {row.batchId}<br />Submitted row: {row.sourceRow}</p></details></td>
        <td>{row.observed.raw ?? 'Unavailable'} {row.observed.unit ?? ''}{row.observed.censored && <> (below detection{row.observed.detectionLimit != null && <>; recorded limit {row.observed.detectionLimit} {row.observed.unit}</>})</>}</td>
        <td>{row.detectionLimit == null ? 'Not recorded' : <>{row.detectionLimit} {row.unit}<br /><small>{row.detectionLimitSource === 'result' ? 'Recorded on this result' : 'Recorded for this laboratory job'}</small></>}</td>
        <td>{row.status === 'unassessed' ? `Unassessed: ${row.message}` : <><strong>{outcome(row)}</strong><br />Threshold {number(row.threshold)} {row.unit}{!row.censored && <><br />{number(row.ratio)} × detection limit</>}</>}</td>
      </tr>)}</tbody>
    </table></div>
    {rows.length > 50 && <div className="ws-row"><button type="button" className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous blanks</button><span>Page {page + 1} of {Math.ceil(rows.length / 50)}</span><button type="button" className="btn" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(p => p + 1)}>Next blanks</button></div>}
    <details><summary>Snapshot source and limits</summary><p style={{ overflowWrap: 'anywhere' }}>Import: {analysis.scope.batchId}<br />File: {manifest.provenance?.filename || 'Not recorded'}<br />File SHA-256: {manifest.provenance?.sha256 || 'Not recorded'}<br />Request fingerprint: {manifest.requestHash}<br />Retrieved: {manifest.retrievedAt}</p><p>Only records written by this import are included. Unchanged records from reimports remain in earlier imports. This is not a full-file, whole-job or current-property report. Submitted row is not an analytical date or run sequence. Detection limits recorded in other imports are not used.</p></details>
  </div>;
}

function Comparison({ client, propertyId, propertyName, batchId, onClose }) {
  const [discovery, setDiscovery] = useState(null), [choice, setChoice] = useState('');
  const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [sessionRevision, setSessionRevision] = useState(0);
  const heading = useRef(null), alive = useRef(true), generation = useRef(0);
  useEffect(() => { alive.current = true; heading.current?.focus(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const subscription = client.auth?.onAuthStateChange?.((event) => {
      if (event !== 'INITIAL_SESSION' && alive.current) { generation.current++; setSnapshot(null); setDiscovery(null); setChoice(''); setSessionRevision(value => value + 1); }
    });
    return () => subscription?.data?.subscription?.unsubscribe();
  }, [client]);
  useEffect(() => {
    const controller = new AbortController(); let active = true; const version = generation.current;
    const current = () => active && version === generation.current;
    setLoading(true); setError(''); setDiscovery(null); setSnapshot(null); setChoice('');
    discoverBlankGroups(client, { propertyId, batchId }, { signal: controller.signal, isCurrent: current })
      .then(result => { if (!current()) return; if (!result.complete) throw new Error(result.issues[0]?.message || 'Could not load comparison groups.'); setDiscovery(result); })
      .catch(err => { if (current() && err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [client, propertyId, batchId, sessionRevision]);
  useEffect(() => {
    if (!discovery || choice === '') return undefined;
    const scope = discovery.groups[Number(choice)]; if (!scope) return undefined;
    const controller = new AbortController(); let active = true; const version = generation.current;
    const current = () => active && version === generation.current;
    setSnapshot(null); setLoading(true); setError('');
    loadBlankSnapshot(client, scope, { signal: controller.signal, isCurrent: current })
      .then(result => { if (!current()) return; if (!result.complete) throw new Error(result.issues[0]?.message || 'Could not finish loading the snapshot.'); setSnapshot(result); })
      .catch(err => { if (current() && err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [client, discovery, choice]);
  const reportVersion = generation.current;
  return <section className="ws-stack" aria-label="Blank comparisons">
    <button type="button" className="btn" onClick={() => { generation.current++; onClose(); }}>Back to QA/QC</button>
    <h3 ref={heading} tabIndex="-1" style={{ margin: 0 }}>Compare blanks</h3>
    <p>Import snapshot: records written by this import.</p>
    {discovery && (discovery.groups.length ? <label className="ws-field">Comparison group<select style={{ maxWidth: '100%' }} value={choice} onChange={event => { generation.current++; setSnapshot(null); setError(''); setLoading(event.target.value !== ''); setChoice(event.target.value); }}><option value="">Choose lab job and element</option>{discovery.groups.map((group, index) => <option key={index} value={index}>{short(group)}</option>)}</select></label> : <p>No blank comparison groups were written by this import.</p>)}
    {loading && <p role="status">Loading comparison snapshot…</p>}
    {error && <p className="ws-error" role="alert">{error} No comparison is shown. Go back and reopen to retry.</p>}
    {snapshot && <Results key={choice} snapshot={snapshot} propertyName={propertyName} captureCurrent={() => () => alive.current && reportVersion === generation.current} />}
  </section>;
}

export default function QaqcBlankView(props) {
  return <Comparison key={`${props.propertyId}:${props.batchId}`} {...props} />;
}
