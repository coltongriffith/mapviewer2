// Holes in the section for Exploration Maps 3D: EM3D.setSection and the "Chosen holes" list in the section
// panel, loaded the first time the section has chosen holes or a line of its own. S.section is
// { holes: [ids], a, b }: the chosen holes and the line's ends (studio.js sectionEnds, drawSection).
import { lineThrough } from './section-geometry.js';
import { fitSection } from './section-fit.js';
export { offText } from './section-fit.js'; // the section's labels (studio.js drawSection)
import { isClick } from './layout.js';

let H, down = null;
const r1 = (p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
export function init(host) {
  H = host;
  // A click on a collar in the 3D view, in the Layout step, adds or removes the hole while holes are chosen.
  const frame = document.getElementById('frame'); if (!frame) return;
  frame.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY, performance.now()]; }, true);
  frame.addEventListener('click', (e) => {
    const S = H.S, G = H.G; if (!S.section?.holes || S.view !== '3d' || !G || H.step() !== 'layout' || !down || !isClick(e.clientX - down[0], e.clientY - down[1], performance.now() - down[2])) return;
    const r = frame.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 12;
    H.project.holes.forEach((h) => { const p = h.path[0], [px, py, pz] = H.proj(G.V(p.x, p.y, p.z)), d = Math.hypot(px - x, py - y); if (pz < 1 && d < bd) { bd = d; best = h; } });
    if (!best) return;
    const on = S.section.holes.includes(best.id);
    set({ holes: on ? S.section.holes.filter((id) => id !== best.id) : [...S.section.holes, best.id] });
    H.status(`${best.id} ${on ? 'taken out of' : 'added to'} the section (${S.section.holes.length} hole${S.section.holes.length === 1 ? '' : 's'}).`);
  });
}

