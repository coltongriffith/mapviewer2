import React, { useEffect, useMemo, useRef, useState } from 'react';
import { discoverCrmGroups, loadCrmSnapshot } from '../../utils/drillQaqcSnapshot';
import { analyzeCrmSnapshot } from '../../../shared/qaqcCrms';

import QaqcChartDownload from './QaqcChartDownload';
import { chartProvenance } from '../../utils/qaqcChartPng';

const number = value => value == null ? '—' : value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6) ? value.toExponential(3) : Number(value).toLocaleString(undefined, { maximumSignificantDigits: 5 });
const short = group => `${group.crmId} (${group.crmRevision}) · ${group.labId} / ${group.labBatchId} · ${group.element} (${group.unit})`;
const categories = { within2: 'Within/on ±2 supplied SD', outside2Within3: 'Outside ±2, within/on ±3 supplied SD', outside3: 'Outside ±3 supplied SD' };

function ReferencePlot({ points, unit, rows }) {
  if (!points.length) return <p>No assessable standards are available for the reference plot.</p>;
  // Reference definitions in one immutable identity have the same supplied
  // values. Keep each point's own bands visible if malformed evidence differs;
  // do not silently invent one shared reference from inconsistent definitions.
  const references = [...new Map(points.map(p => [JSON.stringify(p.bands), p.bands])).values()];
  if (references.length !== 1) return <p role="alert">The pinned definitions disagree within this group. Review the evidence table; no combined reference plot is shown.</p>;
  const bands = references[0], values = [...points.map(p => p.observed.value), ...Object.values(bands)];
  // Normalize first: subtraction/padding at tiny magnitudes must not produce
  // zero ranges or nonfinite SVG coordinates.
  const magnitude = Math.max(...values.map(Math.abs)) || 1;
  const normalized = values.map(v => v / magnitude);
  const low = Math.min(...normalized), high = Math.max(...normalized), pad = Math.max((high - low) * 0.08, 0.01);
  const bottom = low - pad, top = high + pad;
  const first = Math.min(...rows.map(p => p.sourceRow)), last = Math.max(...rows.map(p => p.sourceRow));
  const x = value => first === last ? 240 : 75 + (value - first) / (last - first) * 330;
  const y = value => 295 - (value / magnitude - bottom) / (top - bottom) * 270;
  const ticks = [bottom, (bottom + top) / 2, top];
  return <svg viewBox="0 0 480 360" style={{ display: 'block', width: '100%', maxWidth: 760, margin: '0 auto' }} role="img" aria-label={`CRM reference plot, ${points.length} assessed standards in ${unit}, by submitted row. Bands use supplied SD. Data available in the standards table.`}>
    <rect x="75" y="25" width="330" height="270" fill="none" stroke="currentColor" />
    {ticks.map((tick, i) => <text key={i} x="69" y={y(tick * magnitude) + 4} textAnchor="end" fontSize="11" fill="currentColor">{number(tick * magnitude)}</text>)}
    {[...new Set([first, Math.round((first + last) / 2), last])].map(tick => <text key={tick} x={x(tick)} y="314" textAnchor="middle" fontSize="11" fill="currentColor">{tick}</text>)}
    {Object.entries(bands).map(([key, value]) => <g key={key}><line x1="75" x2="405" y1={y(value)} y2={y(value)} stroke={key === 'expected' ? 'currentColor' : '#64748b'} strokeDasharray={key === 'expected' ? undefined : key.endsWith('2') ? '3 3' : '8 4'} /><title>{key}: {value} {unit}</title></g>)}
    {points.map(p => <circle key={p.id} cx={x(p.sourceRow)} cy={y(p.observed.value)} r="3.5" fill="#2563eb" fillOpacity="0.7"><title>{p.sampleId}: {p.observed.raw} {unit}; z {number(p.z)}; {categories[p.category]}</title></circle>)}
    <text x="240" y="345" textAnchor="middle" fill="currentColor" fontSize="12">Submitted row (not analysis order)</text>
    <text transform="translate(15 160) rotate(-90)" textAnchor="middle" fill="currentColor" fontSize="12" data-export-label={unit.length > 20 ? "Reported value (unit below)" : undefined}>Reported value ({unit})</text>
  </svg>;
}

