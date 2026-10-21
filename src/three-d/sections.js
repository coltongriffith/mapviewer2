// Named sections and fences for Exploration Maps 3D: EM3D.addSection, updateSection, removeSection and
// setActiveSection, the section tabs in the Layout step, each section exported on its own, and a section shown as
// a thin painted slab (a fence) in the block. Loaded by studio.js the first time a figure has named sections
// (S.sections; shared/sectionGeometry.js has the data). The active section (S.secActive) lives in the single
// section's fields that studio.js draws from (secAz, secW, section) and is copied back here, so a figure
// without S.sections is drawn exactly as before.
import * as THREE from 'three';
import { secFrame, toSection, clipSlab, clipPath, lerp, lineThrough } from './section-geometry.js';
import { nextId, nameOf, letters, geomOf, legacyOf, fromLegacy, cleanSections, clipToBox, lookingWord, FENCE_OPACITY } from '../../shared/sectionGeometry.js';

let H, S;
export function init(host) { H = host; S = host.S; }

const act = () => S.sections?.find((x) => x.id === S.secActive);
const find = (id) => { const e = S.sections?.find((x) => x.id === id); if (!e) throw new Error(`No section "${id}". Sections: ${(S.sections || [{ id: 'A' }]).map((x) => x.id).join(', ')}.`); return e; };
// The active section from the single section's fields; an entry into them.
function keep() {
  const e = act(); if (!e) return;
  const { id, name, fence, opacity } = e; Object.keys(e).forEach((k) => delete e[k]); Object.assign(e, { id, name, ...geomOf(S), fence, opacity });
}
const put = (e) => Object.assign(S, legacyOf(e), { secActive: e.id });
// fn run with section id as the active one, then the active one put back (synchronous: nothing draws between).
export function using(id, fn) {
  if (!S.sections && id === 'A') return fn(); // the figure's only section
  keep(); const was = S.secActive; put(find(id));
  try { return fn(); } finally { keep(); put(find(was)); }
}
// The figure's one section becomes A–A′ (fence off) the first time a second is added or a section is set.
function begin() {
  if (!H.G) throw new Error('Load data first.');
  if (!S.sections) Object.assign(S, { sections: [fromLegacy(S)], secActive: 'A' });
  keep();
}
// A change that throws leaves the sections as they were.
async function tx(fn) {
  const was = structuredClone({ sections: S.sections, secActive: S.secActive, secAz: S.secAz, secW: S.secW, section: S.section });
  try { return await fn(); } catch (e) { Object.assign(S, was); H.sectionChanged(); throw e; }
}
const GEOM = ['az', 'origin', 'through', 'width', 'holes', 'fit'];
async function apply(id, o) {
  if (!o || typeof o !== 'object') throw new Error('Give the section\'s settings as an object, e.g. { name: "B–B′", through: ["EX-014", "EX-021"], fence: true }.');
  const e = find(id);
  if (o.name !== undefined) { const n = String(o.name ?? '').trim(); if (!n) throw new Error('name must be text, e.g. "B–B′" or "Line 1000N".'); e.name = n.slice(0, 40); }
  if (o.fence !== undefined) e.fence = !!o.fence;
  if (o.opacity !== undefined) { const v = +o.opacity; if (!Number.isFinite(v)) throw new Error('opacity must be 0.05-1, the fence\'s tint.'); e.opacity = Math.max(0.05, Math.min(1, v)); }
  if (GEOM.some((k) => o[k] !== undefined)) {
    // The line and holes as EM3D.setSection takes them (section.js checks them); through: fitted to these holes and
    // run across the block, every hole within the width drawn unless holes are given.
    const sec = await H.load('section'), { through, ...x } = o;
    if (through !== undefined && (!Array.isArray(through) || !through.length)) throw new Error('through must be a list of hole IDs to fit the line through.');
    using(id, () => {
      if (!through) return sec.set(x);
      sec.set({ width: x.width, holes: through, fit: true });
      const { a, b } = S.section, L = lineThrough({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, S.secAz, H.G.diag), c = clipToBox(...L, H.G.B), k = (c[1] - c[0]) * 0.04;
      [S.section.a, S.section.b] = [c[0] + k, c[1] - k].map((f) => ({ x: Math.round((L[0].x + (L[1].x - L[0].x) * f) * 10) / 10, y: Math.round((L[0].y + (L[1].y - L[0].y) * f) * 10) / 10 }));
      sec.set({ holes: x.holes ?? null, fit: false });
    });
  }
  H.sectionChanged(); H.renderExtUI();
}
export const add = (o = {}) => tx(async () => {
  begin(); const id = nextId(S.sections); if (!id) throw new Error('A figure has up to 26 sections.');
  // A new section starts across the active one, through the block centre, with its fence on.
  S.sections.push({ id, name: nameOf(id), az: (S.secAz + 90) % 180, width: S.secW, fence: true, opacity: FENCE_OPACITY });
  put(find(id)); await apply(id, o); return id;
});
export const update = (id, o = {}) => tx(() => { begin(); return apply(id, o); });
export function remove(id) {
  if (!S.sections) throw new Error('The figure has one section, A–A′, which stays.');
  keep(); find(id); if (S.sections.length < 2) throw new Error('A figure keeps at least one section.');
  S.sections = S.sections.filter((x) => x.id !== id); if (S.secActive === id) put(S.sections[0]);
  H.sectionChanged(); H.renderExtUI();
}
export function setActive(id) { begin(); put(find(id)); H.sectionChanged(); H.renderExtUI(); }

// For studio.js: the end letters, the section figure's heading, the state.
export const tags = () => (act() ? letters(act()) : null);
export function header(head, lookAz, w, chosen) {
  const e = act(); if (!e) return null;
  return [`${head} · SECTION ${e.name.toUpperCase()}`, `Looking ${lookingWord(lookAz)} (${H.pad3(lookAz)}°) · ${chosen ? `${chosen.length} chosen hole${chosen.length === 1 ? '' : 's'} projected` : `±${w} m slice`} · ${S.valueLabel}`];
}
const r1 = (p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
export function state() {
  if (!S.sections) return null; keep();
  return { active: S.secActive, list: S.sections.map((e) => {
    const ends = H.G ? using(e.id, H.sectionEnds).map(r1) : null;
    return { ...structuredClone(e), letters: letters(e), ends, origin: ends && r1({ x: (ends[0].x + ends[1].x) / 2, y: (ends[0].y + ends[1].y) / 2 }) };
  }) };
}

// ---- Fences: each section with fence on, a vertical slab along its line from the terrain to the block's base,
// tinted, outlined in the brand colour and painted with the intervals within its width in the grade colours.
let meshes = [], key = '', ends = new Map();
function drop() { meshes.forEach((m) => { m.parent?.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }); meshes = []; ends = new Map(); }
export function sync() {
  if (S.sections) { S.sections = cleanSections(S.sections); if (S.sections && !act()) put(S.sections[0]); }
  keep();
  const G = H.G, on = G && S.sections ? S.sections.filter((e) => e.fence) : [];
  const k = JSON.stringify([on, S.secActive, S.bins, S.valueCol, S.displayCutoff, S.vex, S.primary, S.terrain]);
  const v = document.getElementById('view-section'); if (v) v.textContent = `Section ${act()?.name || 'A–A′'}`; // the view tab
  if (k === key && meshes.every((m) => m.parent === H.root)) return;
  key = k; drop(); on.forEach(build);
}
function build(e) {
  const G = H.G, [A0, B0] = using(e.id, H.sectionEnds), c = clipToBox(A0, B0, G.B); if (!c) return;
  const at = (s) => ({ x: A0.x + (B0.x - A0.x) * s, y: A0.y + (B0.y - A0.y) * s }), A = at(c[0]), B = at(c[1]), F = secFrame(A, B), L = F.L, z0 = G.B.z0, z1 = G.zmax;
  ends.set(e.id, [A, B]);
  const cw = 1024, ch = Math.max(64, Math.min(1024, Math.round(cw * (z1 - z0) * S.vex / L))), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d'), X = (t) => t / L * cw, Y = (z) => (z1 - z) / (z1 - z0) * ch, u = cw / 1024;
  const top = Array.from({ length: 129 }, (_, i) => { const t = i / 128 * L; return [X(t), Y(G.surf(A.x + F.d.x * t, A.y + F.d.y * t))]; });
  ctx.beginPath(); ctx.moveTo(0, ch); top.forEach((p) => ctx.lineTo(...p)); ctx.lineTo(cw, ch); ctx.closePath();
  ctx.fillStyle = H.pri(); ctx.globalAlpha = 0.6 * (e.opacity ?? FENCE_OPACITY); ctx.fill(); ctx.globalAlpha = 1; ctx.save(); ctx.clip();
  ctx.strokeStyle = H.pri(); ctx.lineWidth = 8 * u; ctx.stroke(); ctx.restore();
  // Within the width (cut at the slab's edges), or the chosen holes projected whole, as on the section figure.
  const pick = e.holes, holes = pick ? H.project.holes.filter((h) => pick.includes(h.id)) : H.project.holes, P = (p) => [X(toSection(F, p).t), Y(p.z)];
  const line = (pts, w, col) => { ctx.beginPath(); pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](...P(p))); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke(); };
  ctx.lineCap = 'butt';
  holes.forEach((h) => {
    (pick ? [h.path] : clipPath(F, h.path, e.width)).forEach((run) => line(run, 2 * u, 'rgba(44,61,66,0.55)'));
    h.ints.forEach((it) => {
      const bi = H.intervalShown(it) ? H.binIndex(it.vals[S.valueCol]) : -1; if (bi < 1) return;
      let a = h.posAt(it.from), b = h.posAt(it.to);
      if (!pick) { const s = clipSlab(F, a, b, e.width); if (!s) return; [a, b] = [lerp(a, b, s[0]), lerp(a, b, s[1])]; }
      line([a, b], 9 * u, H.BIN_COLORS[bi]);
    });
  });
  const p = [[A, z1], [B, z1], [A, z0], [B, z0]].map(([q, z]) => G.V(q.x, q.y, z)), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => [v.x, v.y, v.z]), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2)); geo.setIndex([0, 2, 1, 2, 3, 1]);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = H.renderer.capabilities.getMaxAnisotropy();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 3.5; m.userData.fence = e.id; H.root.add(m); meshes.push(m);
}
// Each other fence's line on the terrain, solid (the active section's is dashed).
export function paint(ctx, P, lk) {
  if (!H.G || !S.sections) return;
  S.sections.forEach((e) => {
    if (!e.fence || e.id === S.secActive) return; const [A, B] = using(e.id, H.sectionEnds), c = clipToBox(A, B, H.G.B); if (!c) return;
    const at = (f) => P({ x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f });
    ctx.beginPath(); ctx.moveTo(...at(c[0])); ctx.lineTo(...at(c[1])); ctx.lineWidth = 5 * lk; ctx.strokeStyle = S.terrain === 'dark' ? '#fff' : S.primary; ctx.stroke();
    ctx.lineWidth = 1.6 * lk; ctx.strokeStyle = S.terrain === 'dark' ? S.primary : '#fff'; ctx.stroke();
  });
}
// The letters at both ends of each fence other than the active section's (studio.js marks that one).
export function draw(ctx, K, occ) {
  const G = H.G; if (!G || !S.sections) return; const { u } = K;
  S.sections.forEach((e) => {
    const q = e.id !== S.secActive && ends.get(e.id); if (!q) return;
    letters(e).forEach((t, i) => {
      const [x, y, z] = H.proj(G.V(q[i].x, q[i].y, G.surf(q[i].x, q[i].y) + G.diag * 0.035)); if (z > 1) return;
      H.tagLabel(ctx, K, t, x, y); occ.push([x - 22 * u, y - 14 * u, x + 22 * u, y + 14 * u]);
    });
  });
}

