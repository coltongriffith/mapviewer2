import React, { Suspense, useState } from 'react';
import { zipSync } from 'fflate';
import Dialog from './Dialog';
import { useAuth } from '../hooks/useAuth.jsx';
import { loadCloudProject } from '../utils/cloudStorage';
import { canExportFormat } from '../utils/entitlements';
import { downloadBlob } from '../utils/svg';
import { lazyGuarded } from '../utils/preloadGuard';
import { figureFileName, packageFileName, todayStamp } from '../utils/packageNames.js';

const ReadOnlyMapStage = lazyGuarded(() => import('./ReadOnlyMapStage'));

// The dashboard's package export (Tower v3 item 40): several saved maps, plus figures exported elsewhere (a /3d
// PNG), become one ZIP holding a PDF with a page per figure and each figure as a PNG, named
// Client_Project_Date_FigN_Name_vX.png. A lazy chunk, loaded when "Export a package…" is pressed.
//
// Each map is drawn by the read-only stage (the share page's), off screen, under the same plan rules as a
// download there: the plan's pixel cap and corner credit. The watermark band and the draft mark over the map follow
// the editor's default (on for the free plan and sample maps) until ticked or unticked here; an added PNG goes in
// as it came. The PDF needs a plan with PDF export; on
// other plans the ZIP holds the PNGs.

const isSample = (payload) => (payload?.layers || []).some((l) => l.dataSource === 'demo');
const canvasBytes = (c) => new Promise((resolve, reject) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('The PNG could not be encoded.'))), 'image/png'));
async function fileCanvas(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
  return c;
}

