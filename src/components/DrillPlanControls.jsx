import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KINDS, CRS_OPTIONS, parseTable, guessKind, needsCrs, buildPlan, figureSections } from '../utils/drillPlanData.js';
import { holeColors, binsOf, releaseHoles, DEFAULT_BINS } from '../utils/drillPlanLegend.js';
import { padsOf, fitPlan, planLayout, mapView } from '../utils/drillPlan.js';
import { isApproved } from '../three-d/published-results.js';
import { supabase } from '../lib/supabase';

// The drill plan's settings (project.drillPlan), in the Annotate tab: the drill files it is built from, each
// hole's colour, the common pad, the assay bins, what shows, the results card, the interval tags' headings, the
// highlight card and the section line. Loaded when the Drill plan section is opened.

const SHOW = [['traces', 'Traces'], ['bars', 'Assay bars'], ['collars', 'Collars'], ['pills', 'Hole-ID pills at the toes'], ['tags', 'Interval tags'], ['padTag', 'Common pad tag'], ['card', 'Results card'], ['highlight', 'Highlight card']];
const key = (id) => String(id ?? '').trim().toLowerCase();
const fmtN = (n) => Number(n || 0).toLocaleString('en-US');

function Text({ id, label, value, placeholder, onChange }) {
  return (
    <div className="control-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function DrillPlanControls({ plan, onChange, onReplace, map, propertyId, zones, layout }) {
  const [tables, setTables] = useState([]);
  const [crs, setCrs] = useState(plan?.crs && plan.crs !== 'EPSG:4326' ? plan.crs : '');
  const [status, setStatus] = useState(null); // { type: 'error' | 'success', lines }
  const [busy, setBusy] = useState(false);
  const [recipes, setRecipes] = useState(null);
  const [recipeChoice, setRecipeChoice] = useState('');
  const [stagedSource, setStagedSource] = useState(null);
  const readEpoch = useRef({ value: 0 });
  const context = useRef({ propertyId, plan });
  context.current = { propertyId, plan };
  const [picking, setPicking] = useState(null);
  const [figures, setFigures] = useState(null); // the 3D figures to take a section from, once listed
  const [sections, setSections] = useState(null);
  const [fitWanted, setFitWanted] = useState(false); // frame the plan once a new one's legend has settled
  const [, setTick] = useState(0);

  useEffect(() => {
    const generation = readEpoch.current;
    generation.value++; setTables([]); setStagedSource(null); setRecipes(null); setRecipeChoice(''); setBusy(false); setStatus(null);
    return () => { generation.value++; };
  }, [propertyId]);
  useEffect(() => { readEpoch.current.value++; setBusy(false); }, [plan]);
  const operation = () => {
    const epoch = ++readEpoch.current.value, original = context.current;
    return () => epoch === readEpoch.current.value && original.propertyId === context.current.propertyId && original.plan === context.current.plan;
  };
  const cancelStaged = () => {
    readEpoch.current.value++; setTables([]); setStagedSource(null); setRecipes(null); setRecipeChoice(''); setBusy(false); setStatus(null);
  };

  // A new plan is framed once the panels have taken their new size (its legend rows arrive a moment later).
  useEffect(() => {
    if (!fitWanted || !plan || !map) return undefined;
    const t = setTimeout(() => { fitPlan(map, plan, zones, layout); setFitWanted(false); }, 450);
    return () => clearTimeout(t);
  }, [fitWanted, plan, map, zones, layout]);
  // What the panels hide moves with the map.
  useEffect(() => {
    if (!map) return undefined;
    const bump = () => setTick((t) => t + 1);
    map.on('moveend zoomend resize', bump);
    return () => map.off('moveend zoomend resize', bump);
  }, [map]);

  const addFiles = async (files) => {
    const current = operation(); setBusy(true);
    const read = await Promise.all([...files].map(async (f) => {
      try { const t = await parseTable(await f.text()); return { name: f.name, ...t, kind: guessKind(t.header, t.rows, f.name) }; } catch (e) { return { name: f.name, error: e.message }; }
    }));
    if (!current()) return;
    // Switching to uploads discards the staged property batch, not the saved plan.
    // Its recipe would no longer describe the newly supplied assays.
    setTables((prev) => [...(stagedSource ? [] : prev.filter((t) => !read.some((r) => r.name === t.name))), ...read.filter((r) => !r.error)]);
    setStagedSource(null); setRecipes(null); setBusy(false);
    const bad = read.filter((r) => r.error);
    setStatus(bad.length ? { type: 'error', lines: bad.map((r) => `${r.name}: ${r.error}`) } : null);
  };
  const fromProperty = async () => {
    const current = operation();
    setBusy(true); setStatus(null);
    try {
      const { listRecipes, selectRecipe } = await import('../utils/propertyResults.js');
      const found = await listRecipes(supabase, propertyId);
      if (!current()) return;
      setRecipes(found);
      let selected;
      try { selected = selectRecipe(found); } catch { selected = undefined; }
      setRecipeChoice(selected ? `r:${selected.name}` : selected === null ? 'raw' : '');
    } catch (e) {
      if (current()) { setRecipes([]); setRecipeChoice(''); setStatus({ type: 'error', lines: [`Could not read saved recipes (${e.message}). You can choose raw drill data only.`] }); }
    } finally { if (current()) setBusy(false); }
  };
  const loadProperty = async () => {
    if (!recipeChoice) return;
    const current = operation(); setBusy(true); setStatus(null);
    try {
      const { pullPropertyResults } = await import('../utils/propertyResults.js');
      const { files, ref } = await pullPropertyResults(supabase, { id: propertyId, name: null }, { recipeName: recipeChoice === 'raw' ? null : recipeChoice.slice(2) });
      if (!ref.holes) throw new Error('This property has no collars yet. Import them on the property page.');
      const read = await Promise.all(files.map(async (f) => { const t = await parseTable(f.text); return { name: f.name, ...t, kind: f.role === 'published' ? 'published' : guessKind(t.header, t.rows, f.name) }; }));
      if (!current()) return;
      setTables(read); setStagedSource(ref); setRecipes(null); setCrs(ref.crs && ref.crs !== 'EPSG:4326' ? ref.crs : '');
      setStatus({ type: 'success', lines: [ref.resultsRecipe ? `Loaded ${ref.resultsRecipe.name} v${ref.resultsRecipe.version}. Build the plan to use these calculated results.` : 'Raw drill data loaded. Build the plan to use it.'] });
    } catch (e) { if (current()) setStatus({ type: 'error', lines: [e.message] }); }
    finally { if (current()) setBusy(false); }
  };
  const build = async () => {
    const current = operation();
    setBusy(true);
    try {
      const { plan: next, notes, problems } = await buildPlan(tables, { crs: crs || null, prev: plan, drillSource: stagedSource });
      if (!current()) return;
      setBusy(false);
      onReplace(next);
      if (!plan) setFitWanted(true);
      const n = Object.values(next.assays.rows).reduce((s, l) => s + l.length, 0);
      setStatus({ type: 'success', lines: [`${next.holes.length} hole${next.holes.length === 1 ? '' : 's'}, ${fmtN(n)} assay intervals, ${next.results.filter(isApproved).length} ${stagedSource?.resultsRecipe ? 'calculated' : 'published'} results.`, ...notes, ...problems] });
      setTables([]); setStagedSource(null);
    } catch (e) { if (current()) setStatus({ type: 'error', lines: [e.message] }); }
    if (current()) setBusy(false);
  };

  // One click on the map (or two, for a section's ends): picks a place.
  const pick = (what) => {
    if (!map) return;
    setPicking(what);
    const pts = [];
    const onClick = (e) => {
      pts.push({ lat: +e.latlng.lat.toFixed(7), lng: +e.latlng.lng.toFixed(7) });
      if (what === 'star') onChange({ highlight: { ...(plan.highlight || {}), at: pts[0] } });
      else if (pts.length < 2) return;
      else onChange({ section: { name: 'A–A′', ...(plan.section || {}), a: pts[0], b: pts[1], from3d: null } });
      map.off('click', onClick); setPicking(null);
    };
    map.on('click', onClick);
  };
  const listFigures = async () => {
    setBusy(true);
    try {
      const { listMyFigures } = await import('../utils/figures.js');
      const own = await listMyFigures().catch(() => []);
      let shared = [];
      if (propertyId) { const { listPropertyFigures } = await import('../utils/workspace.js'); shared = await listPropertyFigures(propertyId).catch(() => []); }
      const all = [...shared.map((f) => ({ id: f.id, name: f.name })), ...own.map((f) => ({ id: f.id, name: f.name }))].filter((f, i, l) => l.findIndex((x) => x.id === f.id) === i);
      setFigures(all);
      if (!all.length) setStatus({ type: 'error', lines: ['No saved 3D figures to take a section from. Save the 3D figure to your account first.'] });
    } catch (e) { setStatus({ type: 'error', lines: [e.message] }); }
    setBusy(false);
  };
  const loadFigure = async (id) => {
    if (!id) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.from('three_d_projects').select('id, name, settings').eq('id', id).maybeSingle();
      if (error || !data) throw new Error('Could not open that 3D figure.');
      setSections({ figure: { id: data.id, name: data.name }, list: await figureSections(data.settings) });
    } catch (e) { setStatus({ type: 'error', lines: [e.message] }); }
    setBusy(false);
  };

  const colors = useMemo(() => holeColors(plan), [plan]);
  const pads = useMemo(() => padsOf(plan), [plan]);
  const tops = useMemo(() => {
    if (!plan) return [];
    const on = new Set(plan.holes.map((h) => key(h.id))), ids = new Set((plan.results || []).map((r) => r.resultId));
    return (plan.results || []).filter((r) => isApproved(r) && on.has(key(r.holeId)) && !(r.parentResultId && ids.has(r.parentResultId)));
  }, [plan]);

  const files = (
    <>
      <div className="button-row">
        <label className="btn" htmlFor="drill-plan-files">Add drill files…</label>
        <input id="drill-plan-files" type="file" multiple accept=".csv,.txt,.tsv" hidden disabled={busy} aria-label="Drill files: collars, surveys, assays, published results" onChange={(e) => { addFiles(e.target.files || []); e.target.value = ''; }} />
        {propertyId && supabase && <button className="secondary-btn" type="button" disabled={busy} onClick={fromProperty}>From the property's drill data</button>}
      </div>
      {recipes !== null && <div className="control-grid">
        <div className="control-row">
          <label htmlFor="dp-recipe">Property results</label>
          <select id="dp-recipe" value={recipeChoice} disabled={busy} onChange={(e) => setRecipeChoice(e.target.value)}>
            <option value="" disabled>Choose results…</option>
            <option value="raw">Raw drill data only</option>
            {recipes.map((r) => <option key={r.name} value={`r:${r.name}`}>{r.name} · v{r.version}</option>)}
          </select>
        </div>
        <p className="small-note">Loading replaces staged files. Your current plan stays unchanged until you build it. Recipe results are calculated from property data; they do not establish publication or QP approval.</p>
        <button type="button" className="btn primary" disabled={busy || !recipeChoice} onClick={loadProperty}>Load property data</button>
      </div>}
      {(recipes !== null || tables.length > 0 || busy) && <button type="button" className="link-btn" onClick={cancelStaged}>Cancel staged import</button>}
      {stagedSource && <p className="small-note">Property data is staged for this plan. Adding uploaded files replaces this staged import.</p>}
      {tables.length > 0 && (
        <div className="control-grid">
          {tables.map((t, i) => (
            <div className="control-row" key={t.name}>
              <label htmlFor={`dp-kind-${i}`}>{t.name} ({fmtN(t.rows.length)} rows)</label>
              <select id={`dp-kind-${i}`} value={t.kind} disabled={busy || !!stagedSource} onChange={(e) => setTables((prev) => prev.map((x) => (x === t ? { ...x, kind: e.target.value } : x)))}>
                {Object.entries(KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}
          {needsCrs(tables) && (
            <div className="control-row">
              <label htmlFor="dp-crs">Collar coordinates</label>
              <select id="dp-crs" value={crs} onChange={(e) => setCrs(e.target.value)}>
                <option value="">Choose the coordinate system…</option>
                {CRS_OPTIONS.filter((c) => c.code !== 'EPSG:4326').map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
              </select>
            </div>
          )}
          <button className="btn primary" type="button" disabled={busy || (needsCrs(tables) && !crs)} onClick={build}>{plan ? 'Rebuild the drill plan' : 'Build the drill plan'}</button>
        </div>
      )}
      {status && <div className="small-note" style={status.type === 'error' ? { color: '#b42318' } : undefined} role="status" data-testid="drill-plan-status">{status.lines.map((l) => <div key={l}>{l}</div>)}</div>}
    </>
  );
  if (!plan) {
    return (
      <div className="drill-plan-controls" data-testid="drill-plan-controls">
        <p className="small-note">Plan-projected drill traces with assay bars, hole-ID pills, interval tags and a results card, from collar, survey, assay and published-results tables (the files the 3D maker reads).</p>
        {files}
      </div>
    );
  }

  const size = map?.getSize?.();
  const hidden = size?.x ? planLayout(plan, mapView(map, size.x, size.y, zones, layout)).hidden : [];
  const show = { traces: true, bars: true, collars: true, pills: true, tags: true, padTag: true, card: false, ...(plan.show || {}) };
  const rel = releaseHoles(plan), bins = binsOf(plan), hl = plan.highlight, sec = plan.section;
  const setBins = (list) => onChange({ bins: list.map(({ min, color }) => ({ min, color })) });
  const n = Object.values(plan.assays?.rows || {}).reduce((s, l) => s + l.length, 0);

  return (
    <div className="drill-plan-controls" data-testid="drill-plan-controls">
      <div className="feature-chip">{plan.holes.length} holes · {fmtN(n)} assay intervals · {(plan.results || []).filter(isApproved).length} {plan.drillSource?.resultsRecipe ? 'calculated' : 'published'} results{plan.crs && plan.crs !== 'EPSG:4326' ? ` · ${plan.crs}` : ''}</div>
      {plan.drillSource?.resultsRecipe && <p className="small-note">Calculated with saved property recipe {plan.drillSource.resultsRecipe.name} v{plan.drillSource.resultsRecipe.version}. Reload property data and rebuild to use newer results.</p>}
      {files}
      <div className="button-row">
        <button type="button" className="secondary-btn" disabled={!map} onClick={() => fitPlan(map, plan, zones, layout)}>Fit to plan</button>
      </div>
      {hidden.length > 0 && (
        <div className="small-note" role="status" data-testid="drill-plan-hidden" style={{ color: '#b54708' }}>
          Hidden by a panel or the frame edge: {hidden.map((x) => x.what).join(', ')}. Press Fit to plan, or move the panel.
        </div>
      )}

      <h3 className="ins-sub-title">Show</h3>
      {SHOW.map(([k, l]) => (
        <label className="toggle-row" key={k}>
          <input type="checkbox" checked={show[k] !== false && (k !== 'highlight' || !!hl)} disabled={k === 'highlight' && !hl} onChange={(e) => onChange({ show: { ...show, [k]: e.target.checked } })} />
          <span>{l}</span>
        </label>
      ))}
      <label className="toggle-row">
        <input type="checkbox" checked={plan.legend !== false} onChange={(e) => onChange({ legend: e.target.checked })} />
        <span>Legend rows (holes, assay bins, section)</span>
      </label>

      <h3 className="ins-sub-title">Holes</h3>
      <div className="small-note">Holes in the release take the release colours (green, cyan, …); the others are white. Pick a colour to set one.</div>
      <div className="drill-plan-holes">
        {plan.holes.map((h) => (
          <div className="control-row inline-2" key={h.id}>
            <label htmlFor={`dp-color-${h.id}`}>{h.id}{Number.isFinite(h.dip) ? ` · ${Math.round(h.az)}°/${Math.round(h.dip)}°` : ''}{h.desurveyed ? ' · desurveyed' : ''}{rel.has(key(h.id)) ? ' · release' : ''}</label>
            <span>
              <input id={`dp-color-${h.id}`} type="color" value={colors.get(key(h.id))} onChange={(e) => onChange({ holes: plan.holes.map((x) => (x === h ? { ...x, color: e.target.value } : x)) })} />
              {h.color && <button type="button" className="link-btn" onClick={() => onChange({ holes: plan.holes.map((x) => (x === h ? { ...x, color: undefined } : x)) })}>Auto</button>}
            </span>
          </div>
        ))}
      </div>
      {pads.map((p) => (
        <div key={p.key} className="drill-plan-pad">
          <div className="small-note">{p.ids.join(' and ')} share a drill pad (collars within 5 m): one split-colour collar and a common-pad tag.</div>
          <label className="toggle-row">
            <input type="checkbox" checked={!!plan.fan?.[p.key]} onChange={(e) => onChange({ fan: { ...(plan.fan || {}), [p.key]: e.target.checked } })} />
            <span>Fan their traces apart (the tag says they are offset)</span>
          </label>
        </div>
      ))}

      {plan.assays?.elements?.length > 0 && (
        <>
          <h3 className="ins-sub-title">Assay bars</h3>
          <div className="control-row">
            <label htmlFor="dp-element">Element</label>
            <select id="dp-element" value={plan.element || ''} onChange={(e) => onChange({ element: e.target.value })}>
              {plan.assays.elements.map((el) => <option key={el.name} value={el.name}>{el.name}{el.unit ? ` (${el.unit})` : ''}</option>)}
            </select>
          </div>
          {bins.map((b, i) => (
            <div className="control-row inline-2" key={i}>
              <label htmlFor={`dp-bin-${i}`}>From {b.label}</label>
              <span>
                <input id={`dp-bin-${i}`} type="number" step="any" value={b.min} onChange={(e) => setBins(bins.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} style={{ width: 80 }} />
                <input type="color" aria-label={`Colour from ${b.min}`} value={b.color} onChange={(e) => setBins(bins.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
                {bins.length > 1 && <button type="button" className="link-btn" onClick={() => setBins(bins.filter((_, j) => j !== i))}>Remove</button>}
              </span>
            </div>
          ))}
          <div className="button-row">
            <button type="button" className="secondary-btn" onClick={() => setBins([...bins, { min: (bins.at(-1)?.min || 1) * 3, color: '#7048e8' }])}>Add a bin</button>
            <button type="button" className="secondary-btn" onClick={() => setBins(DEFAULT_BINS)}>Default bins</button>
          </div>
        </>
      )}

      <h3 className="ins-sub-title">Results card and tags</h3>
      <Text id="dp-title" label="Card title" value={plan.release?.title} placeholder="e.g. Blue Sky · Holes 077 & 078" onChange={(v) => onChange({ release: { ...(plan.release || {}), title: v } })} />
      <Text id="dp-date" label="Release date" value={plan.release?.date} placeholder={(plan.results || []).find((r) => r.releaseDate)?.releaseDate || 'e.g. 15 Oct 2026'} onChange={(v) => onChange({ release: { ...(plan.release || {}), date: v || undefined } })} />
      <label className="toggle-row">
        <input type="checkbox" checked={plan.release?.isNew !== false} onChange={(e) => onChange({ release: { ...(plan.release || {}), isNew: e.target.checked } })} />
        <span>"NEW" pill on the card</span>
      </label>
      {tops.map((r) => (
        <Text key={r.resultId} id={`dp-head-${r.resultId}`} label={`${r.holeId} ${r.fromM}–${r.toM} m heading`} value={plan.headings?.[r.resultId] ?? r.domain ?? ''} placeholder="e.g. Upper Blue Sky" onChange={(v) => onChange({ headings: { ...(plan.headings || {}), [r.resultId]: v } })} />
      ))}
      {!tops.length && <div className="small-note">Tags and the card come from a published-results table (Result ID, Hole ID, From, To, Approved text, and a Domain column for the headings).</div>}
      <button type="button" className="secondary-btn" disabled={!Object.keys(plan.pos || {}).length} onClick={() => onChange({ pos: {} })}>Re-place tags and cards</button>

      <h3 className="ins-sub-title">Highlight card</h3>
      <label className="toggle-row">
        <input type="checkbox" checked={!!hl} onChange={(e) => onChange({ highlight: e.target.checked ? { at: { lng: plan.holes[0].lng, lat: plan.holes[0].lat }, heading: 'Discovery', sub: '', main: '', second: '' } : null })} />
        <span>A star and card for a discovery (drag the star on the map)</span>
      </label>
      {hl && (
        <>
          <Text id="dp-hl-head" label="Heading" value={hl.heading} placeholder="e.g. Blue Sky Discovery" onChange={(v) => onChange({ highlight: { ...hl, heading: v } })} />
          <Text id="dp-hl-sub" label="Subline" value={hl.sub} placeholder="e.g. Hole 055 · Discovery hole" onChange={(v) => onChange({ highlight: { ...hl, sub: v } })} />
          <Text id="dp-hl-main" label="Main result" value={hl.main} placeholder="e.g. 198.75 m @ 0.69 g/t Au" onChange={(v) => onChange({ highlight: { ...hl, main: v } })} />
          <Text id="dp-hl-second" label="Second line" value={hl.second} placeholder="e.g. followed by 31.5 m @ 4.15 g/t Au" onChange={(v) => onChange({ highlight: { ...hl, second: v } })} />
          <div className="control-row">
            <label htmlFor="dp-hl-at">Star at</label>
            <select id="dp-hl-at" value="" onChange={(e) => { const h = plan.holes.find((x) => x.id === e.target.value); if (h) onChange({ highlight: { ...hl, at: { lng: h.lng, lat: h.lat } } }); }}>
              <option value="">Move to a collar…</option>
              {plan.holes.map((h) => <option key={h.id} value={h.id}>{h.id}</option>)}
            </select>
          </div>
          <button type="button" className="secondary-btn" disabled={!map || !!picking} onClick={() => pick('star')}>{picking === 'star' ? 'Click the map…' : 'Place the star on the map'}</button>
        </>
      )}

      <h3 className="ins-sub-title">Section line</h3>
      {sec ? (
        <>
          <Text id="dp-sec-name" label="Name" value={sec.name} placeholder="A–A′" onChange={(v) => onChange({ section: { ...sec, name: v } })} />
          <Text id="dp-sec-label" label="Label along the line" value={sec.label} placeholder={`SECTION ${sec.name || 'A–A′'}`} onChange={(v) => onChange({ section: { ...sec, label: v } })} />
          {sec.from3d && <div className="small-note">Same ends as {sec.from3d.name} in the 3D figure “{sec.from3d.figure}”.</div>}
          <button type="button" className="link-btn" onClick={() => onChange({ section: null })}>Remove the section line</button>
        </>
      ) : <div className="small-note">Draw A–A′ on the map, or take it from a saved 3D figure so both show the same line.</div>}
      <div className="button-row">
        <button type="button" className="secondary-btn" disabled={!map || !!picking} onClick={() => pick('section')}>{picking === 'section' ? 'Click A, then A′…' : 'Draw on the map'}</button>
        {supabase && <button type="button" className="secondary-btn" disabled={busy} onClick={listFigures}>From a 3D figure…</button>}
      </div>
      {figures?.length > 0 && (
        <div className="control-row">
          <label htmlFor="dp-figure">3D figure</label>
          <select id="dp-figure" defaultValue="" onChange={(e) => loadFigure(e.target.value)}>
            <option value="">Choose…</option>
            {figures.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      )}
      {sections && (
        <div className="control-grid">
          {!sections.list.length && <div className="small-note">That figure has no section.</div>}
          {sections.list.map((x) => (
            <button key={x.id} type="button" className="secondary-btn" disabled={!x.ends}
              title={x.ends ? '' : 'A line through the block centre has no fixed ends: fit it to holes in 3D first.'}
              onClick={() => onChange({ section: { name: x.name, ...x.ends, from3d: { figure: sections.figure.name, figureId: sections.figure.id, id: x.id, name: x.name, grid: x.grid } } })}>
              Use {x.name}{x.ends ? '' : ' (no fixed ends)'}
            </button>
          ))}
        </div>
      )}

      <div className="button-row" style={{ marginTop: 12 }}>
        <button type="button" className="link-btn" onClick={() => { onReplace(null); setStatus(null); }}>Remove the drill plan</button>
      </div>
    </div>
  );
}
