import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { discoverDuplicateGroups, loadDuplicateSnapshot } from '../../utils/drillQaqcSnapshot';
import { analyzeDuplicateSnapshot } from '../../../shared/qaqcDuplicates';

const TYPES = { field_dup: 'Field duplicates', coarse_dup: 'Coarse duplicates', pulp_dup: 'Pulp duplicates' };
import QaqcChartDownload from './QaqcChartDownload';
import { chartProvenance } from '../../utils/qaqcChartPng';

const number = value => value == null ? '—' : value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6) ? value.toExponential(3) : Number(value).toLocaleString(undefined, { maximumSignificantDigits: 5 });
const short = group => `${TYPES[group.sampleType]} · ${group.labId} / ${group.labBatchId} · ${group.element} (${group.unit})`;
const chartStyle = { display: 'block', width: '100%', maxWidth: 460, margin: '0 auto' };

function ReportedResult({ source }) {
  return <>{source?.raw ?? 'Unavailable'} {source?.unit ?? ''}{source?.censored && <> (below detection{source.detectionLimit != null && <>; recorded limit {source.detectionLimit} {source.unit}</>})</>}</>;
}

function Scatter({ points, unit }) {
  const clip = useId().replace(/:/g, '');
  const positive = points.filter(point => point.logEligible);
  if (!positive.length) return <p>No positive pairs are available for the log scatter.</p>;
  const values = positive.flatMap(point => [Math.log10(point.x), Math.log10(point.y)]);
  let low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * 0.08, 0.1); low = Math.max(Math.log10(Number.MIN_VALUE), low - padding); high += padding;
  const x = value => 55 + (Math.log10(value) - low) / (high - low) * 300;
  const y = value => 325 - (Math.log10(value) - low) / (high - low) * 300;
  const ticks = [low, (low + high) / 2, high].map(exponent => 10 ** exponent);
  return <svg viewBox="0 0 405 385" style={chartStyle} role="img" aria-label={`Original versus duplicate log scatter, ${positive.length} positive pairs. Values in ${unit}. Data available in the comparison table.`}>
    <defs><clipPath id={clip}><rect x="55" y="25" width="300" height="300" /></clipPath></defs>
    <rect x="55" y="25" width="300" height="300" fill="none" stroke="currentColor" />
    {ticks.map((tick, index) => <g key={index} fill="currentColor" fontSize="11">
      <text x={x(tick)} y="344" textAnchor="middle">{number(tick)}</text>
      <text x="49" y={y(tick) + 4} textAnchor="end">{number(tick)}</text>
    </g>)}
    <g clipPath={`url(#${clip})`}>
      {[0.1, 0.2, 0.3].flatMap(fraction => [-1, 1].map(side => { const shift = Math.log10(1 + side * fraction) / (high - low) * 300; return <line key={`${fraction}-${side}`} x1="55" x2="355" y1={325 - shift} y2={25 - shift} stroke="#64748b" strokeDasharray={fraction === 0.1 ? '2 3' : fraction === 0.2 ? '6 4' : '10 5'} />; }))}
      <line x1="55" y1="325" x2="355" y2="25" stroke="currentColor" strokeWidth="1.5" />
      {positive.map(point => <circle key={point.id} cx={x(point.x)} cy={y(point.y)} r="3" fill="#2563eb" fillOpacity="0.65"><title>{point.sampleId}: original {point.original.raw}, duplicate {point.duplicate.raw} {unit}; HARD {number(point.hard)}%</title></circle>)}
    </g>
    <text x="205" y="372" textAnchor="middle" fill="currentColor" fontSize="12" data-export-label={unit.length > 20 ? "Original (log scale; unit below)" : undefined}>Original ({unit}, log scale)</text>
    <text transform="translate(13 175) rotate(-90)" textAnchor="middle" fill="currentColor" fontSize="12" data-export-label={unit.length > 20 ? "Duplicate (log scale; unit below)" : undefined}>Duplicate ({unit}, log scale)</text>
  </svg>;
}

