// Exploration Maps 3D: the drill crew. A toy drill rig (skid, mast, drill head, rod rack, doghouse and generator)
// with three crew in hard hats, standing on a levelled pad at the drill collar. Off by default (S.crew.on); loaded by
// studio.js for a figure that turns it on, or on EM3D.setCrew. Procedural geometry only, in the brand orange and ink
// with cream accents, lambert-lit with flat faces like an icon.
//
// S.crew: { on, at: "auto" | a hole ID | [easting, northing], scale (0.25-4, times the size read at the default
// view), heading (degrees from north the rig faces; null: along the hole, else 135) }. "auto" stands at the one
// hole chosen for the section, else at the chosen holes' or every visible hole's common pad, else amid the visible
// collars. The mast follows the dip and azimuth of a single hole and is otherwise upright. A spot outside the
// block (its extent cut back) hides it. The live view idles (the head turns, a hand waves); the exports, and a
// viewer who prefers reduced motion, see one fixed pose, so an export is the same every time.
import * as THREE from 'three';

let H = null, S = null, grp = null, anim = null, last = null;
export function init(host) { H = host; S = host.S; }
export const CREW = { on: false, at: 'auto', scale: 1, heading: null };
export const crewOf = (c) => ({ ...CREW, ...(c && typeof c === 'object' ? c : {}) });
const PAD = 5, RAD = Math.PI / 180;

// ---------- the settings ----------
export function patch(c, o, holes) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('setCrew takes { on, at, scale, heading }.');
  const x = crewOf(c);
  if (o.on !== undefined) x.on = !!o.on;
  if (o.at !== undefined) {
    const a = o.at;
    if (a === null || a === 'auto') x.at = 'auto';
    else if (Array.isArray(a)) {
      const p = a.map((v) => (v === null || v === '' ? NaN : +v));
      if (p.length !== 2 || !p.every(Number.isFinite)) throw new Error('at as a point is [easting, northing] in the project\'s metres.');
      x.at = p;
    } else {
      const id = String(a).trim();
      if (holes && !holes.some((h) => h.id === id)) throw new Error(`at must be "auto", a hole ID or [easting, northing]: no hole "${id}".`);
      x.at = id;
    }
  }
  if (o.scale !== undefined) { const v = o.scale === null ? 1 : +o.scale; if (!Number.isFinite(v) || v <= 0) throw new Error('scale must be a number, 0.25-4 (1: the usual size).'); x.scale = Math.max(0.25, Math.min(4, v)); }
  if (o.heading !== undefined) {
    if (o.heading === null) x.heading = null;
    else { const v = +o.heading; if (o.heading === '' || !Number.isFinite(v)) throw new Error('heading must be degrees from north (0-359), or null to follow the hole.'); x.heading = ((v % 360) + 360) % 360; }
  }
  return x;
}