function Results({ snapshot, propertyName, captureCurrent }) {
  const analysis = useMemo(() => analyzeCrmSnapshot(snapshot), [snapshot]);
  const [page, setPage] = useState(0);
  const rows = useMemo(() => [...analysis.points, ...analysis.excluded].sort((a, b) => a.sourceRow - b.sourceRow || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [analysis]);
  const manifest = snapshot.manifest;
  const provenance = chartProvenance(analysis, manifest, propertyName);
  const chart = useRef(null);
  return <div className="ws-stack">
    <p><strong>{analysis.eligibleCount} assessed / {analysis.selectedCount} selected standards</strong> · {analysis.excludedCount} unassessed.</p>
    <p>{manifest.submittedCount} rows submitted; {manifest.loadedWrittenCount} records written by this import. {manifest.rolledBackAt ? 'This import has been rolled back; these are its historical records.' : 'Historical import snapshot; newer versions may exist.'}</p>
    <p className="dash-muted">Reference comparisons use supplied SD and exact pinned definitions. They do not verify the certificate or laboratory method, or assess consecutive results.</p>
    <figure ref={chart} style={{ margin: 0 }}><h4>CRM reference comparison</h4><ReferencePlot points={analysis.points} rows={rows} unit={analysis.scope.unit} /><figcaption>Solid line: supplied expected value. Short dashes: ±2 supplied SD. Long dashes: ±3 supplied SD. Points retain submitted-row gaps; no analytical trend is implied. Zero observations and negative mathematical reference lines use a linear scale.</figcaption><QaqcChartDownload chart={chart} available={analysis.points.length > 0 && new Set(analysis.points.map(p => JSON.stringify(p.bands))).size === 1} title="CRM reference comparison" filename={`qaqc-standards-${analysis.scope.batchId}.png`} captureCurrent={captureCurrent} lines={[`Supplied expected value: ${analysis.points[0]?.reference.expected}; supplied SD: ${analysis.points[0]?.reference.sd} ${analysis.scope.unit}.`, 'Linear scale. Solid: supplied expected value; short dashes: ±2 supplied SD; long dashes: ±3 supplied SD. Submitted-row gaps retained; no analytical order or trend implied.', 'Supplied SD and exact pinned definitions; certificate and laboratory method not independently verified. Descriptive comparisons, not pass/fail or consecutive-result assessment.', ...Object.entries(analysis.summaries).map(([key, summary]) => `${categories[key]}: ${summary.count}/${summary.total}.`), ...provenance]} /></figure>
    <ul>{Object.entries(analysis.summaries).map(([key, summary]) => <li key={key}>{categories[key]}: {summary.count}/{summary.total}{summary.percent == null ? ' (percentage unavailable)' : ` (${number(summary.percent)}%)`}</li>)}</ul>
    <p className="dash-muted">These three categories do not overlap. Being within a band is not approval of a laboratory job.</p>
    {analysis.excludedCount > 0 && <details><summary>Why {analysis.excludedCount} standards are unassessed</summary><ul>{Object.entries(analysis.excludedByReason).filter(([, count]) => count).map(([reason, count]) => <li key={reason}>{analysis.excluded.find(row => row.reason === reason).message} ({count})</li>)}</ul></details>}
    <div className="ws-table-wrap" tabIndex="0" role="region" aria-label="Scrollable standards comparison table"><table className="ws-table" aria-label="Standards comparison data">
      <caption>Raw reported values and exact pinned references in submitted-row order. Below-detection values receive no substituted score.</caption>
      <thead><tr><th>Submitted row / sample</th><th>Reported result</th><th>Supplied reference</th><th>Comparison</th></tr></thead>
      <tbody>{rows.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.id}>
        <td>{row.sourceRow} · {row.sampleId}<details><summary>Record provenance</summary><p style={{ overflowWrap: 'anywhere' }}>Sample record: {row.id}<br />Import: {row.batchId}<br />Pinned CRM: {row.reference?.recordId || 'Unavailable'}<br />CRM import: {row.reference?.batchId || 'Unavailable'}<br />CRM submitted row: {row.reference?.sourceRow ?? 'Unavailable'}</p></details></td>
        <td>{row.observed.raw ?? 'Unavailable'} {row.observed.unit ?? ''}{row.observed.censored && <> (below detection{row.observed.detectionLimit != null && <>; recorded limit {row.observed.detectionLimit} {row.observed.unit}</>})</>}</td>
        <td>{row.reference ? <>Expected {row.reference.expected}; SD {row.reference.sd} {row.reference.unit}<br /><span style={{ overflowWrap: 'anywhere' }}>{row.reference.source}</span><br /><small>{row.reference.crmId} · {row.reference.revision}</small></> : 'Unavailable'}</td>
        <td>{row.status === 'unassessed' ? `Unassessed: ${row.message}` : <>z = {number(row.z)}<br />{categories[row.category]}<details><summary>Exact score and reference lines</summary><p>z: {row.z}<br />Expected: {row.bands.expected}<br />±2 SD: {row.bands.lower2} to {row.bands.upper2}<br />±3 SD: {row.bands.lower3} to {row.bands.upper3} {row.unit}</p></details></>}</td>
      </tr>)}</tbody>
    </table></div>
    {rows.length > 50 && <div className="ws-row"><button type="button" className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous standards</button><span>Page {page + 1} of {Math.ceil(rows.length / 50)}</span><button type="button" className="btn" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(p => p + 1)}>Next standards</button></div>}
    <details><summary>Snapshot source and limits</summary><p style={{ overflowWrap: 'anywhere' }}>Import: {analysis.scope.batchId}<br />File: {manifest.provenance?.filename || 'Not recorded'}<br />File SHA-256: {manifest.provenance?.sha256 || 'Not recorded'}<br />Request fingerprint: {manifest.requestHash}<br />Retrieved: {manifest.retrievedAt}</p><p>Only records written by this import are included. Unchanged records from reimports remain in earlier imports. This is not a full-file, whole-job or current-property report. Submitted row is not an analytical date or run sequence. Supplied SD is not independently checked as a certificate uncertainty or method match.</p></details>
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
    discoverCrmGroups(client, { propertyId, batchId }, { signal: controller.signal, isCurrent: current })
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
    loadCrmSnapshot(client, scope, { signal: controller.signal, isCurrent: current })
      .then(result => { if (!current()) return; if (!result.complete) throw new Error(result.issues[0]?.message || 'Could not finish loading the snapshot.'); setSnapshot(result); })
      .catch(err => { if (current() && err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [client, discovery, choice]);
  const reportVersion = generation.current;
  return <section className="ws-stack" aria-label="Standard comparisons">
    <button type="button" className="btn" onClick={() => { generation.current++; onClose(); }}>Back to QA/QC</button>
    <h3 ref={heading} tabIndex="-1" style={{ margin: 0 }}>Compare standards</h3>
    <p>Import snapshot: records written by this import.</p>
    {discovery && (discovery.groups.length ? <label className="ws-field">Comparison group<select style={{ maxWidth: '100%' }} value={choice} onChange={event => { generation.current++; setSnapshot(null); setError(''); setLoading(event.target.value !== ''); setChoice(event.target.value); }}><option value="">Choose CRM revision, lab job and element</option>{discovery.groups.map((group, index) => <option key={index} value={index}>{short(group)}</option>)}</select></label> : <p>No standard comparison groups were written by this import.</p>)}
    {loading && <p role="status">Loading comparison snapshot…</p>}
    {error && <p className="ws-error" role="alert">{error} No comparison is shown. Go back and reopen to retry.</p>}
    {snapshot && <Results key={choice} snapshot={snapshot} propertyName={propertyName} captureCurrent={() => () => alive.current && reportVersion === generation.current} />}
  </section>;
}

export default function QaqcCrmView(props) {
  return <Comparison key={`${props.propertyId}:${props.batchId}`} {...props} />;
}
