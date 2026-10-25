import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { parseCsv, MAX_FILE_BYTES } from '../../utils/drillDb';
import { sha256Hex } from '../../utils/propertyFiles';
import { importQaqc, qaqcError } from '../../utils/drillQaqcDb';
import { autoQaqcMapping, buildQaqcImport, QAQC_FIELDS, QAQC_SAMPLE_TYPES, qaqcJsonBytes } from '../../utils/drillQaqcImport';
import { lazyGuarded } from '../../utils/preloadGuard';
const ExcelSheetPicker = lazyGuarded(() => import('./ExcelSheetPicker'));
const countText = r => `${r.new} new, ${r.changed} changed, ${r.unchanged} unchanged`;

export default function QaqcImporter({ client, propertyId, onSaved }) {
  const [kind, setKind] = useState('samples');
  const [file, setFile] = useState(null), [workbook, setWorkbook] = useState(null);
  const [mapping, setMapping] = useState(null), [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const input = useRef(null), epoch = useRef(0), batch = useRef(null);
  useEffect(() => () => { epoch.current++; }, []);
  const invalidate = () => { epoch.current++; setPreview(null); batch.current = null; setError(''); setNotice(''); };
  const change = next => { invalidate(); setMapping(next); };
  const clear = () => { epoch.current++; setFile(null); setWorkbook(null); setMapping(null); setPreview(null); batch.current = null; setBusy(false); };
  const choose = (table, meta, excel = null) => {
    invalidate(); setFile({ ...table, name: meta.name, sha256: meta.sha256, excel }); setWorkbook(null); setBusy(false);
    setMapping({ ...autoQaqcMapping(kind, table.header), decimalComma: excel?.decimalComma === true });
  };
  const open = async f => {
    clear(); setError(''); setNotice(''); const version = epoch.current; setBusy(true);
    try {
      if (!/\.(csv|txt|tsv|xlsx)$/i.test(f.name)) throw new Error('Choose CSV, tab-separated text or Excel .xlsx. Save older .xls files as .xlsx first.');
      if (f.size > MAX_FILE_BYTES) throw new Error('This file exceeds 30 MB. Split it into smaller files.');
      const sha256 = await sha256Hex(await f.arrayBuffer());
      const meta = { name: f.name, sha256 };
      if (/\.xlsx$/i.test(f.name)) {
        const reader = await import('../../utils/xlsxRead'); const sheets = await reader.readWorkbook(f);
        if (version === epoch.current) setWorkbook({ ...meta, sheets, reader });
      } else {
        const table = await parseCsv(await f.text());
        if (version === epoch.current) choose(table, meta);
      }
    } catch (e) { if (version === epoch.current) setError(e.message); }
    finally { if (version === epoch.current) setBusy(false); }
  };
  const built = useMemo(() => file && mapping ? buildQaqcImport(kind, file, mapping) : null, [kind, file, mapping]);
  const provenance = useMemo(() => file && mapping ? {
    filename: file.name, sha256: file.sha256, mapping, ...(file.excel ? { sheet: file.excel.sheet, header_row: file.excel.headerRow } : {}),
    bdl_policy: 'flag only; no substitution', source_order: 'submitted file order',
  } : null, [file, mapping]);
  const provenanceTooLarge = provenance && qaqcJsonBytes(provenance) > 16384;
  const run = async committing => {
    const version = epoch.current; setBusy(true); setError(''); setNotice('');
    if (committing) batch.current ||= crypto.randomUUID(); else batch.current = null;
    try {
      const result = await importQaqc(client, propertyId, kind, built.rows, { provenance, dryRun: !committing, batchId: committing ? batch.current : null });
      if (version !== epoch.current) return;
      if (!result?.ok) throw new Error('The server did not confirm this import. Check again before committing.');
      if (!committing) { setPreview(result); return; }
      if (result.rolled_back) {
        setNotice('This earlier import was rolled back. No records were restored. Check again to start a new import.');
        setPreview(null); batch.current = null; return;
      }
      if (!result.nothing_to_do && !result.committed) throw new Error('The import was not confirmed. Retry this attempt to check its outcome.');
      setNotice(result.nothing_to_do ? 'Nothing to import: these records are already stored.' : `${result.replayed ? 'Previous import confirmed' : 'Imported'}: ${countText(result)}.`);
      clear(); onSaved();
    } catch (e) { if (version === epoch.current) setError(qaqcError(e, built.lines)); }
    finally { if (version === epoch.current) setBusy(false); }
  };
  const setKindValue = value => {
    invalidate(); setKind(value); setMapping(file ? { ...autoQaqcMapping(value, file.header), decimalComma: mapping?.decimalComma === true } : null);
  };
  return <section className="ws-stack" aria-label="QA/QC import">
    {error && <p className="ws-error" role="alert">{error}</p>}
    {notice && <p className="ws-ok" role="status">{notice}</p>}
    <label className="ws-field">Import data<select disabled={busy || !!workbook} value={kind} onChange={e => setKindValue(e.target.value)}>
      <option value="samples">Samples</option><option value="crms">CRM definitions</option>
    </select></label>
    {!file && !workbook && <div className="ws-row"><button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>Import QA/QC CSV or Excel</button><span className="dash-muted">Up to 5,000 rows. Original reported values are preserved.</span></div>}
    <input ref={input} type="file" hidden accept=".csv,.tsv,.txt,.xlsx" aria-label="QA/QC data file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(f); }} />
    {busy && <p role="status">Working…</p>}
    {workbook && <Suspense fallback={<p role="status">Loading worksheet preview…</p>}><ExcelSheetPicker workbook={workbook} onCancel={clear} onChoose={(table, excel) => choose(table, workbook, excel)} /></Suspense>}
    {file && <form className="ws-stack" aria-label="Map QA/QC columns" onSubmit={e => { e.preventDefault(); run(!!preview); }}>
      <div className="ws-row"><b>{file.name} · {file.rows.length} rows</b><button type="button" className="btn" disabled={busy} onClick={clear}>Cancel import</button></div>
      <label className="ws-field">Decimal separator<select value={mapping.decimalComma ? 'comma' : 'point'} disabled={busy} onChange={e => change({ ...mapping, decimalComma: e.target.value === 'comma' })}><option value="point">Point (0.52)</option><option value="comma">Comma (0,52)</option></select></label>
      <div className="ws-form-grid">{QAQC_FIELDS[kind].filter(field => field.required).map(field => <label className="ws-field" key={field.key}>{field.label} *
        <select value={mapping.columns[field.key] || ''} disabled={busy} onChange={e => change({ ...mapping, columns: { ...mapping.columns, [field.key]: e.target.value || undefined } })}>
          <option value="">Not mapped</option>{file.header.map(header => <option key={header} value={header}>{header}</option>)}
        </select>
      </label>)}</div>
      {kind === 'samples' && <>
        <details><summary>Parent, CRM and interval columns</summary><div className="ws-form-grid">{QAQC_FIELDS.samples.filter(field => !field.required).map(field => <label className="ws-field" key={field.key}>{field.label}
          <select value={mapping.columns[field.key] || ''} disabled={busy} onChange={e => change({ ...mapping, columns: { ...mapping.columns, [field.key]: e.target.value || undefined } })}>
            <option value="">Not mapped</option>{file.header.map(header => <option key={header} value={header}>{header}</option>)}
          </select>
        </label>)}</div></details>
        <div className="ws-form-grid">{[['lab_id', 'Laboratory for this file'], ['lab_batch_id', 'Lab job for this file']].map(([key, label]) => <label className="ws-field" key={key}>{label}
          <input value={mapping.constants?.[key] || ''} disabled={busy || !!mapping.columns[key]} maxLength={120} onChange={e => change({ ...mapping, constants: { ...mapping.constants, [key]: e.target.value } })} />
        </label>)}<label className="ws-field">Sample type for this file<select value={mapping.constants?.sample_type || ''} disabled={busy || !!mapping.columns.sample_type} onChange={e => change({ ...mapping, constants: { ...mapping.constants, sample_type: e.target.value } })}>
          <option value="">Choose explicitly</option>{QAQC_SAMPLE_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select></label></div>
        <p className="dash-muted">File-wide values apply only when that column is not mapped. Standards need an existing CRM revision; duplicates need a previously imported routine parent in this lab job.</p>
        <fieldset disabled={busy}><legend>Reported elements</legend>{mapping.elements.map((element, index) => {
          const update = patch => change({ ...mapping, elements: mapping.elements.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
          return <div className="ws-row" key={element.column}>
            <label><input type="checkbox" checked={!element.skip} onChange={e => update({ skip: !e.target.checked })} /> {element.column}</label>
            <label className="ws-field">Element for {element.column}<input value={element.element} disabled={element.skip} onChange={e => update({ element: e.target.value })} /></label>
            <label className="ws-field">Unit for {element.column}<input value={element.unit} disabled={element.skip} onChange={e => update({ unit: e.target.value })} /></label>
          </div>;
        })}</fieldset>
      </>}
      {built?.errorCount > 0 && <div className="ws-error" role="alert">{built.errorCount} problems to correct:<ul>{built.errors.slice(0, 8).map((problem, i) => <li key={i}>{problem.line ? `Line ${problem.line}: ` : ''}{problem.message}</li>)}</ul></div>}
      {built?.warnings?.map((warning, i) => <p className="ws-notice" key={i}>{warning.message}</p>)}
      {provenanceTooLarge && <p className="ws-error" role="alert">These column mappings exceed the provenance limit. Use a smaller file with fewer columns.</p>}
      {built?.rows?.length > 0 && !built.errorCount && <div className="ws-table-wrap"><table className="ws-table" aria-label="Mapped QA/QC preview"><caption>First {Math.min(3, built.rows.length)} mapped rows</caption>
        <thead><tr><th>Source line</th><th>Identity</th><th>Values</th></tr></thead><tbody>{built.rows.slice(0, 3).map((row, i) => <tr key={i}><td>{built.lines[i]}</td><td>{kind === 'samples' ? `${row.sample_id} · ${row.sample_type} · ${row.lab_id} / ${row.lab_batch_id}` : `${row.crm_id} · ${row.revision}`}</td><td>{kind === 'samples' ? Object.keys(row.values).map(element => <div key={element}>{element}: {row.raw_values[element]} {row.units[element]}</div>) : `${row.element}: ${row.expected} ${row.unit}; SD ${row.sd}`}</td></tr>)}</tbody>
      </table></div>}
      {preview && <p role="status">{preview.new + preview.changed ? `Preview: ${countText(preview)}. Review before committing.` : 'Nothing to import: all of these records are already stored.'}</p>}
      <button type="submit" className="btn primary" disabled={busy || !built || built.errorCount > 0 || provenanceTooLarge || (preview && !(preview.new + preview.changed))}>{preview ? 'Commit QA/QC import' : 'Check QA/QC import'}</button>
      {preview && <button type="button" className="btn" disabled={busy} onClick={() => { setPreview(null); batch.current = null; setError(''); }}>Review again</button>}
    </form>}
  </section>;
}