// ---------- where it stands ----------
const inside = (B, x, y) => !B || (x >= B.x0 && x <= B.x1 && y >= B.y0 && y <= B.y1);
const onePad = (hs) => hs.length > 0 && hs.every((h) => Math.hypot(h.c.x - hs[0].c.x, h.c.y - hs[0].c.y) <= PAD);
// { x, y, hole } in the project's metres; hole: the one hole whose dip and azimuth the mast follows, or null.
// shown: the hole IDs drawn (null: all); chosen: the IDs chosen for the section (or null).
export function spot(c, holes, { chosen = null, shown = null, B = null } = {}) {
  if (Array.isArray(c.at)) return { x: c.at[0], y: c.at[1], hole: null };
  if (c.at !== 'auto') { const h = holes.find((k) => k.id === c.at); return h ? { x: h.c.x, y: h.c.y, hole: h } : null; }
  const vis = holes.filter((h) => (!shown || shown.includes(h.id)) && inside(B, h.c.x, h.c.y)), ch = vis.filter((h) => chosen?.includes(h.id));
  if (ch.length === 1) return { x: ch[0].c.x, y: ch[0].c.y, hole: ch[0] };
  for (const g of [ch, vis]) if (onePad(g)) return { x: g[0].c.x, y: g[0].c.y, hole: g.length === 1 ? g[0] : null };
  const use = vis.length ? vis : holes; if (!use.length) return null;
  return { x: use.reduce((s, h) => s + h.c.x, 0) / use.length, y: use.reduce((s, h) => s + h.c.y, 0) / use.length, hole: null };
}
// The hole's first metres as an azimuth (degrees) and a lean from upright in the scene (radians, with the vertical
// exaggeration, so the mast lines up with the drawn trace).
export function lean(h, vex = 1) {
  const p = h.path || [], a = p[0], b = p[Math.min(p.length - 1, 5)];
  if (!a || !b || b === a) return null;
  const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z - a.z) * vex, hz = Math.hypot(dx, dy);
  if (!(dz < 0) && hz < 1e-6) return null;
  return { az: (Math.atan2(dx, dy) / RAD + 360) % 360, tilt: Math.min(80 * RAD, Math.atan2(hz, Math.max(1e-6, -dz))) };
}

