import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  drillDb, parseCsv, detectKind, autoMapping, applyTemplate, buildImport, diffSentence, serverErrors,
  KINDS, FIELDS, BDL_MODES, MAX_FILE_BYTES, kindLabel,
} from '../../utils/drillDb';
import { formatWhen } from '../../utils/workspace';
import { ErrorNote } from './shared';
import { lazyGuarded } from '../../utils/preloadGuard';
import DrillCoordinateSource from './DrillCoordinateSource';
import { keepFileSource, sourceCoordinateMapping } from '../../utils/drillCoordinates';
import { detectPreset, presetMapping } from '../../utils/drillPresets';

const ResultsPanel = lazyGuarded(() => import('./ResultsPanel'));
const ExcelSheetPicker = lazyGuarded(() => import('./ExcelSheetPicker'));
const BatchCertificates = lazyGuarded(() => import('./BatchCertificates'));
const QaqcPanel = lazyGuarded(() => import('./QaqcPanel'));

// The property's drill database: what is stored, importing CSV or XLSX (columns,
// checks, the diff, commit) and the import history with Roll back. Loaded
// with its tab, so neither the editor nor the other workspace screens carry it.

const n = (v) => Number(v || 0).toLocaleString('en-US');

function Summary({ s }) {
  if (!s) return <p className="dash-muted">Loading the drill database…</p>;
  const items = [['Holes', n(s.holes)], ['Collars', `${n(s.collars)}${s.planned ? ` (${n(s.planned)} planned)` : ''}`], ['Metres drilled', n(s.metres)],
    ['Survey stations', n(s.surveys)], ['Assays', n(s.assays)], ['Lithology intervals', n(s.lithology)]];
  if (typeof s.alteration === 'number') items.push(['Alteration intervals', n(s.alteration)]);
  if (typeof s.structure === 'number') items.push(['Structure measurements', n(s.structure)]);
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

export function Importer({ db, property, orgId, onDone, onStart, rolledBackBatchIds }) {
  const [file, setFile] = useState(null); // { name, header, rows }
  const [workbook, setWorkbook] = useState(null);
  const [kind, setKind] = useState('assays');
  const [mapping, setMapping] = useState(null);
  const [templatePage, setTemplatePage] = useState(null);
  const templates = templatePage?.kind === kind ? templatePage.rows : [];
  const [templateRevision, setTemplateRevision] = useState(0);
  const [tplName, setTplName] = useState('');
  const [diff, setDiff] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [conversion, setConversion] = useState(null);
  const [preset, setPreset] = useState(null); // a vendor preset the header matches, offered until used or dismissed
  const batchId = useRef(null);
  const [receiptBatchId, setReceiptBatchId] = useState(null);
  // Derive visibility from both identities: a commit response may arrive after
  // its batch was already found in history and successfully rolled back.
  const receiptRolledBack = receiptBatchId && rolledBackBatchIds?.has(`${property.id}:${receiptBatchId}`);
  const input = useRef(null);
  const readVersion = useRef(0);
  const operationVersion = useRef(0);
  useEffect(() => () => { readVersion.current++; operationVersion.current++; }, []);

  useEffect(() => {
    let active = true; setTemplatePage(null);
    if (file) db.templates(orgId, kind).then(rows => { if (active) setTemplatePage({ kind, rows }); }).catch(() => { if (active) setTemplatePage(null); });
    return () => { active = false; };
  }, [db, orgId, file, kind, templateRevision]);

  const built = useMemo(() => (file && mapping ? buildImport(kind, file, mapping) : null), [file, kind, mapping]);
  const change = (m) => { operationVersion.current++; setBusy(null); setMapping(m); setDiff(null); setNote(null); batchId.current = null; };
  const reset = () => { readVersion.current++; operationVersion.current++; setWorkbook(null); setFile(null); setMapping(null); setDiff(null); setTplName(''); setBusy(null); setPreset(null); batchId.current = null; setReceiptBatchId(null); };
  const choose = (t, name, excel = null) => {
    if (excel) setWorkbook(w => ({ ...w, selection: excel }));
    const k = detectKind(t.header, t.rows, excel?.sheet || name) || 'assays';
    setFile({ name, ...t, excel }); setKind(k);
    setMapping({ ...autoMapping(k, t.header, t.rows, { name, crs: property.crs, decimalComma: excel?.decimalComma }), ...(excel ? { excel } : {}) });
    setPreset(detectPreset(t.header)); setDiff(null); batchId.current = null;
  };

  const open = async (f) => {
    onStart?.();
    setError(null); setNote(null); reset();
    const version = readVersion.current;
    if (/\.xls$/i.test(f.name)) { setError('This is an older .xls file. Save it as .xlsx or CSV in Excel, then try again.'); return; }
    if (!/\.(csv|txt|tsv|xlsx)$/i.test(f.name)) { setError('Choose a CSV, tab-separated text or Excel .xlsx file.'); return; }
    if (f.size > MAX_FILE_BYTES) { setError('That file is larger than 30 MB. Split it and import each part.'); return; }
    try {
      setBusy('read');
      if (/\.xlsx$/i.test(f.name)) {
        const reader = await import('../../utils/xlsxRead.js');
        const sheets = await reader.readWorkbook(f);
        if (version === readVersion.current) setWorkbook({ name: f.name, sheets, reader });
        return;
      }
      const t = await parseCsv(await f.text());
      if (version !== readVersion.current) return;
      if (!t.header.length) throw new Error('The file is empty.');
      choose(t, f.name);
    } catch (e) { if (version === readVersion.current) setError(e.message); }
    finally { if (version === readVersion.current) setBusy(null); }
  };
  const run = async (key, fn) => {
    const version = ++operationVersion.current;
    const current = () => version === operationVersion.current;
    setBusy(key); setError(null);
    try { await fn(current); } catch (e) { if (current()) setError(e.message); } finally { if (current()) setBusy(null); }
  };
  const cs = mapping?.coordinateSource;
  const converting = kind === 'collars' && cs?.operation === 'convert';
  const converted = converting && conversion?.input === built?.rows && conversion.rows ? conversion : null;
  const args = () => ({ propertyId: property.id, kind, rows: converted ? converted.rows : built.rows, filename: file.name,
    mapping: converted ? { ...mapping, coordinateSource: { ...cs, methods: converted.counts, grids: converted.grids, expectedErrorM: converted.expectedErrorM } } : mapping });
  const check = () => run('check', async current => {
    const result = await db.dryRun(args());
    if (!current()) return;
    // A database without the source-coordinate columns would drop the originals: keep the file's values instead.
    if (converted && result?.ok && typeof result.source_coordinates !== 'number') {
      change(sourceCoordinateMapping(mapping, mapping.crs));
      setNote(`This site’s drill database cannot store converted coordinates with their originals yet, so nothing was converted. ${file.name} will be imported with its own X/Y and ${mapping.crs}; check again to continue.`);
      return;
    }
    setDiff(result);
  });
  const commit = () => run('commit', async current => {
    batchId.current = batchId.current || crypto.randomUUID();
    const r = await db.commit({ ...args(), batchId: batchId.current });
    if (!current()) return;
    setNote(r.nothing_to_do ? `Nothing to import: everything in ${file.name} is already stored.` : `Imported ${file.name}: ${diffSentence(kind, r)}.`);
    // Only the server's committed batch can receive certificate evidence. A no-op
    // has no new batch; a rolled-back replay must not invite a new attachment.
    const certificateBatch = kind === 'assays' && r.committed && !r.nothing_to_do && !r.rolled_back && r.batch_id
      ? { id: r.batch_id, filename: file.name, kind, propertyId: property.id } : null;
    reset();
    setReceiptBatchId(r.committed && !r.nothing_to_do && !r.rolled_back ? r.batch_id : null);
    onDone(certificateBatch);
  });

  if (!file && workbook) return <Suspense fallback={<p role="status">Preparing sheet preview…</p>}><ExcelSheetPicker workbook={workbook} onCancel={reset}
    onChoose={(table, excel) => choose(table, workbook.name, excel)} /></Suspense>;
  if (!file) {
    return (
      <div>
        {note && !receiptRolledBack && <p className="ws-ok" role="status" style={{ marginBottom: 10 }}>{note}</p>}
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        <div className="ws-row">
          <button type="button" className="btn primary" onClick={() => input.current?.click()}>+ Import CSV or Excel</button>
          <span className="dash-muted">Collars, downhole surveys, assays, lithology, alteration or structure. CSV or .xlsx; up to 20,000 rows per import.</span>
        </div>
        {busy === 'read' && <p role="status">Reading file… <button type="button" className="btn" onClick={reset}>Cancel</button></p>}
        <input ref={input} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden aria-label="Drill data file"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(f); }} />
      </div>
    );
  }

  const cols = mapping.columns || {};
  const setCol = (k, v) => change({ ...mapping, columns: { ...cols, [k]: v || undefined } });
  const setEl = (i, patch) => change({ ...mapping, elements: mapping.elements.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const selectTemplate = (id) => {
    const template = templates.find(x => x.id === id);
    if (!template) return;
    const mapped = applyTemplate(template, file.header, kind === 'assays' ? autoMapping(kind, file.header, file.rows, { decimalComma: mapping.decimalComma }).elements : null);
    change({ ...(kind === 'collars' ? keepFileSource(mapped, mapping) : mapped), decimalComma: mapping.decimalComma === true, excel: file.excel || undefined });
    setNote(kind === 'collars' && mapped.crs && mapped.crs !== mapping.crs
      ? `Columns applied; the source CRS stays ${mapping.crs || 'unspecified'}. This template used ${mapped.crs}—confirm the source coordinate system below against your file.` : null);
  };
  const usePreset = () => {
    const base = autoMapping(preset.kind, file.header, file.rows, { name: file.name, crs: property.crs, decimalComma: mapping.decimalComma });
    const mapped = presetMapping(preset, file.header, base);
    setKind(preset.kind);
    change({ ...(preset.kind === 'collars' && kind === 'collars' ? keepFileSource(mapped, mapping) : mapped), ...(file.excel ? { excel: file.excel } : {}) });
    setNote(`Columns set from the ${preset.vendor} preset. Check them below before importing.`); setPreset(null);
  };
  const problems = built ? { ...built, errors: diff?.ok === false ? serverErrors(diff, built.lines) : built.errors, errorCount: diff?.ok === false ? diff.error_count : built.errorCount } : null;
  return (
    <form className="ws-form" aria-label="Import drill data" onSubmit={(e) => { e.preventDefault(); if (diff?.ok) commit(); else check(); }}>
      <fieldset disabled={busy === 'commit'} className="ws-stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {note && !receiptRolledBack && <p className="ws-notice" role="status">{note}</p>}
      {preset && (
        <div className="ws-notice ws-row" role="group" aria-label="Import preset">
          <span>Looks like {preset.label}: use its mapping?</span>
          <button type="button" className="btn" onClick={usePreset}>Use its mapping</button>
          <button type="button" className="btn" onClick={() => setPreset(null)}>Dismiss</button>
        </div>
      )}
      <div className="ws-row">
        <span className="ws-list-main"><b>{file.name}</b><small>{n(file.rows.length)} rows · {file.header.length} columns</small></span>
        {file.excel && <button type="button" className="btn" disabled={!!busy} onClick={() => { operationVersion.current++; setFile(null); setMapping(null); setDiff(null); batchId.current = null; }}>Choose sheet or header</button>}
        <button type="button" className="btn" onClick={reset}>Cancel</button>
      </div>
      {file.excel && <p className="dash-muted">Sheet: {file.excel.sheet} · header row {file.excel.headerRow} · decimal separator: {mapping.decimalComma ? 'comma' : 'point'}. Reported line numbers refer to worksheet rows.</p>}
      <div className="ws-form-grid">
        <label className="ws-field">Data
          <select value={kind} onChange={(e) => { const k = e.target.value; setKind(k); change({ ...autoMapping(k, file.header, file.rows, { name: file.name, crs: property.crs, decimalComma: mapping.decimalComma }), ...(file.excel ? { excel: file.excel } : {}) }); }}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="ws-field">Saved columns
          <select value="" onChange={(e) => selectTemplate(e.target.value)}>
            <option value="">{templates.length ? 'Apply a template…' : 'No templates yet'}</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {kind === 'assays' && (
          <label className="ws-field">Below detection (&lt;) stored as
            <select value={mapping.bdl || 'half'} onChange={(e) => change({ ...mapping, bdl: e.target.value })}>
              {BDL_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {kind === 'collars' && <DrillCoordinateSource mapping={mapping} propertyCrs={property.crs} jurisdiction={property.jurisdiction} rows={built.rows} onChange={change} onConverted={setConversion} />}
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
      {kind === 'alteration' && <p className="dash-muted">One alteration record per hole and interval. Code or description is required. Intensity stays as source text (for example weak or 03); blank means unknown. No collars or 3D geology are created.</p>}
      {kind === 'structure' && <p className="dash-muted">One structure measurement per hole and depth. Alpha (0 to 90) with optional beta (0 to 360), dip (0 to 90) with optional dip direction (0 to 360), or a description is required. Type stays as source text. Not drawn in 3D.</p>}
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
          <button type="submit" className="btn primary" disabled={!!busy || !built || built.errorCount > 0 || (converting && (!converted || (converted.needsAck && !cs.acknowledged)))}>{busy === 'check' ? 'Checking…' : 'Check against stored data'}</button>
        )}
        <span className="ws-field"><input aria-label="Template name" placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} style={{ width: 170 }} /></span>
        <button type="button" className="btn" disabled={!tplName.trim() || !!busy}
          onClick={() => run('tpl', async current => { await db.saveTemplate(orgId, kind, tplName.trim(), mapping); if (current()) { setTplName(''); setTemplateRevision(v => v + 1); } })}>Save columns as template</button>
      </div>
      </fieldset>
    </form>
  );
}

export default function DrillPanel({ property, perms }) {
  const db = useMemo(() => (supabase ? drillDb(supabase) : null), []);
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [results, setResults] = useState(false);
  const [qaqc, setQaqc] = useState(false);
  const [certificateBatch, setCertificateBatch] = useState(null);
  const [rolledBackBatchIds, setRolledBackBatchIds] = useState(() => new Set());
  const [revision, setRevision] = useState(0); // bumped by each import and roll-back, so Results reloads its assays
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
      try { await db.rollback(b.id); setRolledBackBatchIds(ids => new Set(ids).add(`${property.id}:${b.id}`)); setCertificateBatch(current => current?.id === b.id ? null : current); setRevision((v) => v + 1); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); }
    })();
  return (
    <section aria-label="Drill data" className="ws-stack">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      <div className="dash-panel"><Summary s={s} /></div>
      {perms.edit && db && <div className="dash-panel"><Importer key={property.id} db={db} property={property} orgId={property.org_id} rolledBackBatchIds={rolledBackBatchIds} onStart={() => setCertificateBatch(null)} onDone={batch => { setCertificateBatch(batch); setRevision((v) => v + 1); load(); }} /></div>}
      {perms.edit && certificateBatch?.propertyId === property.id && !rolledBackBatchIds.has(`${property.id}:${certificateBatch.id}`) && <section className="dash-panel" aria-label="Import certificate step">
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Add supporting lab certificates (optional)</h3>
        <p className="dash-muted">{certificateBatch.filename} is already imported. Link a library PDF or upload one now; you can also do this later from its import history. Linking a certificate does not verify the assay results.</p>
        <Suspense fallback={<p role="status">Loading certificate options…</p>}><BatchCertificates key={certificateBatch.id} client={supabase} property={property} batch={certificateBatch} canEdit={perms.edit} label="Attach lab certificates" /></Suspense>
        <button type="button" className="dash-link" style={{ marginTop: 10 }} onClick={() => setCertificateBatch(null)}>Done / skip for now</button>
      </section>}
      <section className="dash-panel" aria-label="QA/QC">
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>QA/QC</h3>
        {qaqc ? <Suspense fallback={<p role="status">Loading QA/QC…</p>}><QaqcPanel property={property} perms={perms} /></Suspense> : <div className="ws-row"><button type="button" className="btn" onClick={() => setQaqc(true)}>Open QA/QC register</button><span className="dash-muted">Routine samples, standards, blanks and duplicates, with their lab provenance.</span></div>}
      </section>
      {s?.assays > 0 && (
        <section className="dash-panel" aria-label="Results">
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Results</h3>
          {results ? <Suspense fallback={<p className="dash-muted">Loading…</p>}><ResultsPanel property={property} perms={perms} revision={revision} /></Suspense> : (
            <div className="ws-row">
              <button type="button" className="btn" onClick={() => setResults(true)}>Show results</button>
              <span className="dash-muted">Intercepts from the assays with this property's metal equivalent and cut-offs, as a news-release table.</span>
            </div>
          )}
        </section>
      )}
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
                    <td>{b.filename || '—'}{b.kind === 'assays' && <Suspense fallback={null}><BatchCertificates client={supabase} property={property} batch={b} canEdit={perms.edit} /></Suspense>}</td>
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
