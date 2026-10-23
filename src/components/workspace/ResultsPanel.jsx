import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { drillResultsDb, storedElements, MAX_ASSAYS } from '../../utils/drillResultsDb';
import { computeResults, defaultRecipe, checkRecipe, notes, resultsText, tableRows, toTsv, toCsv, toPublishedFile, UNITS, BDL_RULES } from '../../../shared/drillResults.js';
import { priceUnit, defaultUnit, METAL_DEFAULTS } from '../../../shared/metalEq.js';
import { formatWhen } from '../../utils/workspace';
import { resultsTableDocument } from '../../../shared/drillResultsHtml.js';
import { ErrorNote } from './shared';

// The property's results: the recipe (metal equivalent, cut-offs, dilution, rounding; editors change it,
// members read it), the intercepts it gives from the current assays, as a news-release table, and the same
// results for a 3D figure's published callouts. Loaded when the section is opened.

const numOr = (v) => (v === '' ? '' : Number.isFinite(+v) ? +v : v);
const slug = (t) => String(t || 'property').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'property';
function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Num({ label, value, onChange, step = 'any', placeholder }) {
  return (
    <label className="ws-field">{label}
      <input type="number" inputMode="decimal" min="0" step={step} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(numOr(e.target.value))} />
    </label>
  );
}

