import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { listQaqcRecords, listQaqcBatches, rollbackQaqc, qaqcError } from '../../utils/drillQaqcDb';
import { formatWhen } from '../../utils/workspace';
import QaqcImporter from './QaqcImporter';
const QaqcDuplicateView = lazy(() => import('./QaqcDuplicateView'));
const QaqcCrmView = lazy(() => import('./QaqcCrmView'));

function Pager({ next, pages, setPages, disabled, label }) {
  return <div className="ws-row" aria-label={label}>
    <button type="button" className="btn" disabled={disabled || pages.length === 1} onClick={() => setPages(p => p.slice(0, -1))}>Previous</button>
    <span>Page {pages.length}</span>
    <button type="button" className="btn" disabled={disabled || !next} onClick={() => setPages(p => [...p, next])}>Next</button>
  </div>;
}
function Records({ records, kind }) {
  return <div className="ws-table-wrap"><table className="ws-table" aria-label="QA/QC register">
    <thead><tr><th>{kind === 'samples' ? 'Sample' : 'CRM'}</th><th>{kind === 'samples' ? 'Type / lab job' : 'Revision / element'}</th><th>Reported values and provenance</th></tr></thead>
    <tbody>{records.map(row => {
      const record = row.record;
      return <tr key={row.id}><td>{kind === 'samples' ? record.sample_id : record.crm_id}</td>
        <td>{kind === 'samples' ? <>{record.sample_type}<br />{record.lab_id} · {record.lab_batch_id}</> : <>{record.revision}<br />{record.element} · {record.unit}</>}</td>
        <td>{kind === 'crms' ? <>Expected {record.expected}; SD {record.sd}<br />{record.source}</> : <>
          {Object.keys(record.values).slice(0, 3).map(element => <div key={element}>{element}: {record.raw_values[element]} {record.units[element]}{Object.hasOwn(record.bdl, element) ? ' (below detection)' : ''}</div>)}
          {Object.keys(record.values).length > 3 && <span>+{Object.keys(record.values).length - 3} more elements</span>}
        </>}
          <details><summary>Full record and source</summary>
            {kind === 'samples' && <ul>{Object.keys(record.values).map(element => <li key={element}>{element}: {record.raw_values[element]} {record.units[element]}{Object.hasOwn(record.bdl, element) ? ` · below detection${record.bdl[element] === true ? '' : ` limit ${record.bdl[element]}`}` : ''}</li>)}</ul>}
            {record.parent_sample_id && <p>Routine parent: {record.parent_sample_id}</p>}
            {record.crm_id && kind === 'samples' && <p>CRM: {record.crm_id}, revision {record.crm_revision}</p>}
            {row.parent_version_id && <p className="dash-muted" style={{ overflowWrap: 'anywhere' }}>Pinned parent record: {row.parent_version_id}</p>}
            {!!row.crm_version_ids?.length && <p className="dash-muted" style={{ overflowWrap: 'anywhere' }}>Pinned CRM records: {row.crm_version_ids.join(', ')}</p>}
            {record.hole_id && <p>Hole: {record.hole_id}{record.from_m != null ? ` · ${record.from_m}–${record.to_m} m` : ''}</p>}
            <p className="dash-muted" style={{ overflowWrap: 'anywhere' }}>Import {row.batch_id}; submitted row {row.source_row}. This is source order, not a worksheet line or sampling date.</p>
          </details>
        </td></tr>;
    })}</tbody>
  </table></div>;
}
function Register({ property, perms, client }) {
  const [kind, setKind] = useState('samples'), [revision, setRevision] = useState(0);
  const [pages, setPages] = useState([null]), [historyPages, setHistoryPages] = useState([null]);
  const [recordPage, setRecordPage] = useState(null), [history, setHistory] = useState(null);
  // Selection changes render before effect cleanup. Never interpret a loaded
  // CRM row with the sample schema (or show samples as CRM definitions).
  const records = recordPage?.kind === kind ? recordPage.data : null;
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(null);
  const [available, setAvailable] = useState(false);
  const [comparison, setComparison] = useState(null);
  const comparisonTrigger = useRef(null);
  const comparisonId = useRef(null);
  useEffect(() => { if (!comparison) comparisonTrigger.current?.focus(); }, [comparison]);
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setRecordPage(null); setHistory(null);
    if (!client) { setError('QA/QC needs a signed-in account.'); setLoading(false); return undefined; }
    Promise.all([listQaqcRecords(client, property.id, kind, pages.at(-1)), listQaqcBatches(client, property.id, historyPages.at(-1))])
      .then(([current, batches]) => { if (active) { setRecordPage({ kind, data: current }); setHistory(batches); setAvailable(true); } })
      .catch(e => { if (active) setError(qaqcError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, property.id, kind, pages, historyPages, revision]);
  const blocked = useMemo(() => new Set((history?.rows || []).filter(b => !b.rolled_back_at).flatMap(b => b.depends_on)), [history]);
  const refresh = () => { setPages([null]); setHistoryPages([null]); setRevision(r => r + 1); };
  const back = async batch => {
    if (!window.confirm(`Roll back this QA/QC import? Its records stop being current and previous records return. History is retained.`)) return;
    const version = epoch.current; setBusy(batch.id); setError(''); setNotice('');
    try {
      const result = await rollbackQaqc(client, batch.id);
      if (version !== epoch.current) return;
      if (!result?.rolled_back) throw new Error('The rollback was not confirmed. Retry to check its outcome.');
      setNotice(result.already ? 'This import was already rolled back.' : `Import rolled back. ${result.withdrawn} records withdrawn; ${result.restored} restored.`);
      refresh();
    } catch (e) { if (version === epoch.current) setError(qaqcError(e)); }
    finally { if (version === epoch.current) setBusy(null); }
  };
  if (comparison) {
    const View = comparison.kind === 'standards' ? QaqcCrmView : QaqcDuplicateView;
    return <Suspense fallback={<p role="status">Loading comparisons…</p>}><View client={client} propertyId={property.id} batchId={comparison.batchId} onClose={() => setComparison(null)} /></Suspense>;
  }
  return <div className="ws-stack">
    <p className="dash-muted">Import CRM definitions before standards, and routine samples before their duplicates. Values stay as reported; this register does not judge pass/fail.</p>
    {error && <p className="ws-error" role="alert">{error}</p>}
    {notice && <p className="ws-ok" role="status">{notice}</p>}
    <div className="ws-row"><label className="ws-field">Show records<select value={kind} disabled={!!busy} onChange={e => { setKind(e.target.value); setPages([null]); }}><option value="samples">Samples</option><option value="crms">CRM definitions</option></select></label>
      <button type="button" className="btn" disabled={loading || !!busy} onClick={refresh}>Refresh QA/QC</button></div>
    {loading && <p role="status">Loading QA/QC…</p>}
    {records && <>{records.rows.length ? <Records records={records.rows} kind={kind} /> : <p className="dash-muted">No current {kind === 'samples' ? 'samples' : 'CRM definitions'} on this page.</p>}
      <Pager label="Register pages" next={records.next} pages={pages} setPages={setPages} disabled={loading || !!busy} /></>}
    {perms.edit && available && <QaqcImporter client={client} propertyId={property.id} onSaved={refresh} />}
    {history && <section aria-label="QA/QC import history" className="ws-stack"><h4 style={{ margin: 0 }}>Import history</h4>
      {!history.rows.length ? <p className="dash-muted">No QA/QC imports yet.</p> : <div className="ws-table-wrap"><table className="ws-table" aria-label="QA/QC imports">
        <thead><tr><th>When / source</th><th>Data</th><th>Change</th><th>Status</th></tr></thead>
        <tbody>{history.rows.map(batch => <tr key={batch.id}><td>{formatWhen(batch.created_at)}<br />{batch.provenance.filename || 'Unnamed source'}
          <details><summary>Provenance</summary><p style={{ overflowWrap: 'anywhere' }}>Import {batch.id}<br />SHA-256: {batch.provenance.sha256 || 'Not recorded'}<br />{batch.provenance.sheet ? `Sheet ${batch.provenance.sheet}, header row ${batch.provenance.header_row}` : ''}</p><p className="dash-muted">The hash identifies the imported bytes. The original file is not attached here; retain it in the property library.</p></details>
        </td><td>{batch.kind === 'samples' ? <><span>Samples</span>{['duplicates', 'standards'].map(kind => <React.Fragment key={kind}><br /><button type="button" className="dash-link" disabled={!!busy} ref={node => { if (`${batch.id}:${kind}` === comparisonId.current) comparisonTrigger.current = node; }} onClick={() => { comparisonId.current = `${batch.id}:${kind}`; setComparison({ batchId: batch.id, kind }); }}>Compare {kind}</button></React.Fragment>)}</> : 'CRM definitions'}</td><td>{batch.summary.new} new, {batch.summary.changed} changed</td><td>{batch.rolled_back_at ? `Rolled back ${formatWhen(batch.rolled_back_at)}` : perms.edit ? <>
          <button type="button" className="dash-link" disabled={!!busy || blocked.has(batch.id)} onClick={() => back(batch)}>Roll back QA/QC import</button>
          {blocked.has(batch.id) && <small className="dash-muted">A later import depends on this one.</small>}
        </> : 'Current'}</td></tr>)}</tbody>
      </table></div>}
      <Pager label="Import history pages" next={history.next} pages={historyPages} setPages={setHistoryPages} disabled={loading || !!busy} />
    </section>}
  </div>;
}

// A new property receives a new request lifetime and no previous file/preview.
export default function QaqcPanel({ property, perms, client = supabase }) {
  return <Register key={property.id} property={property} perms={perms} client={client} />;
}