// ---------- the model (units: the skid is 10 long, the mast 11 tall) ----------
const COL = { orange: '#c65322', ink: '#142126', cream: '#fcfbf7', pad: '#a09272', rim: '#7f735a', steel: '#8c979b', yellow: '#f4c22b', hat: '#ff8b21', glass: '#9fd0e0' };
function kit() {
  const mats = {}, geos = [];
  const mat = (c) => (mats[c] ||= new THREE.MeshLambertMaterial({ color: c }));
  const geo = (g) => { g = g.toNonIndexed(); g.computeVertexNormals(); geos.push(g); return g; }; // flat faces
  const BOX = geo(new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4)), CYL = {};
  const cyl = (n, top = 1) => (CYL[`${n}:${top}`] ||= geo(new THREE.CylinderGeometry(top, 1, 1, n)));
  const add = (to, g, c, [sx, sy, sz], [x, y, z], rz = 0, rx = 0) => { const m = new THREE.Mesh(g, mat(c)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); to.add(m); return m; };
  return {
    box: (to, c, s, p, rz, rx) => add(to, BOX, c, s, p, rz, rx),
    cyl: (to, c, [r, h], p, n = 8, top = 1, rz = 0, rx = 0) => add(to, cyl(n, top), c, [r, h, r], p, rz, rx),
    dispose: () => { geos.forEach((g) => g.dispose()); Object.values(mats).forEach((m) => m.dispose()); },
  };
}
// A crew member, 2.6 tall, facing +z: boots, legs, coveralls with a hi-vis stripe, arms from the shoulders, head
// and hard hat with its brim and ridge.
function person(K, { suit, skin, hat, vest }) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  [-0.21, 0.21].forEach((x) => { K.box(body, COL.ink, [0.34, 0.9, 0.4], [x, 0.45, 0]); K.box(body, '#2b2f31', [0.38, 0.16, 0.5], [x, 0.08, 0.05]); });
  K.box(body, suit, [0.86, 0.95, 0.52], [0, 1.37, 0]);
  if (vest) K.box(body, vest, [0.9, 0.62, 0.56], [0, 1.5, 0]);
  K.box(body, COL.cream, [0.92, 0.1, 0.58], [0, 1.25, 0]); // hi-vis stripe
  K.box(body, COL.cream, [0.12, 0.6, 0.58], [-0.24, 1.55, 0]); K.box(body, COL.cream, [0.12, 0.6, 0.58], [0.24, 1.55, 0]);
  const arms = [-1, 1].map((s) => { const a = new THREE.Group(); a.position.set(s * 0.56, 1.78, 0); K.box(a, suit, [0.24, 0.78, 0.3], [0, -0.36, 0]); K.box(a, skin, [0.2, 0.18, 0.22], [0, -0.82, 0]); body.add(a); return a; });
  const head = new THREE.Group(); head.position.set(0, 1.86, 0); body.add(head);
  K.cyl(head, skin, [0.3, 0.46], [0, 0.3, 0], 8);
  K.cyl(head, hat, [0.44, 0.06], [0, 0.55, 0.06], 10); // brim, longer at the front
  K.cyl(head, hat, [0.36, 0.3], [0, 0.72, 0], 10, 0.7);
  K.box(head, COL.cream, [0.1, 0.06, 0.56], [0, 0.88, 0]);
  return { g, body, arms, head };
}
function rig(K, tilt) {
  const g = new THREE.Group(), B = (c, s, p, rz, rx) => K.box(g, c, s, p, rz, rx);
  // The levelled pad, its edge, the skid's runners and the orange deck.
  [-1.45, 1.45].forEach((z) => B(COL.ink, [10.4, 0.45, 0.4], [0, 0.22, z]));
  B(COL.orange, [10, 0.45, 3.4], [0, 0.66, 0]);
  B(COL.ink, [10.05, 0.1, 3.45], [0, 0.92, 0]);
  // The doghouse at the back: orange with a cream window band and door, an ink roof.
  B(COL.orange, [3.4, 2.7, 3.2], [-3.2, 2.32, 0]);
  B(COL.ink, [3.7, 0.25, 3.5], [-3.2, 3.8, 0]);
  B(COL.cream, [3.44, 0.55, 3.24], [-3.2, 2.85, 0]);
  B(COL.glass, [1.2, 0.4, 3.28], [-3.6, 2.85, 0]);
  B(COL.cream, [0.9, 1.75, 0.1], [-2.3, 1.85, 1.62]);
  B(COL.ink, [0.12, 0.12, 0.06], [-2.0, 1.85, 1.68]);
  // The generator box and its exhaust beside the doghouse.
  B(COL.ink, [1.9, 1.3, 1.5], [-0.35, 1.6, -0.75]);
  B(COL.cream, [1.94, 0.12, 1.54], [-0.35, 1.85, -0.75]);
  K.cyl(g, COL.steel, [0.12, 1.0], [-0.9, 2.6, -1.1], 6);
  // The rod rack: two ink stands and rods lying along the deck.
  [-0.9, 1.5].forEach((x) => B(COL.ink, [0.18, 0.75, 1.5], [x, 1.3, 0.85]));
  for (let i = 0; i < 4; i++) K.cyl(g, i % 2 ? COL.steel : COL.cream, [0.13, 3.2], [0.3, 1.78 + (i > 2 ? 0.24 : 0), 0.38 + (i % 3) * 0.32], 6, 1, Math.PI / 2);
  // The mast, from its foot on the front of the deck: two orange rails with ink rungs, the crown block, the drill
  // head (it turns) and the rod down to the ground; a brace back to the deck.
  const mast = new THREE.Group(); mast.position.set(3.7, 1.0, 0); mast.rotation.z = tilt; g.add(mast);
  const M = (c, s, p) => K.box(mast, c, s, p), ct = Math.cos(tilt);
  [-0.42, 0.42].forEach((z) => M(COL.orange, [0.32, 11, 0.32], [0.7, 5.5, z]));
  M(COL.orange, [0.2, 11, 0.7], [0.95, 5.5, 0]);
  for (let y = 1.2; y < 10.6; y += 1.3) M(COL.ink, [0.14, 0.12, 0.95], [0.7, y, 0]);
  M(COL.ink, [1.3, 0.5, 1.2], [0.45, 11.15, 0]);
  K.cyl(mast, COL.cream, [0.32, 0.18], [0.45, 11.5, 0], 8, 1, Math.PI / 2);
  K.cyl(mast, COL.steel, [0.09, 6.6 + 1 / ct], [0, 3.3 - 0.5 / ct, 0], 6); // the rod, down to the collar
  const head = new THREE.Group(); head.position.set(0, 6.6, 0); mast.add(head);
  K.cyl(head, COL.ink, [0.55, 1.1], [0, 0, 0], 6);
  K.cyl(head, COL.orange, [0.6, 0.28], [0, 0.2, 0], 6);
  K.box(head, COL.cream, [0.2, 0.5, 1.3], [0, -0.1, 0]);
  K.cyl(head, COL.ink, [0.25, 0.4], [0, -0.75, 0], 6);
  // A brace from the deck to the mast's side, 4.2 up it.
  const a = [1.5, 1.0], b = [3.7 + 0.7 * ct - 4.2 * Math.sin(tilt), 1.0 + 0.7 * Math.sin(tilt) + 4.2 * ct], v = [b[0] - a[0], b[1] - a[1]];
  K.box(g, COL.ink, [0.22, Math.hypot(...v), 0.22], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -0.5], Math.atan2(-v[0], v[1]));
  return { g, head, mast };
}
// Where the crew stand (rig units) and which way each faces (radians about the vertical; 0: +z).
const CREW_AT = [
  { at: [5.6, 0, 2.3], turn: 0.5, suit: COL.ink, vest: COL.yellow, hat: COL.cream, skin: '#e7b48c' },
  { at: [0.6, 0, 2.85], turn: -0.25, suit: COL.orange, hat: COL.yellow, skin: '#a86e47' },
  { at: [-3.6, 0, 3.0], turn: 0.15, suit: COL.ink, vest: COL.hat, hat: COL.yellow, skin: '#7b4c30' },
];