function RecipeForm({ r, set, stored, edit }) {
  const els = r.elements;
  const setEl = (i, patch) => set({ elements: els.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const free = stored.elements.filter((e) => !els.some((x) => x.name === e));
  const allDp = r.gradeDecimals?.['*'];
  return (
    <fieldset disabled={!edit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="ws-stack">
      <div className="ws-table-wrap">
        <table className="ws-table" aria-label="Recipe elements">
          <thead><tr><th>Element</th><th>Unit</th><th>Price (US$)</th><th>Recovery (%)</th>{edit && <th><span className="dash-sr-only">Remove</span></th>}</tr></thead>
          <tbody>
            {els.map((e, i) => (
              <tr key={e.name}>
                <td>{e.name}</td>
                <td><span className="ws-field"><select aria-label={`Unit for ${e.name}`} style={{ width: 64 }} value={e.unit} onChange={(ev) => setEl(i, { unit: ev.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></span></td>
                <td style={{ whiteSpace: 'nowrap' }}><span className="ws-field" style={{ display: 'inline-grid' }}><input aria-label={`Price for ${e.name} (US$/${priceUnit(e.name)})`} type="number" min="0" step="any" value={e.price ?? ''} style={{ width: 76 }} onChange={(ev) => setEl(i, { price: numOr(ev.target.value) })} /></span> <small className="dash-muted">/{priceUnit(e.name)}</small></td>
                <td><span className="ws-field"><input aria-label={`Recovery for ${e.name}`} type="number" min="0" max="100" step="any" value={e.recovery ?? ''} style={{ width: 60 }} onChange={(ev) => setEl(i, { recovery: numOr(ev.target.value) })} /></span></td>
                {edit && <td><button type="button" className="dash-link" aria-label={`Remove ${e.name}`} disabled={els.length < 2} onClick={() => set({ elements: els.filter((_, j) => j !== i), ...(e.name === r.primary ? { primary: els.find((x) => x !== e).name } : {}) })}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ws-form-grid">
        {edit && free.length > 0 && (
          <label className="ws-field">Add an element
            <select value="" onChange={(e) => { const n = e.target.value; if (n) set({ elements: [...els, { name: n, unit: stored.units[n] || defaultUnit(n), price: METAL_DEFAULTS[n] ?? null, recovery: 100 }] }); }}>
              <option value="">Choose…</option>
              {free.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        )}
        <label className="ws-field">Primary element
          <select value={r.primary} onChange={(e) => set({ primary: e.target.value })}>{els.map((e) => <option key={e.name}>{e.name}</option>)}</select>
        </label>
        <label className="ws-field" style={{ alignContent: 'end' }}>
          <span><input type="checkbox" checked={!!r.equivalent} disabled={!edit || els.length < 2} onChange={(e) => set({ equivalent: e.target.checked })} /> Metal equivalent ({r.primary}Eq)</span>
        </label>
        <Num label="Cut-off" value={r.cutoff} onChange={(v) => set({ cutoff: v })} />
        <Num label="Minimum length (m)" value={r.minLength} onChange={(v) => set({ minLength: v })} />
        <Num label="Internal dilution up to (m)" value={r.maxDilution} onChange={(v) => set({ maxDilution: v })} />
        <Num label={'"incl." cut-off'} value={r.inclCutoff} placeholder="none" onChange={(v) => set({ inclCutoff: v === '' ? null : v })} />
        <Num label={'"incl." minimum length (m)'} value={r.inclMinLength} onChange={(v) => set({ inclMinLength: v })} />
        <Num label={'"incl." dilution up to (m)'} value={r.inclMaxDilution} onChange={(v) => set({ inclMaxDilution: v })} />
        <label className="ws-field">Below detection
          <select value={r.bdl || 'stored'} onChange={(e) => set({ bdl: e.target.value })}>{BDL_RULES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select>
        </label>
        <label className="ws-field">Length decimals
          <select value={r.lengthDecimals ?? 1} onChange={(e) => set({ lengthDecimals: +e.target.value })}>{[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <label className="ws-field">Grade decimals
          <select value={allDp ?? ''} onChange={(e) => set({ gradeDecimals: e.target.value === '' ? {} : { '*': +e.target.value } })}>
            <option value="">As 3D figures write them</option>
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <label className="ws-field">True-width note
        <textarea value={r.trueWidth || ''} maxLength={1000} placeholder="True widths are estimated at 70–90% of the reported core lengths." onChange={(e) => set({ trueWidth: e.target.value })} />
      </label>
    </fieldset>
  );
}

export default function ResultsPanel({ property, perms, revision = 0 }) {
  const db = useMemo(() => (supabase ? drillResultsDb(supabase) : null), []);
  const [data, setData] = useState(null); // { rows, capped, stored, saved: [] }
  const [name, setName] = useState('Default');
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tableFormat, setTableFormat] = useState('csv');

  // keepDraft: an import or roll-back reloads the assays and recipes, keeping the recipe being edited.
  const load = async (keep, keepDraft) => {
    try {
      if (!db) throw new Error('Drill results are not available on this site right now.');
      const [a, saved] = await Promise.all([db.assays(property.id), db.recipes(property.id)]);
      setData({ ...a, stored: storedElements(a.rows), saved: saved || [] });
      const pick = (saved || []).find((x) => x.name === keep) || saved?.[0];
      if (keepDraft && draft) return; // the recipe being edited, and its name, stay
      setName(pick?.name || 'Default'); setDraft(null);
    } catch (e) { setError(e.message); setData((d) => d || { rows: [], stored: { elements: [], units: {} }, saved: [] }); }
  };
  useEffect(() => { load(name, true); }, [property.id, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = data?.saved.find((x) => x.name === name) || null;
  const recipe = draft || current?.recipe || (data ? defaultRecipe(data.stored.elements, data.stored.units) : null);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(current?.recipe);
  const out = useMemo(() => (data && recipe ? computeResults(data.rows, recipe) : null), [data, recipe]);
  if (!data) return <p className="dash-muted">Loading the assays…</p>;
  if (!data.rows.length) return <p className="dash-muted">Results are calculated from the assays. Import assays above to see them.</p>;
  if (!current && !perms.edit) return <p className="dash-muted">No results recipe has been saved for this property yet. An editor sets the metal equivalent and cut-offs here.</p>;

  const set = (patch) => { setNote(null); setDraft({ ...recipe, ...patch }); };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await db.save(property.id, name.trim(), recipe, current ? current.version : 0);
      setNote(r.unchanged ? 'No changes to save.' : `Saved ${r.name}, version ${r.version}.`);
      await load(r.name);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); setNote(`Copied the ${what}.`); } catch { setError('Copying was blocked by the browser. Download the CSV instead.'); }
  };
  const results = out?.results || [];
  const holes = new Set(results.map((x) => x.holeId)).size;
  const rows = out ? tableRows(results, out.columns) : [];
  const base = slug(property.name);
  const source = current && `Property results: ${current.name} v${current.version}`;
  const recipeProblems = checkRecipe(recipe);
  const formattedTable = () => resultsTableDocument(out, recipe, {
    propertyName: property.name, recipeName: name, recipeVersion: current?.version, unsaved: !current || dirty,
    warnings: data.capped ? [`Incomplete assay load: only the first ${MAX_ASSAYS.toLocaleString('en-US')} assays are included.`] : [],
  });
  const copyFormattedTable = async () => {
    setError(null);
    try {
      const file = formattedTable();
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([file.html], { type: 'text/html' }),
        'text/plain': new Blob([file.text], { type: 'text/plain' }),
      })]);
      setNote('Copied the formatted table and recipe notes.');
    } catch {
      setNote(null);
      setError('Copying a formatted table was blocked or is not supported by this browser. Download HTML instead.');
    }
  };
  return (
    <div className="ws-stack" aria-label="Results recipe and table" role="group">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      <div className="ws-row">
        {data.saved.length > 1 && (
          <label className="ws-field">Recipe
            <select value={name} onChange={(e) => { setName(e.target.value); setDraft(null); }}>{data.saved.map((x) => <option key={x.name}>{x.name}</option>)}</select>
          </label>
        )}
        <span className="dash-muted">{current ? `${current.name}, version ${current.version} · saved ${formatWhen(current.created_at)}${current.created_by_email ? ` by ${current.created_by_email}` : ''}` : 'Not saved yet: a first recipe from the elements in the assays.'}{dirty ? ' · unsaved changes' : ''}</span>
      </div>
      <RecipeForm r={recipe} set={set} stored={data.stored} edit={perms.edit} />
      {recipeProblems.length > 0 && <ul className="ws-notice" aria-label="Recipe problems" style={{ paddingLeft: 26 }}>{recipeProblems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {perms.edit && (
        <div className="ws-row">
          <span className="ws-field"><input aria-label="Recipe name" value={name} maxLength={80} style={{ width: 150 }} onChange={(e) => { setName(e.target.value); setDraft(recipe); }} /></span>
          <button type="button" className="btn primary" disabled={busy || recipeProblems.length > 0 || !name.trim() || (!dirty && !!current)} onClick={save}>{busy ? 'Saving…' : 'Save recipe'}</button>
          {dirty && <button type="button" className="btn" onClick={() => { setDraft(null); setName(current?.name || name); }}>Discard changes</button>}
        </div>
      )}
      {note && <p className="ws-ok" role="status">{note}</p>}
      {out?.eq && <p style={{ margin: 0 }}><b>{out.eq.formula}</b></p>}
      {out?.problems.filter((p) => !recipeProblems.includes(p)).map((p) => <p key={p} className="ws-notice" style={{ margin: 0 }}>{p}</p>)}
      <p className="dash-muted" style={{ margin: 0 }}>
        {results.length} intercept{results.length === 1 ? '' : 's'} in {holes} of {new Set(data.rows.map((x) => x.hole_id)).size} holes with assays{data.capped ? ` (the first ${MAX_ASSAYS.toLocaleString('en-US')} assays only)` : ''}.
      </p>
      {results.length > 0 && (
        <div className="ws-table-wrap">
          <table className="ws-table" aria-label="Drill results">
            <thead><tr>{['Hole ID', 'From (m)', 'To (m)', 'Length (m)', ...out.columns.map((c) => `${c.key} (${c.unit})`)].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.slice(1).map((c, i) => (
                <tr key={i}>
                  <td>{c[1] ? <span style={{ paddingLeft: 12 }}>incl.</span> : c[0]}</td>
                  {c.slice(2, -1).map((v, j) => <td key={j} style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {results.length > 0 && (
        <div className="ws-row">
          <button type="button" className="btn" onClick={() => copy(resultsText(results, recipe), 'results as text')}>Copy as text</button>
          <label className="ws-field">Table format
            <select value={tableFormat} onChange={(e) => setTableFormat(e.target.value)}>
              <option value="csv">Spreadsheet (CSV / TSV)</option>
              <option value="html">Formatted table (HTML)</option>
            </select>
          </label>
          <button type="button" className="btn" onClick={() => tableFormat === 'html' ? copyFormattedTable() : copy(toTsv(rows), 'table')}>{tableFormat === 'html' ? 'Copy formatted table' : 'Copy table (TSV)'}</button>
          <button type="button" className="btn" onClick={() => tableFormat === 'html'
            ? download(`${base}-results.html`, formattedTable().html, 'text/html')
            : download(`${base}-results.csv`, toCsv(rows))}>{tableFormat === 'html' ? 'Download HTML' : 'Download CSV'}</button>
          <button type="button" className="btn" disabled={!current || dirty} title={!current || dirty ? 'Save the recipe first' : undefined}
            onClick={() => { const f = toPublishedFile(results, out.columns, source, `${base}-published-results.csv`); download(f.name, f.text); }}>Download for 3D figures</button>
        </div>
      )}
      {results.length > 0 && <small className="dash-muted">For a 3D figure: add the 3D file, mark it "Published results" and choose published callouts; it draws these intervals with this wording.</small>}
      <ul className="dash-muted" aria-label="Results notes" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
        {(recipeProblems.length ? [] : notes(recipe, out?.eq ?? null)).map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}