// ---- The tabs in the Layout step: one per section, the active one's name and fence, and Remove.
export function renderUI(el) {
  if (!el) return; const list = S.sections || [], e = act(), esc = H.esc, k = JSON.stringify([list.map((x) => [x.id, x.name, x.fence]), S.secActive]);
  if (el.dataset.key === k) return; el.dataset.key = k;
  el.innerHTML = !e ? '' : `<div class="chips" role="group" aria-label="Sections">${list.map((x) => `<button type="button" class="chip" data-sid="${esc(x.id)}" aria-pressed="${x.id === e.id}">${esc(x.name)}</button>`).join('')}</div>
    <div class="grid2" style="margin-top:8px"><label class="field"><span>Name</span><input type="text" data-sname maxlength="40" value="${esc(e.name)}"></label>
    <label class="check" style="align-self:end;padding-bottom:6px"><input type="checkbox" data-sfence${e.fence ? ' checked' : ''}>Fence in the 3D block</label></div>
    ${list.length > 1 ? `<button class="btn" type="button" data-sdel style="margin:6px 0 10px">Remove ${esc(e.name)}</button>` : ''}`;
  const run = (p) => Promise.resolve().then(p).then(() => H.api.layersReady()).catch((x) => H.status(x.message));
  el.querySelectorAll('[data-sid]').forEach((b) => b.addEventListener('click', () => run(() => setActive(b.dataset.sid))));
  el.querySelector('[data-sname]')?.addEventListener('change', (ev) => run(() => update(e.id, { name: ev.target.value })));
  el.querySelector('[data-sfence]')?.addEventListener('change', (ev) => run(() => update(e.id, { fence: ev.target.checked })));
  el.querySelector('[data-sdel]')?.addEventListener('click', () => run(() => remove(e.id)));
}
