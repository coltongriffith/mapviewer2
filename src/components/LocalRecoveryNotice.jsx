import React, { useState } from 'react';
import { exportRecoveryRecord } from '../utils/projectStorage';
import { downloadBlob } from '../utils/svg';

const names = {
  'mapviewer.draft.v1': { label: 'draft', file: 'draft' },
  'mapviewer.projects.v1': { label: 'saved maps', file: 'saved-maps' },
};

// A read-only escape hatch for preserved corrupt browser records. This is not
// a repaired project or an importable archive; no storage is changed here.
export default function LocalRecoveryNotice({ records, onDismiss }) {
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const copies = records.filter((record) => Object.hasOwn(names, record.key));
  if (!copies.length) return null;
  const download = async (record) => {
    if (busy) return;
    setBusy(record.key); setMessage(''); setError('');
    try {
      const raw = exportRecoveryRecord(record.key);
      if (typeof raw !== 'string') throw new Error('The preserved copy is unavailable.');
      const bytes = new TextEncoder().encode(raw);
      // Do not silently replace an unsupported lone UTF-16 surrogate when
      // producing a UTF-8 file. Valid stored JSON/gz1 strings round-trip exactly.
      if (new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== raw) throw new Error('This copy could not be prepared without changing its contents.');
      const filename = `exploration-maps-${names[record.key].file}-recovery.txt`;
      await downloadBlob(filename, new Blob([bytes], { type: 'text/plain;charset=utf-8' }));
      setMessage('Recovery copy download started. Keep it for recovery or support; it is not a repaired map.');
    } catch (e) {
      setError(`${e.message || 'The recovery copy could not be downloaded.'} No stored data was changed. Try again or contact support.`);
    } finally { setBusy(null); }
  };
  return <section className="ed-banner local-recovery-notice" aria-label="Local data recovery" aria-busy={busy !== null}>
    <div className="local-recovery-message">
      <p role="alert">A local map record could not be opened. Its original data is preserved.</p>
      <p>Download a copy for recovery or support. This does not repair or remove the stored data.</p>
      {busy && <p role="status">Preparing recovery copy…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="local-recovery-actions">{copies.map((record) => <button key={record.key} type="button" className="ui-btn ui-btn--sm"
      disabled={busy !== null} onClick={() => download(record)} aria-label={`Download ${names[record.key].label} recovery copy`}>
      Download {names[record.key].label} copy
    </button>)}</div>
    <button type="button" className="ui-btn ui-btn--sm" onClick={onDismiss}>Dismiss recovery notice</button>
  </section>;
}
