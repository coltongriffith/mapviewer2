// Exploration Maps 3D: undo, redo and a short history of the figure's settings. Loaded by studio.js on the
// first settings change. Entries are plain snapshots of S (settings only: no files, no logo image), taken
// debounced after changes; the 50 most recent are kept.

// Equal snapshots compare equal however long their embedded images are.
const keyOf = (snap) => JSON.stringify(snap, (k, v) => (typeof v === 'string' && v.length > 2000 ? `#${v.length}:${v.slice(-48)}` : v));
const NAMES = { valueCol: 'Grade column', valueCol2: 'Second grade', valueLabel: 'Grade label', bins: 'Colour limits', displayCutoff: 'Display cut-off', coCount: 'Callouts', coCut: 'Callout cut-off',
  coIncl: '"incl." cut-off', coMin: 'Callout length', coOverrides: 'Callouts', pubOverrides: 'Callouts', calloutMode: 'Callouts from', coPlacement: 'Callout placement', secAz: 'Section line', secW: 'Section width', surf: 'Surface opacity', vex: 'Vertical exaggeration',
  terrain: 'Terrain', terrainSource: 'Surface', blockStyle: 'Block sides', blockMargin: 'Block margin', blockExtent: 'Block extent', ids: 'Hole IDs', walls: 'Block sides', inset: 'Inset', ribbons: 'Intercept bars',
  traceWidth: 'Trace thickness', lockView: 'Lock view', labels: 'Text labels', wallLabels: 'Labels on the block', geology: 'Geology', geophys: 'Geophysics', tags: 'Hole tags', shell: 'Grade shell', eq: 'Metal equivalent',
  meshes: 'Model shapes', legend: 'Legend', imagery: 'Imagery', designOptIn: 'Design updates', format: 'Figure size', primary: 'Brand colour', accent: 'Accent colour', crs: 'Coordinate system', provisional: 'Provisional holes', view: 'View' };
const human = (k) => NAMES[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
// What changed between two snapshots, in words: "Geology: opacity, strength · Terrain".
export function describe(a, b) {
  const out = [];
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a?.[k], y = b?.[k]; if (keyOf(x) === keyOf(y)) continue;
    const sub = x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !['coOverrides', 'pubOverrides', 'meshes', 'provisional'].includes(k) ? Object.keys({ ...x, ...y }).filter((s) => keyOf(x[s]) !== keyOf(y[s])) : [];
    out.push(sub.length && sub.length <= 3 ? `${human(k)}: ${sub.map((s) => human(s).toLowerCase()).join(', ')}` : human(k));
  }
  return out.slice(0, 3).join(' · ') + (out.length > 3 ? ' …' : '') || 'Settings';
}
// The history itself: a list of states and the one shown. note() adds a state after the shown one (dropping
// any redo states), unless it equals it; a state noted while muted (a restore settling) replaces it.
export function createHistory(base, limit = 50, now = () => Date.now()) {
  const H = { states: [{ snap: base, key: keyOf(base), at: now(), label: 'Opened' }], at: 0, mute: false };
  H.note = (snap) => {
    const key = keyOf(snap), cur = H.states[H.at];
    if (key === cur.key) { H.mute = false; return false; }
    if (H.mute) { H.mute = false; Object.assign(cur, { snap, key }); return false; }
    H.states.splice(H.at + 1); H.states.push({ snap, key, at: now(), label: describe(cur.snap, snap) });
    if (H.states.length > limit) H.states.splice(0, H.states.length - limit);
    H.at = H.states.length - 1; return true;
  };
  H.go = (i) => { if (i < 0 || i >= H.states.length || i === H.at) return null; H.at = i; H.mute = true; return H.states[i].snap; };
  H.undo = () => H.go(H.at - 1);
  H.redo = () => H.go(H.at + 1);
  return H;
}

// ---------- page ----------
let P = null; // { hist, apply(snap), el }
export function init({ base, apply, el }) { P = { hist: createHistory(base), apply, el }; render(); return api; }
const step = (snap) => { if (snap) { P.apply(snap); render(); } return !!snap; };
const api = {
  note: (snap) => { if (P.hist.note(snap)) render(); },
  undo: () => step(P.hist.undo()), redo: () => step(P.hist.redo()), go: (i) => step(P.hist.go(i)),
  state: () => ({ entries: P.hist.states.map((s) => ({ label: s.label, at: new Date(s.at).toISOString() })), current: P.hist.at }),
  render,
};
const time = (t) => { try { return new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(t)); } catch { return ''; } };
function render() {
  const { el, hist } = P; if (!el || el.hidden) return;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.innerHTML = `<div class="row" style="justify-content:space-between"><h3 style="margin:0">History</h3><span class="row"><button class="btn" type="button" data-h="undo" ${hist.at ? '' : 'disabled'}>Undo</button><button class="btn" type="button" data-h="redo" ${hist.at < hist.states.length - 1 ? '' : 'disabled'}>Redo</button></span></div>
    <ol>${hist.states.map((s, i) => [s, i]).reverse().map(([s, i]) => `<li ${i === hist.at ? 'aria-current="true"' : ''}><span title="${esc(s.label)}">${esc(s.label)}<br><small>${time(s.at)}</small></span>${i === hist.at ? '<small>shown</small>' : `<button class="btn" type="button" data-hi="${i}">Restore</button>`}</li>`).join('')}</ol>
    <p class="muted">Settings only; files are not part of the history. Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z redoes.</p>`;
  el.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => api[b.dataset.h]()));
  el.querySelectorAll('[data-hi]').forEach((b) => b.addEventListener('click', () => api.go(+b.dataset.hi)));
}