export default function PackageExport({ projects, onClose }) {
  const { entitlements } = useAuth();
  const [picked, setPicked] = useState([]); // ids, in figure order
  const [names, setNames] = useState({});
  const [files, setFiles] = useState([]); // extra PNG figures (from /3d)
  const [meta, setMeta] = useState({ client: '', project: '', date: todayStamp(), version: '1' });
  const [band, setBand] = useState(null); // null: each map's default
  const [draft, setDraft] = useState(null); // the draft mark across each map; null: each map's default
  const [stage, setStage] = useState(null); // the map being drawn off screen
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const pdfOk = canExportFormat(entitlements, 'pdf');
  const free = !entitlements?.clean_export;
  const nameOf = (p) => names[p.id] ?? p.name;
  const toggle = (id) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const field = (k, label, extra = {}) => (
    <label className="auth-label" htmlFor={`pkg-${k}`}>
      {label}
      <input id={`pkg-${k}`} className="auth-input" value={meta[k]} disabled={busy} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} {...extra} />
    </label>
  );

  // One saved map drawn by the read-only stage, as a canvas.
  const draw = (project, extra) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The map took too long to draw.')), 90000);
    const done = (fn) => (v) => { clearTimeout(timer); setStage(null); fn(v); };
    // The stage hands its exporter over again as its legend settles (a drill plan's rows load lazily): draw once,
    // with the last one, when none has come for 0.6 s.
    let wait = null;
    setStage({ key: `${Date.now()}`, project, onReady: (h) => { clearTimeout(wait); wait = setTimeout(() => h.renderCanvas(entitlements, extra).then(done(resolve), done(reject)), 600); } });
  });

  const build = async () => {
    setBusy(true); setError(null);
    try {
      const figs = [];
      const maps = picked.map((id) => projects.find((p) => p.id === id)).filter(Boolean);
      for (const [i, p] of maps.entries()) {
        setStatus(`Drawing ${i + 1} of ${maps.length + files.length}: ${nameOf(p)}…`);
        const { payload } = await loadCloudProject(p.id);
        const dflt = free || isSample(payload), on = band ?? dflt;
        const canvas = await draw(payload, { ...(on && { watermarkBand: { client: meta.client || payload.layout?.companyName } }), ...((draft ?? dflt) && { draftOverlay: true }) });
        figs.push({ name: nameOf(p), canvas, bytes: await canvasBytes(canvas) });
      }
      for (const f of files) figs.push({ name: f.name.replace(/\.png$/i, ''), canvas: await fileCanvas(f), bytes: new Uint8Array(await f.arrayBuffer()) });
      setStatus('Writing the package…');
      const out = {};
      figs.forEach((f, i) => { out[figureFileName(meta, i + 1, f.name)] = [f.bytes, { level: 0 }]; });
      if (pdfOk) {
        const [{ jsPDF }, { PDF_SIZES, pdfPage, onWhite }] = await Promise.all([import('jspdf'), import('../export/exportPDF')]);
        const size = PDF_SIZES.letter_landscape, pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [size.w, size.h] });
        // On white for the PDF only (its pages are JPEG); the PNGs above keep their transparency.
        figs.forEach((f, i) => { if (i) pdf.addPage([size.w, size.h], 'landscape'); pdfPage(pdf, onWhite(f.canvas), size); });
        out[packageFileName(meta, 'pdf')] = new Uint8Array(pdf.output('arraybuffer'));
      }
      const zipName = packageFileName(meta, 'zip');
      downloadBlob(zipName, new Blob([zipSync(out)], { type: 'application/zip' }));
      setStatus(`Downloaded ${zipName}: ${Object.keys(out).length} files.`);
    } catch (e) {
      setError(`The package could not be made: ${String(e?.message || e).slice(0, 160)}`);
      setStatus('');
    } finally {
      setStage(null); setBusy(false);
    }
  };

  const count = picked.length + files.length;
  return (
    <>
      <Dialog onClose={busy ? undefined : onClose} title="Export a package" titleId="pkg-title" panelClassName="modal-panel auth-modal pkg-dialog">
        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); if (count) build(); }}>
          <p className="dash-muted" style={{ margin: 0 }}>
            Tick the maps in figure order. You get one ZIP: {pdfOk ? 'a PDF with a page per figure, and ' : ''}each figure as a PNG named Client_Project_Date_FigN_Name_vX.png.
          </p>
          <fieldset className="pkg-maps" disabled={busy}>
            <legend>Figures</legend>
            {projects.map((p) => {
              const n = picked.indexOf(p.id) + 1;
              return (
                <div key={p.id} className="pkg-row">
                  <label><input type="checkbox" checked={n > 0} onChange={() => toggle(p.id)} /> {n > 0 ? <b>Fig {n}</b> : null} {p.name}</label>
                  {n > 0 && <input className="auth-input" aria-label={`Figure name for ${p.name}`} value={nameOf(p)} onChange={(e) => setNames({ ...names, [p.id]: e.target.value })} />}
                </div>
              );
            })}
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="pkg-row">
                <span><b>Fig {picked.length + i + 1}</b> {f.name}</span>
                <button type="button" className="dash-icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>✕</button>
              </div>
            ))}
            <label className="dash-link pkg-add">
              + Add exported figures (PNG, e.g. from the 3D maker)
              <input type="file" accept="image/png" multiple hidden onChange={(e) => { setFiles([...files, ...e.target.files]); e.target.value = ''; }} />
            </label>
          </fieldset>
          <div className="pkg-meta">
            {field('client', 'Client')}
            {field('project', 'Project')}
            {field('date', 'Date')}
            {field('version', 'Version')}
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={band ?? free} disabled={busy} onChange={(e) => setBand(e.target.checked)} />
            <span>Watermark band under each map (draft for review){band === null && !free ? '; on for sample maps' : ''}</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={draft ?? free} disabled={busy} onChange={(e) => setDraft(e.target.checked)} />
            <span>Draft watermark over each map{draft === null && !free ? '; on for sample maps' : ''}</span>
          </label>
          {!pdfOk && <p className="dash-muted" style={{ margin: 0 }}>The package PDF is a Pro feature: on your plan the ZIP holds the PNGs.</p>}
          {status && <p className="dash-muted" role="status" style={{ margin: 0 }}>{status}</p>}
          {error && <p className="auth-error-msg" role="alert" style={{ margin: 0 }}>{error}</p>}
          <div className="dash-hero-actions">
            <button className="btn primary" type="submit" disabled={busy || !count}>{busy ? 'Making the package…' : `Download package (${count} figure${count === 1 ? '' : 's'})`}</button>
            <button className="btn" type="button" disabled={busy} onClick={onClose}>Close</button>
          </div>
        </form>
      </Dialog>
      {stage && (
        <div className="pkg-stage" aria-hidden="true">
          <Suspense fallback={null}><ReadOnlyMapStage key={stage.key} project={stage.project} onExportReady={stage.onReady} nearbyClaims /></Suspense>
        </div>
      )}
    </>
  );
}
