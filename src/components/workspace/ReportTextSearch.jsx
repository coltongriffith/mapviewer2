import React, { useEffect, useRef, useState } from 'react';
import { searchReportText, safeReportTextMessage } from '../../utils/reportTextSearch.js';

export default function ReportTextSearch({ file, propertyId, userId, lib, isCurrent, onClose }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0), controller = useRef(null);
  const scope = useRef(null);
  if (scope.current?.file !== file || scope.current?.userId !== userId || scope.current?.propertyId !== propertyId) scope.current = { file, userId, propertyId };
  useEffect(() => {
    const requests = request, active = controller;
    setQuery(''); setResult(null); setError(null); setBusy(false);
    return () => { requests.current++; active.current?.abort(); };
  }, [file, propertyId, userId]);
  const find = async (event) => {
    event.preventDefault();
    const context = scope.current, token = ++request.current;
    controller.current?.abort(); controller.current = new AbortController();
    const current = () => token === request.current && context === scope.current && isCurrent();
    setBusy(true); setError(null); setResult(null);
    try {
      // Validate before the private read; query text never leaves this tab.
      searchReportText('', query);
      const report = await lib.reportText(propertyId, file, { userId, signal: controller.current.signal, isCurrent: current });
      if (current()) setResult({ context, ...searchReportText(report.text, query), source: report.source });
    } catch (err) { if (current()) setError({ context, message: safeReportTextMessage(err) }); }
    finally { if (current()) setBusy(false); }
  };
  const visible = result?.context === scope.current ? result : null;
  return <section className="dash-panel" aria-label={`Find in report text: ${file.name}`} style={{ marginTop: 16 }}>
    <div className="ws-row"><h3 style={{ flex: 1 }}>Find in report text</h3><button type="button" className="dash-link" onClick={onClose}>Close text search</button></div>
    <p className="dash-muted">{file.name} · v{file.version}. UTF-8 text only, up to 2 MiB. PDF and Word content are not searched.</p>
    <form className="ws-row" onSubmit={find} aria-label="Search report contents">
      <label style={{ flex: 1 }}>Text to find<input aria-label="Text to find" type="search" maxLength={200} disabled={busy} value={query} onChange={e => { setQuery(e.target.value); setResult(null); setError(null); }} style={{ display: 'block', width: '100%' }} /></label>
      <button type="submit" className="btn" disabled={busy || !query.trim()}>{busy ? 'Searching…' : 'Find in text'}</button>
    </form>
    {error?.context === scope.current && <p role="alert">{error.message}</p>}
    {visible && <>
      <p className="dash-muted" style={{ overflowWrap: 'anywhere' }}>{visible.source.name} · v{visible.source.version} · SHA-256 {visible.source.sha256}</p>
      <p role="status">{visible.total ? `${visible.total} matching ${visible.total === 1 ? 'line' : 'lines'}${visible.capped ? '; showing the first 50' : ''}.` : 'No matching lines in this report.'}</p>
      <ol>{visible.matches.map(hit => <li key={hit.line} style={{ overflowWrap: 'anywhere', marginBottom: 8 }}><b>Line {hit.line}:</b> {hit.before}<mark>{hit.match}</mark>{hit.after}</li>)}</ol>
    </>}
  </section>;
}