function drop() {
  if (!grp) return;
  grp.parent?.remove(grp); anim?.dispose(); grp = null; anim = null;
}
// The rig and crew, rebuilt whenever the scene is (studio.js extScene).
export function sync() {
  drop(); last = null;
  let c; try { c = patch(null, crewOf(S.crew)); } catch { c = { ...CREW, on: !!S.crew?.on }; } // a saved figure's settings, checked
  const G = H.G;
  if (!G || !c.on || !H.project?.holes) return;
  const sel = Array.isArray(S.section?.holes) ? S.section.holes : null, at = spot(c, H.project.holes, { chosen: sel, shown: S.holesShown || null, B: G.B });
  last = { at, shown: !!at && inside(G.B, at.x, at.y) };
  if (!last.shown) return;
  const L = at.hole ? lean(at.hole, S.vex) : null, tilt = L ? L.tilt : 0, heading = c.heading ?? (L && L.tilt > 0.02 ? L.az : 135);
  // Read at the default view: about a twentieth of the block's plan across, never past a third of its short side.
  const u = Math.min(G.diagH * 0.009, Math.min(G.bw, G.bh) * 0.06) * c.scale, K = kit(), R = rig(K, tilt);
  grp = new THREE.Group(); grp.add(R.g);
  const people = CREW_AT.map((p) => { const f = person(K, p); f.g.position.set(...p.at); f.g.rotation.y = p.turn; grp.add(f.g); return f; });
  // The pad: a flat octagon, its top level with the highest ground under it, reaching down past the lowest, so
  // the rig never floats or sinks on a slope.
  const rot = (90 - heading) * RAD, cs = Math.cos(rot), sn = Math.sin(rot);
  const toWorld = (lx, lz) => [lx * cs + lz * sn, lx * sn - lz * cs]; // rig units → east, north (before the scale)
  const hole = 3.7 + 1.0 * Math.tan(tilt), [ox, oy] = toWorld(hole * u, 0), cx = at.x - ox, cy = at.y - oy; // the rod meets the ground at the collar
  // The pad's top is level with the highest ground under the skid and the crew; an embankment runs down from it
  // past the lowest ground around, so nothing floats or sinks on a slope.
  const gy = (x, y) => G.V(x, y, G.surf(x, y)).y, at2 = (lx, lz) => { const [ex, ey] = toWorld(lx * u, lz * u); return gy(cx + ex, cy + ey); };
  const top = Math.max(...[[0, 0], [5.3, 1.8], [5.3, -1.8], [-5.3, 1.8], [-5.3, -1.8], ...CREW_AT.map((q) => [q.at[0], q.at[2]])].map(([lx, lz]) => at2(lx, lz)));
  let low = top; for (let i = 0; i < 16; i++) low = Math.min(low, at2(0.3 + Math.cos(i * Math.PI / 8) * 7.8, 0.5 + Math.sin(i * Math.PI / 8) * 7.8));
  const deep = (top - low) / u + 0.3;
  K.cyl(grp, COL.pad, [6.4, 0.12], [0.3, -0.04, 0.5], 12);
  K.cyl(grp, COL.rim, [6.4 + deep * 0.35, deep], [0.3, -deep / 2 - 0.08, 0.5], 12, 6.4 / (6.4 + deep * 0.35));
  const p = G.V(cx, cy, 0);
  grp.position.set(p.x, top, p.z); grp.rotation.y = rot; grp.scale.setScalar(u);
  grp.traverse((o) => { o.frustumCulled = false; });
  H.root.add(grp);
  anim = { head: R.head, people, dispose: K.dispose };
  pose(0);
}
// The idle motion at time t (seconds); t = 0 is the pose every export shows.
function pose(t) {
  if (!anim) return;
  const [a, b, c] = anim.people;
  anim.head.rotation.y = 0.4 + t * 1.1;
  a.head.rotation.y = -0.35 + Math.sin(t * 0.6) * 0.35;
  b.body.rotation.z = Math.sin(t * 1.4) * 0.05; b.body.position.y = Math.abs(Math.sin(t * 1.4)) * 0.04;
  b.arms[0].rotation.x = -0.5; b.arms[1].rotation.x = -0.5; // carrying a rod's weight forward
  c.arms[1].rotation.z = 2.55 + Math.sin(t * 4) * 0.35; c.arms[0].rotation.z = -0.15; // a wave
}
const still = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
// Called by studio.js each frame of the live view (now: ms) and with no time before an export renders.
export function tick(now) { if (anim) pose(now && !still?.matches ? now / 1000 : 0); }