// Key holes first: those with a callout, then new or pending holes, then the rest in file order.
function ordered() {
  const S = H.S, co = H.shownCallouts().map((c) => c.h), rank = (h) => (co.includes(h) ? co.indexOf(h) : S.tags.status[h.id] === 'new' || H.isPending(h) ? 50 : 100);
  return H.project.holes.map((h, i) => [h, rank(h), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([h]) => h);
}
// The holes to start with: the key holes near the current line, else the callout holes.
function starting() {
  const S = H.S, [A, B] = H.sectionEnds(), L = Math.hypot(B.x - A.x, B.y - A.y) || 1, off = (p) => Math.abs(((p.x - A.x) * (A.y - B.y) + (p.y - A.y) * (B.x - A.x)) / L);
  const key = ordered().slice(0, 12), near = key.filter((h) => h.path.some((p) => off(p) <= S.secW));
  return (near.length > 1 ? near : key).slice(0, 6).map((h) => h.id);
}
// The line through the chosen holes: fitted through each hole's middle, past the ends of their traces, and
// at least about as long as the holes are deep, so steep holes close together do not make a sliver.
function fit(ids) {
  const S = H.S, hs = H.project.holes.filter((h) => ids.includes(h.id)), pts = hs.flatMap((h) => h.path.filter((p, i) => i % 5 === 0)), zs = pts.map((p) => p.z);
  const f = fitSection(hs.map((h) => h.posAt(h.len / 2)), pts, S.secAz, Math.max(60, S.secW, 0.45 * (Math.max(...zs) - Math.min(...zs))));
  if (!f) return false;
  S.secAz = f.az; [S.section.a, S.section.b] = f.ends.map(r1); return true;
}

export function set(o = {}) {
  const S = H.S, G = H.G; if (!G) throw new Error('Load data first.');
  const known = H.project.holes.map((h) => h.id), prev = [S.section, S.secAz, S.secW]; S.section = { ...S.section };
  try {
    let holes = o.holes;
    if (holes === 'auto') holes = starting();
    if (holes === null) delete S.section.holes;
    else if (holes !== undefined) {
      if (!Array.isArray(holes)) throw new Error('holes must be a list of hole IDs, "auto" (the key holes near the line) or null (every hole within the width).');
      const bad = holes.filter((id) => !known.includes(id)); if (bad.length) throw new Error(`No hole ${bad.map((b) => `"${b}"`).join(', ')}.`);
      S.section.holes = [...new Set(holes)];
    }
    if (o.width !== undefined) { const v = +o.width; if (!Number.isFinite(v)) throw new Error('width must be metres either side of the line.'); S.secW = Math.max(5, Math.min(5000, v)); }
    if (o.az !== undefined) { const v = +o.az; if (!Number.isFinite(v)) throw new Error('az must be the line\'s azimuth in degrees.'); S.secAz = ((Math.round(v) % 180) + 180) % 180; }
    const s = S.section, [A0, B0] = H.sectionEnds(), half = Math.hypot(B0.x - A0.x, B0.y - A0.y) / 2; // the line's length, or the centre line's
    if (o.origin === null) { delete s.a; delete s.b; } else if (o.origin !== undefined) {
      if (!o.origin || !Number.isFinite(+o.origin.x) || !Number.isFinite(+o.origin.y)) throw new Error('origin must be {x, y}: a point on the line, in the files\' easting and northing, or null for the block centre.');
      [s.a, s.b] = lineThrough({ x: +o.origin.x, y: +o.origin.y }, S.secAz, half).map(r1);
    } else if (o.az !== undefined && s.a) [s.a, s.b] = lineThrough({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, S.secAz, half).map(r1);
    // Fitted by default when holes are chosen without a line of their own.
    const doFit = o.fit ?? (Array.isArray(holes) && o.az === undefined && o.origin === undefined);
    if (doFit && !(s.holes?.length && fit(s.holes)) && o.fit) throw new Error('Choose holes first: fit needs one or more.');
    if (!Object.keys(s).length) S.section = null;
  } catch (e) { [S.section, S.secAz, S.secW] = prev; throw e; }
  H.sectionChanged();
}

// The panel: a compact list (a filter past 12 holes), Fit and the centre line.
let query = '';
export function renderUI(el) {
  const S = H.S, s = S.section, holes = H.project?.holes || [];
  if (!s || !holes.length) { el.innerHTML = ''; delete el.dataset.key; return; }
  const list = s.holes ? ordered() : [], key = `${!!s.holes}|${!!s.a}|${list.map((h) => h.id).join(',')}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key; const co = new Set(H.shownCallouts().map((c) => c.h.id));
    el.innerHTML = (s.holes ? `${list.length > 12 ? '<input type="text" data-sq placeholder="Filter holes" aria-label="Filter holes" style="margin:6px 0 4px">' : ''}
      <div class="prov-list" style="max-height:168px;overflow:auto">${list.map((h) => `<label class="check"${co.has(h.id) ? ' style="font-weight:700"' : ''}><input type="checkbox" value="${H.esc(h.id)}">${H.esc(h.id)}</label>`).join('')}</div>` : '')
      + `<div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap">${s.holes ? '<button class="btn" type="button" data-sfit>Fit line to chosen holes</button>' : ''}${s.a ? '<button class="btn" type="button" data-scentre>Line through the block centre</button>' : ''}</div>`
      + (s.holes ? '<p class="muted" style="margin-top:6px">Only these holes are drawn, projected onto the section. The line refits as you tick; the azimuth turns it. Click a collar on the 3D view to add or remove one. Bold: callout holes.</p>' : '');
    el.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
      const cur = H.S.section?.holes || []; run({ holes: cb.checked ? [...cur, cb.value] : cur.filter((id) => id !== cb.value) });
    }));
    const q = el.querySelector('[data-sq]'), filter = () => el.querySelectorAll('.prov-list label').forEach((l) => { l.hidden = !!query && !l.textContent.toLowerCase().includes(query); });
    if (q) { q.value = query; q.addEventListener('input', () => { query = q.value.trim().toLowerCase(); filter(); }); filter(); }
    el.querySelector('[data-sfit]')?.addEventListener('click', () => run({ fit: true }));
    el.querySelector('[data-scentre]')?.addEventListener('click', () => run({ origin: null }));
  }
  const on = new Set(s.holes || []); el.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = on.has(cb.value); });
}
const run = (o) => { try { set(o); } catch (e) { H.status(e.message); } };
