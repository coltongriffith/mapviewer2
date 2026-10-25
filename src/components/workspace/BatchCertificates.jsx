import React, { useEffect, useMemo, useRef, useState } from 'react';
import { drillCertificates } from '../../utils/drillCertificates';

/** Open on demand: importing never depends on the optional certificate migration. */
export default function BatchCertificates({ client, property, batch, canEdit }) {
  const api = useMemo(() => client ? drillCertificates(client) : null, [client]);
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState([]);
  const [choices, setChoices] = useState([]);
  const [selected, setSelected] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retracting, setRetracting] = useState(null);
  const [reason, setReason] = useState('');
  const uploadInput = useRef(null);
  const editable = canEdit && !batch.rolled_back_at;
  useEffect(() => {
    if (!open || !api) return undefined;
    let active = true;
    setReady(false); setError('');
    Promise.all([api.list(batch.id), editable ? api.choices(property.id) : []]).then(([rows, files]) => {
      if (active) { setLinks(rows); setChoices(files); setReady(true); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [api, open, batch.id, editable, property.id]);
  const run = async (fn) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const attach = async (fileId, version) => {
    await api.attach(batch.id, fileId, version);
    setNotice('Certificate linked to this assay import.');
    try { setLinks(await api.list(batch.id)); }
    catch { setError('The link was saved, but the list could not refresh. Close and reopen Lab certificates.'); }
  };
  return <div style={{ marginTop: 6 }}>
    <button type="button" className="dash-link" aria-expanded={open} onClick={() => setOpen(v => !v)}>Lab certificates</button>
    {open && <div aria-label={`Certificates for ${batch.filename || 'assay import'}`}>
      {error && <p className="ws-error" role="alert">{error}</p>}
      {notice && <p className="ws-ok" role="status">{notice}</p>}
      {!ready && !error && <p role="status">Loading certificates…</p>}
      {ready && <>
        {links.length ? <ul style={{ paddingLeft: 18 }}>{links.map(link => <li key={`${link.file_id}:${link.version}`}>
          {link.storage_path ? <button type="button" className="dash-link" disabled={busy} onClick={() => run(async () => {
            const url = await api.download(batch.id, link.file_id, link.version);
            const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; a.click();
          })}>{link.name} · v{link.version}</button> : <span>{link.name} · v{link.version} (unavailable)</span>}
          {link.retracted_at ? <span className="dash-muted"> · Retracted: {link.retraction_reason}</span> : canEdit && <button type="button" className="dash-link" disabled={busy} onClick={() => { setRetracting(link); setReason(''); }}>Retract link</button>}
        </li>)}</ul> : <p className="dash-muted">No certificate linked to this import.</p>}
        {retracting && <div className="ws-stack">
          <label className="ws-field">Why retract {retracting.name}?
            <input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} />
          </label>
          <div className="ws-row"><button type="button" className="btn" disabled={busy || !reason.trim()} onClick={() => run(async () => {
            await api.retract(batch.id, retracting.file_id, retracting.version, reason.trim());
            setLinks(await api.list(batch.id)); setRetracting(null); setNotice('Link retracted. Its history and the library PDF are retained.');
          })}>Confirm retraction</button><button type="button" className="btn" disabled={busy} onClick={() => setRetracting(null)}>Cancel</button></div>
        </div>}
        {editable && <>
          <p className="dash-muted">Link a PDF from this property's library. Its version is fixed; a newer upload will not replace this record. Retract an incorrect link to keep its history.</p>
          <label className="ws-field">Certificate PDF
            <select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>
              <option value="">Choose a library PDF…</option>
              {choices.map(file => <option key={file.id} value={file.id}>{file.name} · v{file.version}</option>)}
            </select>
          </label>
          <div className="ws-row">
            <button type="button" className="btn" disabled={busy || !selected} onClick={() => run(async () => {
              const file = choices.find(f => f.id === selected); await attach(file.id, file.version);
            })}>Link certificate</button>
            <button type="button" className="btn" disabled={busy} onClick={() => uploadInput.current?.click()}>Upload PDF and link</button>
          </div>
          <input ref={uploadInput} type="file" accept=".pdf,application/pdf" hidden aria-label="Upload lab certificate" disabled={busy} onChange={e => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
            run(async () => {
              const uploaded = await api.upload(property, file);
              try {
                setChoices(await api.choices(property.id)); setSelected(uploaded.fileId);
                await attach(uploaded.fileId, uploaded.version);
              }
              catch (err) { throw new Error(`The PDF was saved in the property library, but was not linked. Choose it from the library to retry. ${err.message}`); }
            });
          }} />
          {busy && <p role="status">Working…</p>}
        </>}
      </>}
    </div>}
  </div>;
}