function Ranked({ points }) {
  if (!points.length) return <p>No eligible pairs are available for ranked HARD.</p>;
  return <svg viewBox="0 0 405 385" style={chartStyle} role="img" aria-label={`Ranked HARD cumulative plot, ${points.length} eligible pairs. Data available in the comparison table.`}>
    <rect x="55" y="25" width="300" height="300" fill="none" stroke="currentColor" />
    {[0, 25, 50, 75, 100].map(tick => <g key={tick} fill="currentColor" fontSize="11"><text x={55 + tick * 3} y="344" textAnchor="middle">{tick}</text><text x="49" y={329 - tick * 3} textAnchor="end">{tick}%</text></g>)}
    <polyline points={points.map(point => `${55 + point.hard * 3},${325 - point.cumulativePercent * 3}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="1.5" />
    {points.map(point => <circle key={point.id} cx={55 + point.hard * 3} cy={325 - point.cumulativePercent * 3} r="2.5" fill="#2563eb"><title>{point.sampleId}: HARD {number(point.hard)}%; rank {point.rank} of {points.length}</title></circle>)}
    <text x="205" y="372" textAnchor="middle" fill="currentColor" fontSize="12">HARD (%)</text><text transform="translate(13 175) rotate(-90)" textAnchor="middle" fill="currentColor" fontSize="12">Cumulative percentage of eligible pairs</text>
  </svg>;
}

function Results({ snapshot, propertyName, captureCurrent }) {
  const analysis = useMemo(() => analyzeDuplicateSnapshot(snapshot), [snapshot]);
  const [page, setPage] = useState(0);
  const rows = useMemo(() => [...analysis.points, ...analysis.excluded].sort((a, b) => a.sourceRow - b.sourceRow || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [analysis]);
  const manifest = snapshot.manifest;
  const provenance = chartProvenance(analysis, manifest, propertyName);
  const chart = useRef(null), rankedChart = useRef(null);
  return <div className="ws-stack">
    <p><strong>{analysis.eligibleCount} eligible / {analysis.selectedCount} selected pairs</strong> · {analysis.excludedCount} unassessed. Log scatter: {analysis.summaries.logCount} pairs; {analysis.summaries.logExcludedCount} eligible pairs omitted from log axes because of zero values.</p>
    <p>{manifest.submittedCount} rows submitted; {manifest.loadedWrittenCount} records written by this import. {manifest.rolledBackAt ? 'This import has been rolled back; these are its historical records.' : 'Historical import snapshot; newer versions may exist.'}</p>
    <p className="dash-muted">Agreement is descriptive, not pass/fail. Laboratory method is not recorded. Exact reported units and pinned original versions are used.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
      <figure ref={chart} style={{ margin: 0 }}><h4>Original vs duplicate</h4><Scatter points={analysis.points} unit={analysis.scope.unit} /><figcaption>Equal log scales. Solid line: 1:1. Dashed bands: ±10%, ±20%, ±30% of the original (short to long dashes), not HARD thresholds.</figcaption><QaqcChartDownload chart={chart} available={analysis.summaries.logCount > 0} title="Original vs duplicate" filename={`qaqc-scatter-${analysis.scope.batchId}.png`} captureCurrent={captureCurrent} lines={[`${analysis.summaries.logCount} positive pairs plotted; ${analysis.summaries.logExcludedCount} otherwise eligible zero-value pairs omitted from log axes.`, 'Equal log scales; solid 1:1 line. Short to long dashes: ±10%, ±20%, ±30% of the original, not HARD thresholds. Descriptive agreement, not pass/fail; laboratory method is not recorded.', ...provenance]} /></figure>
      <figure ref={rankedChart} style={{ margin: 0 }}><h4>Ranked HARD</h4><Ranked points={analysis.ranked} /><figcaption>HARD = 100 × |original − duplicate| / (original + duplicate). Equal HARD values use stable record-ID order.</figcaption><QaqcChartDownload chart={rankedChart} available={analysis.eligibleCount > 0} title="Ranked HARD" filename={`qaqc-hard-${analysis.scope.batchId}.png`} captureCurrent={captureCurrent} lines={['HARD = 100 × |original − duplicate| / (original + duplicate). Stable record-ID tie order. Descriptive agreement, not pass/fail; laboratory method is not recorded.', `Cumulative denominator: ${analysis.eligibleCount} eligible pairs, including eligible zero-value pairs. HARD ≤10%: ${analysis.summaries.within10.count}/${analysis.summaries.within10.total}; HARD ≤20%: ${analysis.summaries.within20.count}/${analysis.summaries.within20.total}.`, ...provenance]} /></figure>
    </div>
    <p>HARD ≤10%: {analysis.summaries.within10.count}/{analysis.summaries.within10.total} ({number(analysis.summaries.within10.percent)}%). HARD ≤20%: {analysis.summaries.within20.count}/{analysis.summaries.within20.total} ({number(analysis.summaries.within20.percent)}%). {analysis.eligibleCount === 0 && 'No eligible pairs; percentages are unavailable.'}</p>
    {analysis.excludedCount > 0 && <details><summary>Why {analysis.excludedCount} pairs are unassessed</summary><ul>{Object.entries(analysis.excludedByReason).filter(([, count]) => count).map(([reason, count]) => <li key={reason}>{analysis.excluded.find(row => row.reason === reason).message} ({count})</li>)}</ul></details>}
    <div className="ws-table-wrap" tabIndex="0" role="region" aria-label="Scrollable duplicate comparison table"><table className="ws-table" aria-label="Duplicate comparison data">
      <caption>Reported results in submitted-row order. Below-detection results stay as reported; no substituted values.</caption>
      <thead><tr><th>Submitted row / sample</th><th>Original result</th><th>Duplicate result</th><th>Comparison</th></tr></thead>
      <tbody>{rows.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.id}><td>{row.sourceRow} · {row.sampleId}<br /><small>Original: {row.parentSampleId || 'Unavailable'}</small><details><summary>Record provenance</summary><p style={{ overflowWrap: 'anywhere' }}>Duplicate record: {row.id}<br />Import: {row.batchId}<br />Pinned parent: {row.parentId || 'Unavailable'}<br />Original import: {row.original?.batchId || 'Unavailable'}<br />Original submitted row: {row.original?.sourceRow ?? 'Unavailable'}</p></details></td>
        <td><ReportedResult source={row.original} /></td><td><ReportedResult source={row.duplicate} /></td>
        <td>{row.status === 'unassessed' ? `Unassessed: ${row.message}` : <>HARD {number(row.hard)}%{!row.logEligible && <><br />Not on log scatter (zero value)</>}</>}</td></tr>)}</tbody>
    </table></div>
    {rows.length > 50 && <div className="ws-row"><button type="button" className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous pairs</button><span>Page {page + 1} of {Math.ceil(rows.length / 50)}</span><button type="button" className="btn" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(p => p + 1)}>Next pairs</button></div>}
    <details><summary>Snapshot source and limits</summary><p style={{ overflowWrap: 'anywhere' }}>Import: {analysis.scope.batchId}<br />File: {manifest.provenance?.filename || 'Not recorded'}<br />File SHA-256: {manifest.provenance?.sha256 || 'Not recorded'}<br />Request fingerprint: {manifest.requestHash}<br />Retrieved: {manifest.retrievedAt}</p><p>Only records written by this import are included. Unchanged records from reimports remain in earlier imports. This is not a full-file, whole-job or current-property report. Submitted row is not an analytical date or run sequence.</p></details>
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
    discoverDuplicateGroups(client, { propertyId, batchId }, { signal: controller.signal, isCurrent: current })
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
    loadDuplicateSnapshot(client, scope, { signal: controller.signal, isCurrent: current })
      .then(result => { if (!current()) return; if (!result.complete) throw new Error(result.issues[0]?.message || 'Could not finish loading the snapshot.'); setSnapshot(result); })
      .catch(err => { if (current() && err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [client, discovery, choice]);
  return <section className="ws-stack" aria-label="Duplicate comparisons">
    <button type="button" className="btn" onClick={() => { generation.current++; onClose(); }}>Back to QA/QC</button>
    <h3 ref={heading} tabIndex="-1" style={{ margin: 0 }}>Compare duplicates</h3>
    <p>Import snapshot: records written by this import.</p>
    {discovery && (discovery.groups.length ? <label className="ws-field">Comparison group<select style={{ maxWidth: '100%' }} value={choice} onChange={event => { generation.current++; setSnapshot(null); setError(''); setLoading(event.target.value !== ''); setChoice(event.target.value); }}><option value="">Choose duplicate type, lab job and element</option>{discovery.groups.map((group, index) => <option key={index} value={index}>{short(group)}</option>)}</select></label> : <p>No duplicate comparison groups were written by this import.</p>)}
    {loading && <p role="status">Loading comparison snapshot…</p>}
    {error && <p className="ws-error" role="alert">{error} No comparison is shown. Go back and reopen to retry.</p>}
    {snapshot && <Results key={choice} snapshot={snapshot} propertyName={propertyName} captureCurrent={() => { const version = generation.current; return () => alive.current && version === generation.current; }} />}
  </section>;
}

export default function QaqcDuplicateView(props) {
  return <Comparison key={`${props.propertyId}:${props.batchId}`} {...props} />;
}