// ---------- the API and the panel ----------
export function set(o = {}) {
  S.crew = patch(S.crew, o, H.project?.holes);
  const c = S.crew;
  H.status(c.on ? `Drill crew on, ${Array.isArray(c.at) ? `at ${c.at.map(Math.round).join(', ')}` : c.at === 'auto' ? 'at the drill pad' : `at ${c.at}`}.` : 'Drill crew off.');
}
export function state() {
  const c = crewOf(S.crew), G = H.G, at = last?.at, out = { ...c, at: Array.isArray(c.at) ? [...c.at] : c.at, shown: !!(c.on && last?.shown && grp), where: at ? [at.x, at.y] : null, hole: at?.hole?.id || null, screen: null };
  if (out.shown && G) { H.camera.updateMatrixWorld(); const [W, Hh] = H.frame(), [x, y] = H.proj(G.V(at.x, at.y, G.surf(at.x, at.y))); out.screen = [x / W, y / Hh]; }
  return out;
}
export function renderUI(el) {
  if (!el) return;
  const c = crewOf(S.crew), sel = el.querySelector('select'); el.hidden = !c.on;
  if (!sel) return;
  const ids = (H.project?.holes || []).map((h) => h.id).slice(0, 300), want = ['auto', ...ids].join('\n');
  if (sel.dataset.ids !== want) { sel.dataset.ids = want; sel.replaceChildren(...['auto', ...ids].map((v) => new Option(v === 'auto' ? 'Auto (at the drill pad)' : `At ${v}`, v))); }
  if (Array.isArray(c.at)) { if (![...sel.options].some((o) => o.value === 'point')) { const o = new Option('At a point', 'point'); o.disabled = true; sel.add(o); } sel.value = 'point'; } else sel.value = c.at;
}
