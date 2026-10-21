import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  drillDb, parseCsv, detectKind, autoMapping, applyTemplate, buildImport, diffSentence, serverErrors,
  KINDS, FIELDS, BDL_MODES, MAX_FILE_BYTES, kindLabel,
} from '../../utils/drillDb';
import { formatWhen } from '../../utils/workspace';
import { ErrorNote } from './shared';

// The property's drill database: what is stored, importing a CSV (columns,
// checks, the diff, commit) and the import history with Roll back. Loaded
// with its tab, so neither the editor nor the other workspace screens carry it.

const n = (v) => Number(v || 0).toLocaleString('en-US');

function Summary({ s }) {
  if (!s) return <p className="dash-muted">Loading the drill database…</p>;
  const items = [['Holes', n(s.holes)], ['Collars', `${n(s.collars)}${s.planned ? ` (${n(s.planned)} planned)` : ''}`], ['Metres drilled', n(s.metres)],
    ['Survey stations', n(s.surveys)], ['Assays', n(s.assays)], ['Lithology intervals', n(s.lithology)]];
  return (
    <dl className="ws-stats" aria-label="Drill data summary">
      {items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      {s.elements?.length > 0 && <div><dt>Elements</dt><dd>{s.elements.join(', ')}</dd></div>}
    </dl>
  );
}

function Problems({ errors, errorCount, warnings }) {
  if (!errorCount && !warnings.length) return <p className="ws-ok">No problems found in the file.</p>;
  return (
    <div>
      {errorCount > 0 && (
        <div className="ws-error" role="alert">
          <b>{n(errorCount)} {errorCount === 1 ? 'problem stops' : 'problems stop'} this import:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {errors.slice(0, 8).map((e, i) => <li key={i}>{e.line ? `Line ${e.line}: ` : ''}{e.message}</li>)}
          </ul>
          {errorCount > 8 && <small>…and {n(errorCount - 8)} more.</small>}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="ws-notice" aria-label="Warnings" style={{ paddingLeft: 26 }}>
          {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function Importer({ db, property, orgId, onDone }) {
  const [file, setFile] = useState(null); // { name, header, rows }
  const [kind, setKind] = useState('assays');
  const [mapping, setMapping] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [tplName, setTplName] = useState('');
  const [diff, setDiff] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const batchId = useRef(null);
  const input = useRef(null);

  const loadTemplates = useCallback((k) => db.templates(orgId, k).then(setTemplates).catch(() => setTemplates([])), [db, orgId]);
  useEffect(() => { if (file) loadTemplates(kind); }, [file, kind, loadTemplates]);

  const built = useMemo(() => (file && mapping ? buildImport(kind, file, mapping) : null), [file, kind, mapping]);
  const change = (m) => { setMapping(m); setDiff(null); batchId.current = null; };
  const reset = () => { setFile(null); setMapping(null); setDiff(null); setTplName(''); batchId.current = null; };

  const open = async (f) => {
    setError(null); setNote(null); reset();
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) { setError('Choose a CSV file. Save Excel sheets as CSV (comma or tab separated) first.'); return; }
    if (f.size > MAX_FILE_BYTES) { setError('That file is larger than 30 MB. Split it and import each part.'); return; }
    try {
      const t = await parseCsv(await f.text());
      if (!t.header.length) throw new Error('The file is empty.');
      const k = detectKind(t.header, t.rows, f.name) || 'assays';
      setFile({ name: f.name, ...t });
      setKind(k);
      setMapping(autoMapping(k, t.header, t.rows, { name: f.name, crs: property.crs }));
    } catch (e) { setError(e.message); }
  };
  const run = async (key, fn) => {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const args = () => ({ propertyId: property.id, kind, rows: built.rows, mapping, filename: file.name });
  const check = () => run('check', async () => setDiff(await db.dryRun(args())));
  const commit = () => run('commit', async () => {
    batchId.current = batchId.current || crypto.randomUUID();
    const r = await db.commit({ ...args(), batchId: batchId.current });
    setNote(r.nothing_to_do ? `Nothing to import: everything in ${file.name} is already stored.` : `Imported ${file.name}: ${diffSentence(kind, r)}.`);
    reset();
    onDone();
  });

  if (!file) {
    return (
      <div>
        {note && <p className="ws-ok" role="status" style={{ marginBottom: 10 }}>{note}</p>}
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        <div className="ws-row">
          <button type="button" className="btn primary" onClick={() => input.current?.click()}>+ Import a CSV</button>
          <span className="dash-muted">Collars, downhole surveys, assays or lithology. Up to 20,000 rows per import (split larger files); Excel sheets saved as CSV.</span>
        </div>
        <input ref={input} type="file" accept=".csv,.txt,.tsv,text/csv" hidden aria-label="Drill data file"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(f); }} />
      </div>
    );
  }

  const cols = mapping.columns || {};
  const setCol = (k, v) => change({ ...mapping, columns: { ...cols, [k]: v || undefined } });
  const setEl = (i, patch) => change({ ...mapping, elements: mapping.elements.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const problems = built ? { ...built, errors: diff?.ok === false ? serverErrors(diff, built.lines) : built.errors, errorCount: diff?.ok === false ? diff.error_count : built.errorCount } : null;
  return (
    <form className="ws-form" aria-label="Import drill data" onSubmit={(e) => { e.preventDefault(); if (diff?.ok) commit(); else check(); }}>
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      <div className="ws-row">
        <span className="ws-list-main"><b>{file.name}</b><small>{n(file.rows.length)} rows · {file.header.length} columns</small></span>
        <button type="button" className="btn" onClick={reset}>Cancel</button>
      </div>
      <div className="ws-form-grid">
        <label className="ws-field">Data
          <select value={kind} onChange={(e) => { const k = e.target.value; setKind(k); change(autoMapping(k, file.header, file.rows, { name: file.name, crs: property.crs })); }}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="ws-field">Saved columns
          <select value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) change(applyTemplate(t, file.header, kind === 'assays' ? autoMapping(kind, file.header, file.rows).elements : null)); }}>
            <option value="">{templates.length ? 'Apply a template…' : 'No templates yet'}</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {kind === 'collars' && (
          <label className="ws-field">Coordinate system
            <input value={mapping.crs || ''} placeholder="EPSG:26910" onChange={(e) => change({ ...mapping, crs: e.target.value.trim() || undefined })} />
          </label>
        )}
        {kind === 'assays' && (
          <label className="ws-field">Below detection (&lt;) stored as
            <select value={mapping.bdl || 'half'} onChange={(e) => change({ ...mapping, bdl: e.target.value })}>
              {BDL_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <fieldset className="ws-form-grid" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="dash-muted" style={{ fontSize: 13, marginBottom: 4 }}>Columns</legend>
        {FIELDS[kind].map((f) => (
          <label key={f.key} className="ws-field">{f.label}{f.required ? ' *' : ''}
            <select value={cols[f.key] || ''} onChange={(e) => setCol(f.key, e.target.value)}>
              <option value="">— not in the file —</option>
              {file.header.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        ))}
      </fieldset>
      {kind === 'assays' && (
        <div className="ws-table-wrap">
          <table className="ws-table" aria-label="Elements">
            <thead><tr><th>Import</th><th>Column</th><th>Element</th><th>Unit</th></tr></thead>
            <tbody>
              {(mapping.elements || []).map((e, i) => (
                <tr key={e.column}>
                  <td><input type="checkbox" aria-label={`Import ${e.column}`} checked={e.skip !== true} onChange={(ev) => setEl(i, { skip: !ev.target.checked })} /></td>
                  <td className={e.skip ? 'dash-muted' : undefined}>{e.column}{e.unitColumn ? <small className="dash-muted"> · units in {e.unitColumn}</small> : null}</td>
                  <td><span className="ws-field"><input aria-label={`Element for ${e.column}`} value={e.name} size={8} onChange={(ev) => setEl(i, { name: ev.target.value })} /></span></td>
                  <td><span className="ws-field"><input aria-label={`Unit for ${e.column}`} value={e.unit || ''} size={6} placeholder="%, ppm, g/t" onChange={(ev) => setEl(i, { unit: ev.target.value || null })} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!mapping.elements?.some((e) => !e.skip) && <p className="dash-muted">Tick the columns that hold assay values.</p>}
        </div>
      )}
      {problems && <Problems {...problems} />}
      {diff?.ok && (
        <div className="dash-panel" role="status" aria-label="Changes">
          <p style={{ margin: 0 }}><b>{diffSentence(kind, diff)}</b></p>
          {diff.missing_collars > 0 && <p className="dash-muted" style={{ margin: '6px 0 0' }}>{n(diff.missing_collars)} {diff.missing_collars === 1 ? 'hole has' : 'holes have'} no collar yet: {diff.missing_collar_holes.join(', ')}{diff.missing_collars > 10 ? '…' : ''}</p>}
          {diff.overlaps_existing > 0 && <p className="dash-muted" style={{ margin: '6px 0 0' }}>Intervals overlap stored ones they do not replace in {n(diff.overlaps_existing)} {diff.overlaps_existing === 1 ? 'hole' : 'holes'}: {diff.overlap_holes.join(', ')}</p>}
          {diff.changed_sample?.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }} aria-label="Changed rows">
              {diff.changed_sample.slice(0, 5).map((c, i) => {
                const keys = Object.keys({ ...c.before, ...c.after }).filter((k) => JSON.stringify(c.before?.[k]) !== JSON.stringify(c.after?.[k]));
                return <li key={i}>{c.hole_id}{c.k1 != null ? ` ${c.k1}${c.k2 != null ? `–${c.k2}` : ''} m` : ''}: {keys.map((k) => `${k} ${JSON.stringify(c.before?.[k] ?? '—')} → ${JSON.stringify(c.after?.[k] ?? '—')}`).join('; ')}</li>;
              })}
            </ul>
          )}
        </div>
      )}
      <div className="ws-row">
        {diff?.ok ? (
          <button type="submit" className="btn primary" disabled={!!busy || !(diff.new + diff.changed)}>{busy === 'commit' ? 'Importing…' : 'Commit import'}</button>
        ) : (
          <button type="submit" className="btn primary" disabled={!!busy || !built || built.errorCount > 0}>{busy === 'check' ? 'Checking…' : 'Check against stored data'}</button>
        )}
        <span className="ws-field"><input aria-label="Template name" placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} style={{ width: 170 }} /></span>
        <button type="button" className="btn" disabled={!tplName.trim() || !!busy}
          onClick={() => run('tpl', async () => { await db.saveTemplate(orgId, kind, tplName.trim(), mapping); setTplName(''); await loadTemplates(kind); })}>Save columns as template</button>
      </div>
    </form>
  );
}

export default function DrillPanel({ property, perms }) {
  const db = useMemo(() => (supabase ? drillDb(supabase) : null), []);
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    try {
      if (!db) throw new Error('The drill database is not available on this site right now.');
      setS(await db.summary(property.id));
    } catch (e) { setError(e.message); setS((x) => x || { batches: [] }); }
  }, [db, property.id]);
  useEffect(() => { load(); }, [load]);
  const back = (b) => window.confirm(`Roll back the import of ${b.filename || kindLabel(b.kind)}? Its rows stop being current and what it replaced comes back. The import stays in the history.`)
    && (async () => {
      setBusy(b.id); setError(null);
      try { await db.rollback(b.id); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); }
    })();
  return (
    <section aria-label="Drill data" className="ws-stack">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      <div className="dash-panel"><Summary s={s} /></div>
      {perms.edit && db && <div className="dash-panel"><Importer db={db} property={property} orgId={property.org_id} onDone={load} /></div>}
      <div className="dash-panel">
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Imports</h3>
        {!s?.batches?.length ? <p className="dash-muted">{s ? 'Nothing imported yet.' : 'Loading…'}</p> : (
          <div className="ws-table-wrap">
            <table className="ws-table" aria-label="Import history">
              <thead><tr><th>When</th><th>Data</th><th>File</th><th>Change</th><th>By</th><th><span className="dash-sr-only">Actions</span></th></tr></thead>
              <tbody>
                {s.batches.map((b) => (
                  <tr key={b.id}>
                    <td>{formatWhen(b.created_at)}</td>
                    <td>{kindLabel(b.kind)}</td>
                    <td>{b.filename || '—'}</td>
                    <td>{diffSentence(b.kind, b.summary)}</td>
                    <td>{b.created_by_email || '—'}</td>
                    <td>
                      {b.rolled_back_at ? <small className="dash-muted">Rolled back {formatWhen(b.rolled_back_at)}</small>
                        : perms.edit && (
                          <button type="button" className="dash-link" disabled={!!busy || !!b.blocked_by} aria-label={`Roll back ${b.filename || kindLabel(b.kind)}`}
                            title={b.blocked_by ? 'A later import changed rows from this one; roll that back first' : undefined}
                            onClick={() => back(b)}>{busy === b.id ? 'Rolling back…' : 'Roll back'}</button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
