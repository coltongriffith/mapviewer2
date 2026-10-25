import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { releasePackDb, UNAVAILABLE } from '../../utils/releasePackDb';
import { drillDb } from '../../utils/drillDb';
import { drillResultsDb, MAX_ASSAYS } from '../../utils/drillResultsDb';
import { listPropertyMaps, listPropertyFigures, formatWhen } from '../../utils/workspace';
import { lazyGuarded } from '../../utils/preloadGuard';
import { packStatus, approvalRequest, canAddKind, ITEM_KINDS, itemKindLabel } from '../../../shared/releasePack.js';
import { computeResults } from '../../../shared/drillResults.js';
import { ErrorNote } from './shared';

const PackageExport = lazyGuarded(() => import('../PackageExport'));

// /workspace/.../p/<slug>?tab=release: the property's release pack. Its items in order (the results table of a saved
// recipe, the drill plan map, 3D figures, the location map), whether its last approval still matches the data, a
// draft regenerated from the current data, and Approve, which records what was used. Nothing is published: maps and
// figures stay as they are, and a published 3D figure version never changes.

const slug = (t) => String(t || 'property').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'property';
const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

export default function ReleasePackPanel({ property, perms, onOpenMap }) {
  const db = useMemo(() => (supabase ? releasePackDb(supabase) : null), []);
  const [data, setData] = useState(null);
  const [items, setItems] = useState(null); // the items being edited (null: as saved)
  const [add, setAdd] = useState({ kind: 'results_table', ref: '' });
  const [outputs, setOutputs] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      if (!db) throw new Error('Release packs are not available on this site right now.');
      const [{ pack, approvals }, maps, figs, summary, recipeList] = await Promise.all([
        db.load(property.id), listPropertyMaps(property.id), listPropertyFigures(property.id),
        drillDb(supabase).summary(property.id).catch(() => ({ batches: [] })), drillResultsDb(supabase).recipes(property.id).catch(() => []),
      ]);
      const versions = await db.latestVersions(figs.map((f) => f.id));
      const figures = {};
      maps.forEach((m) => { figures[m.id] = { name: m.name, revision: m.revision, savedAt: m.updatedAt, map: m }; });
      figs.forEach((f) => { figures[f.id] = { name: f.name, savedAt: f.updatedAt, ...versions[f.id] }; });
      const recipes = Object.fromEntries((recipeList || []).map((r) => [r.name, { id: r.id, version: r.version, recipe: r.recipe }]));
      const used = new Set(approvals[0]?.batch_ids || []);
      const added = (summary.batches || []).filter((b) => !b.rolled_back_at && !used.has(b.id)).slice(0, 10);
      const [holes, approvedBatches] = await Promise.all([
        Promise.all(added.map(async (b) => [b.id, await db.holes(b).catch(() => [])])).then(Object.fromEntries),
        // Every batch the approval used, by id: the summary lists only the latest 50.
        approvals[0] ? db.batchStatus(approvals[0].batch_ids || []).catch(() => null) : null,
      ]);
      setData({ pack, approvals, maps, figs, figures, recipes, batches: summary.batches || [], approvedBatches, holes });
      // New data, pack or approval: earlier draft outputs no longer describe it.
      setOutputs(null);
      setUnavailable(false);
    } catch (e) {
      if (e.code === 'UNAVAILABLE') setUnavailable(true); else setError(e.message);
      setData((d) => d || { pack: null, approvals: [], maps: [], figs: [], figures: {}, recipes: {}, batches: [], holes: {} });
    }
  }, [db, property.id]);
  useEffect(() => { load(); }, [load]);

  if (unavailable) return <p className="ws-notice">{UNAVAILABLE}</p>;
  if (!data) return <p className="dash-muted">Loading the release pack…</p>;
  const saved = data.pack?.items || [];
  const list = items || saved;
  const dirty = !!items && JSON.stringify(items) !== JSON.stringify(saved);
  const approval = data.approvals[0] || null;
  const status = packStatus({ pack: data.pack ? { ...data.pack, items: saved } : null, approval, batches: data.batches, approvedBatches: data.approvedBatches, holes: data.holes, figures: data.figures, recipes: data.recipes });
  const blocked = status.items.some((i) => i.state === 'missing');
  const nameOf = (it) => (it.kind === 'results_table' ? `Results table · recipe "${it.ref}"` : data.figures[it.ref]?.name || 'Missing item');
  const choices = add.kind === 'results_table' ? Object.keys(data.recipes).map((n) => ({ id: n, name: n }))
    : add.kind === 'figure_3d' ? data.figs : data.maps;
  const run = async (key, fn) => {
    setBusy(key); setError(null); setNote(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const move = (i, d) => { const l = [...list]; [l[i], l[i + d]] = [l[i + d], l[i]]; setItems(l); };
  const approvedFigure = (id) => approval?.figures?.find((f) => f.id === id);
  const base = slug(property.name);

  // The draft outputs, from the current data through the results tab's own exports. Maps are drawn by the package export.
  const regenerate = async () => {
    const files = {}, summary = [];
    const it = saved.find((x) => x.kind === 'results_table'), r = it && data.recipes[it.ref];
    if (r) {
      const a = await drillResultsDb(supabase).assays(property.id);
      const out = computeResults(a.rows, r.recipe);
      const options = { propertyName: property.name, recipeName: it.ref, recipeVersion: r.version, unsaved: false,
        warnings: a.capped ? [`Incomplete assay load: only the first ${MAX_ASSAYS.toLocaleString('en-US')} assays are included.`] : [] };
      const [{ resultsTableXlsx }, { resultsTablePages }] = await Promise.all([import('../../utils/drillResultsXlsx.js'), import('../../utils/drillResultsPages.js')]);
      files[`${base}-results.xlsx`] = await bytes(await resultsTableXlsx(out, r.recipe, options));
      files[`${base}-results.pdf`] = await bytes((await resultsTablePages(out, r.recipe, options, 'pdf')).blob);
      summary.push(`Results table: ${out.results.length} intercept${out.results.length === 1 ? '' : 's'} in ${new Set(out.results.map((x) => x.holeId)).size} holes (recipe "${it.ref}" v${r.version})`);
    }
    const maps = saved.filter((x) => x.kind === 'drill_plan' || x.kind === 'location_map').filter((x) => data.figures[x.ref]);
    // Missing items are named, never silently left out.
    const missing = saved.map((x, i) => ({ ...x, name: nameOf(x), why: status.items[i]?.notes.join('; ') })).filter((_, i) => status.items[i]?.state === 'missing');
    missing.forEach((x) => summary.push(`Missing, not in the download: ${x.name} (${x.why})`));
    if (maps.length) summary.push(`${maps.map((x) => data.figures[x.ref].name).join(', ')}: drawn from the saved map${maps.length === 1 ? '' : 's'} when you download the pack`);
    const record = { property: property.name, generated_at: new Date().toISOString(), status: status.label, changes: status.changes,
      items: saved.map((x, i) => ({ ...x, name: nameOf(x), state: status.items[i]?.state || 'ok' })), missing: missing.map(({ kind, ref, why }) => ({ kind, ref, why })), approval: approval && { id: approval.id, approved_at: approval.approved_at, approved_by: approval.approved_by_email,
        batch_ids: approval.batch_ids, recipe: approval.recipe, figures: approval.figures } };
    files['release-pack.json'] = new TextEncoder().encode(JSON.stringify(record, null, 2));
    const o = { files, summary, maps, draft: status.state !== 'up_to_date' };
    setOutputs(o);
    return o;
  };

  return (
    <section aria-label="Release pack" className="ws-stack">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      <div className="dash-panel" role="status" aria-label="Release pack status">
        <p style={{ margin: 0 }}><b>{status.label}</b></p>
        {status.state === 'draft' && approval && status.changes.length > 0 && (
          <ul aria-label="Changes since approval" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{status.changes.map((c) => <li key={c}>{c}</li>)}</ul>
        )}
        {approval && <p className="dash-muted" style={{ margin: '6px 0 0' }}>Last approved {formatWhen(approval.approved_at)}{approval.approved_by_email ? ` by ${approval.approved_by_email}` : ''}: {approval.batch_ids.length} drill import{approval.batch_ids.length === 1 ? '' : 's'}{approval.recipe ? `, recipe "${approval.recipe.name}" v${approval.recipe.version}` : ''}{approval.figures.filter((f) => f.version).map((f) => `, ${f.name} v${f.version}`).join('')}{approval.note ? ` · ${approval.note}` : ''}</p>}
      </div>

      <div className="dash-panel">
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Items</h3>
        {list.length === 0 ? <p className="dash-muted">No items yet. {perms.edit ? 'Add the results table, the drill plan map, 3D figures and the location map, in figure order.' : 'An editor sets up the pack.'}</p> : (
          <div className="ws-table-wrap">
            <table className="ws-table" aria-label="Pack items">
              <thead><tr><th>Fig</th><th>Item</th><th>Kind</th><th>Status</th><th><span className="dash-sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.map((it, i) => {
                  const st = !dirty && status.items[i], f = data.figures[it.ref], v = it.kind === 'figure_3d' && approvedFigure(it.ref);
                  return (
                    <tr key={`${it.kind}:${it.ref}`}>
                      <td>{i + 1}</td>
                      <td>{nameOf(it)}</td>
                      <td>{itemKindLabel(it.kind)}</td>
                      <td>{!st ? <small className="dash-muted">Not saved</small> : st.notes.length ? st.notes.join('; ') : approval ? 'As approved' : 'Not approved yet'}</td>
                      <td>
                        <div className="ws-row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                          {f?.map && onOpenMap && <button type="button" className="dash-link" onClick={() => onOpenMap(f.map)}>Open</button>}
                          {it.kind === 'figure_3d' && f && <a className="dash-link" href={`/3d?project=${encodeURIComponent(it.ref)}`}>Open in 3D</a>}
                          {v?.version && <a className="dash-link" href={`/3d?project=${encodeURIComponent(it.ref)}&version=${v.version}`}>Approved v{v.version}</a>}
                          {perms.edit && <>
                            <button type="button" className="dash-link" aria-label={`Move ${nameOf(it)} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                            <button type="button" className="dash-link" aria-label={`Move ${nameOf(it)} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
                            <button type="button" className="dash-link" aria-label={`Remove ${nameOf(it)}`} onClick={() => setItems(list.filter((_, j) => j !== i))}>Remove</button>
                          </>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {perms.edit && (
          <div className="ws-row" style={{ marginTop: 10 }}>
            <label className="ws-field">Add
              <select value={add.kind} onChange={(e) => setAdd({ kind: e.target.value, ref: '' })}>{ITEM_KINDS.map((k) => <option key={k.value} value={k.value} disabled={!canAddKind(list, k.value)}>{k.label}{canAddKind(list, k.value) ? '' : ' (one per pack)'}</option>)}</select>
            </label>
            <label className="ws-field">{add.kind === 'results_table' ? 'Recipe' : add.kind === 'figure_3d' ? '3D figure' : 'Map'}
              <select value={add.ref} onChange={(e) => setAdd({ ...add, ref: e.target.value })}>
                <option value="">{choices.length ? 'Choose…' : add.kind === 'results_table' ? 'Save a recipe in Drill data first' : 'None in this property'}</option>
                {choices.filter((c) => !list.some((x) => x.kind === add.kind && x.ref === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button type="button" className="btn" disabled={!add.ref || list.length >= 12 || !canAddKind(list, add.kind)} onClick={() => { setItems([...list, { kind: add.kind, ref: add.ref }]); setAdd({ ...add, ref: '' }); }}>Add item</button>
            <button type="button" className="btn primary" disabled={!dirty || !!busy} onClick={() => run('save', async () => {
              const p = await db.save(property.id, data.pack, items);
              setItems(null); setNote('Saved the pack.'); setData((d) => ({ ...d, pack: p })); await load();
            })}>{busy === 'save' ? 'Saving…' : 'Save pack'}</button>
            {dirty && <button type="button" className="btn" onClick={() => setItems(null)}>Discard changes</button>}
          </div>
        )}
      </div>

      {note && <p className="ws-ok" role="status">{note}</p>}
      {saved.length > 0 && (
        <div className="dash-panel ws-stack">
          <div className="ws-row">
            <button type="button" className="btn" disabled={!!busy} onClick={() => run('regen', async () => { await regenerate(); setNote('Regenerated the draft from the current data.'); })}>{busy === 'regen' ? 'Regenerating…' : 'Regenerate draft'}</button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => run('pkg', async () => { setPkg(await regenerate()); })}>{busy === 'pkg' ? 'Preparing…' : 'Download pack'}</button>
            {perms.edit && (
              <button type="button" className="btn primary" disabled={!!busy || dirty || blocked || status.state === 'up_to_date'}
                title={blocked ? 'Fix the items marked above first' : dirty ? 'Save the pack first' : undefined}
                onClick={() => window.confirm('Approve this release pack? It records the drill imports, recipe version, map revisions and 3D figure versions in use now. Nothing is published or changed.')
                  && run('approve', async () => {
                    await db.approve(approvalRequest({ pack: data.pack, batches: data.batches, figures: data.figures, recipes: data.recipes }));
                    setNote('Approved. This approval records what the pack used; later imports mark it as a draft again.');
                  }).then(load)}>{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
            )}
          </div>
          {outputs && <ul aria-label="Draft outputs" className="dash-muted" style={{ margin: 0, paddingLeft: 18 }}>{outputs.summary.map((t) => <li key={t}>{t}</li>)}</ul>}
          {saved.some((x) => x.kind === 'figure_3d') && <small className="dash-muted">3D figures are not drawn here: open each one (its approved version once approved), download its PNG and add it in the package dialog.</small>}
        </div>
      )}

      {data.approvals.length > 0 && (
        <div className="dash-panel">
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Approvals</h3>
          <ul className="ws-list" aria-label="Approval history">
            {data.approvals.map((a) => (
              <li key={a.id}><span className="ws-list-main"><b>{formatWhen(a.approved_at)}</b><small>{a.approved_by_email || '—'} · {a.batch_ids.length} imports{a.recipe ? ` · recipe v${a.recipe.version}` : ''}{a.note ? ` · ${a.note}` : ''}</small></span></li>
            ))}
          </ul>
        </div>
      )}

      {pkg && (
        <Suspense fallback={null}>
          <PackageExport projects={pkg.maps.map((x) => ({ id: x.ref, name: data.figures[x.ref].name }))} onClose={() => setPkg(null)}
            preset={{ picked: pkg.maps.map((x) => x.ref), extra: pkg.files, meta: { project: property.name }, draft: pkg.draft }} />
        </Suspense>
      )}
    </section>
  );
}
