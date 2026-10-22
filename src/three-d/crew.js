// Exploration Maps 3D: the drill crew. A cartoon drill rig (skid, deck, mast, drill head, rod rack, doghouse and
// generator) with three crew in hard hats, on a levelled pad at the drill collar. Off by default (S.crew.on); loaded
// by studio.js for a figure that turns it on, or on EM3D.setCrew. Procedural geometry only (rounded boxes, capsules,
// balls and domes made here, so three.js gains no classes), in the brand orange and ink with cream accents,
// smooth-lit with a thin ink outline.
//
// S.crew: { on, at: "auto" | a hole ID | [easting, northing], scale (0.25-4, times the default size), heading
// (degrees from north the rig faces; null: along the hole, else 135), pick (set here: the collar "auto" chose) }.
// "auto" stands at the one hole chosen for the section, else at the chosen holes' or every visible hole's common
// pad, else at the visible collar with the most clear space around it on screen, nearer the camera preferred. That
// choice is kept (pick) so the figure reopens as it was; turning the crew on or setting at chooses again. The mast
// follows the dip and azimuth of a single hole and is otherwise upright. A spot outside the block hides it. Collar
// rings under the pad, and callout dots over the rig, give way to it (collar, covers). The live view idles (the
// head turns, a hand waves); exports, and a viewer who prefers reduced motion, see one fixed pose.
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
  if (typeof x.pick !== 'string' || o.on !== undefined || o.at !== undefined) delete x.pick; // chosen again
  if (o.on !== undefined) x.on = !!o.on;
  if (o.at !== undefined) {
    const a = o.at;
    if (a === null || a === 'auto') x.at = 'auto';
    else if (Array.isArray(a)) {
      const p = a.map((v) => (v === null || v === '' ? NaN : +v));
      if (p.length !== 2 || !p.every(Number.isFinite)) throw new Error('at: [easting, northing].');
      x.at = p;
    } else {
      const id = String(a).trim();
      if (holes && !holes.some((h) => h.id === id)) throw new Error(`at: no hole "${id}".`);
      x.at = id;
    }
  }
  if (o.scale !== undefined) { const v = o.scale === null ? 1 : +o.scale; if (!Number.isFinite(v) || v <= 0) throw new Error('scale must be a number, 0.25-4.'); x.scale = Math.max(0.25, Math.min(4, v)); }
  if (o.heading !== undefined) {
    if (o.heading === null) x.heading = null;
    else { const v = +o.heading; if (o.heading === '' || !Number.isFinite(v)) throw new Error('heading must be degrees from north, or null.'); x.heading = ((v % 360) + 360) % 360; }
  }
  return x;
}

// ---------- where it stands ----------
const inside = (B, x, y) => !B || (x >= B.x0 && x <= B.x1 && y >= B.y0 && y <= B.y1);
const near = (a, b) => Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) <= PAD;
const onePad = (hs) => hs.length > 0 && hs.every((h) => near(h, hs[0]));
// At one collar: its hole leads the mast unless it shares the pad.
const own = (h, vis, pick) => ({ x: h.c.x, y: h.c.y, hole: vis.filter((k) => near(k, h)).length > 1 ? null : h, ...(pick ? { pick: h.id } : {}) });
// { x, y, hole, pick? } in the project's metres; hole: the one hole whose dip and azimuth the mast follows, or null.
// shown: the hole IDs drawn (null: all); chosen: the IDs chosen for the section (or null); view(h): a collar's
// [x, y] (0-1 of the frame) and distance from the camera, or null off screen.
export function spot(c, holes, { chosen = null, shown = null, B = null, view = null } = {}) {
  if (Array.isArray(c.at)) return { x: c.at[0], y: c.at[1], hole: null };
  if (c.at !== 'auto') { const h = holes.find((k) => k.id === c.at); return h ? { x: h.c.x, y: h.c.y, hole: h } : null; }
  const vis = holes.filter((h) => (!shown || shown.includes(h.id)) && inside(B, h.c.x, h.c.y)), ch = vis.filter((h) => chosen?.includes(h.id));
  if (ch.length === 1) return own(ch[0], [ch[0]]);
  for (const g of [ch, vis]) if (onePad(g)) return own(g[0], g);
  const kept = vis.find((h) => h.id === c.pick); if (kept) return own(kept, vis, true);
  const P = view ? vis.map((h) => ({ h, s: view(h) })).filter((o) => o.s) : [];
  if (P.length) {
    // Of the collars with room for the rig on screen (to the nearest collar off its pad), the nearest the camera, so
    // it stands in the open and in front; without room anywhere, the most room. Ties by ID.
    const [W, Hh] = view.frame || [1, 1], need = 0.03 * W * (c.scale || 1);
    const R = P.map((o) => ({ ...o, room: Math.min(...P.filter((k) => !near(k.h, o.h)).map((k) => Math.hypot((k.s[0] - o.s[0]) * W, (k.s[1] - o.s[1]) * Hh)), 1e9) }));
    const ok = R.filter((o) => o.room >= need), by = ok.length ? (a, b) => a.s[2] - b.s[2] : (a, b) => b.room - a.room;
    const best = (ok.length ? ok : R).sort((a, b) => by(a, b) || (a.h.id < b.h.id ? -1 : 1))[0];
    return own(best.h, vis, true);
  }
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

// ---------- the shapes ----------
// One grid of directions d on the unit sphere (rows from the top pole, columns round), mapped to a surface whose
// normal is d: a rounded box (the box shrunk by r, swept by a ball of r), a rounded cylinder (the same, round in
// plan), a ball (an ellipsoid) or a dome (its top half). Rows and columns sit just either side of each axis, so the
// flat faces stay flat and the curves smooth, in 168 triangles.
const Q = Math.PI / 2, E = 1e-3, ROWS = [0, E, Q / 2, Q - E, Q + E, 1.5 * Q, 2 * Q - E, 2 * Q], COLS = [0, 1, 2, 3].flatMap((q) => [E, Q / 2, Q - E].map((a) => a + q * Q));
const sgn = (v) => (v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0);
function surface(kind, [hx, hy, hz], rr = 0, taper = 0) {
  // r: the corner radius, or [round in plan, up and down]; never past a half size, which would turn it inside out.
  const [r, ry] = (Array.isArray(rr) ? rr : [rr, rr]).map((v, i) => Math.min(v, i ? hy : Math.min(hx, hz)));
  const pos = [], nor = [], idx = [], n = COLS.length;
  ROWS.forEach((f) => COLS.forEach((t) => {
    const d = [Math.sin(f) * Math.cos(t), Math.cos(f), Math.sin(f) * Math.sin(t)], q = Math.hypot(d[0], d[2]);
    let p;
    if (kind === 'ball' || kind === 'dome') p = [d[0] * hx, (kind === 'dome' ? Math.max(0, d[1]) : d[1]) * hy, d[2] * hz];
    else {
      const k = kind === 'cyl' ? (q > 1e-9 ? [d[0] / q, d[2] / q] : [0, 0]) : [sgn(d[0]), sgn(d[2])];
      p = [k[0] * (hx - r) + r * d[0], sgn(d[1]) * (hy - ry) + ry * d[1], k[1] * (hz - r) + r * d[2]];
    }
    const w = 1 - taper * p[1] / hy; p[0] *= w; p[2] *= w;
    pos.push(...p); nor.push(...(kind === 'ball' || kind === 'dome' ? new THREE.Vector3(d[0] / hx, d[1] / hy, d[2] / hz).normalize().toArray() : d));
  }));
  for (let i = 0; i + 1 < ROWS.length; i++) for (let j = 0; j < n; j++) { const a = i * n + j, b = i * n + (j + 1) % n; idx.push(a, b, a + n, b, b + n, a + n); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}
const COL = { orange: '#c65322', ink: '#142126', cream: '#fcfbf7', pad: '#7d7868', rim: '#6b6c52', steel: '#8c979b', yellow: '#f4c22b', hat: '#ff8b21', glass: '#9fd0e0' };
const LINE = 0.05; // the ink outline, rig units
function kit() {
  const mats = {}, geos = [], line = new THREE.MeshBasicMaterial({ color: COL.ink, side: THREE.BackSide });
  const mat = (c) => (mats[c] ||= new THREE.MeshLambertMaterial({ color: c }));
  const keep = (g) => { geos.push(g); return g; };
  // A part: kind, colour, half sizes, corner radius, position, rotation (z then x) and taper; with its outline, a
  // slightly larger copy drawn inside out in ink.
  const part = (to, kind, c, h, r, [x, y, z], { rz = 0, rx = 0, taper = 0, outline = true } = {}) => {
    const m = new THREE.Mesh(keep(surface(kind, h, r, taper)), mat(c)); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); to.add(m);
    if (outline) m.add(new THREE.Mesh(keep(surface(kind, h.map((v) => v + LINE), [].concat(r).map((v) => v + LINE), taper)), line));
    return m;
  };
  return { part, dispose: () => { geos.forEach((g) => g.dispose()); Object.values(mats).concat(line).forEach((m) => m.dispose()); } };
}
// A crew member, about 2.6 tall, facing +z: chunky and friendly (a big round head, short limbs, a soft taper).
function person(K, { suit, skin, hat, vest }) {
  const P = K.part, g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  [-0.19, 0.19].forEach((x) => { P(body, 'cyl', COL.ink, [0.17, 0.36, 0.17], 0.17, [x, 0.42, 0]); P(body, 'ball', '#2b2f31', [0.2, 0.12, 0.27], 0, [x, 0.1, 0.06]); });
  P(body, 'cyl', suit, [0.44, 0.48, 0.34], 0.22, [0, 1.16, 0], { taper: 0.12 });
  if (vest) P(body, 'cyl', vest, [0.46, 0.27, 0.36], 0.14, [0, 1.3, 0], { taper: 0.12, outline: false });
  P(body, 'cyl', COL.cream, [0.47, 0.055, 0.37], 0.05, [0, 1.1, 0], { outline: false }); // hi-vis stripe
  const arms = [-1, 1].map((s) => { const a = new THREE.Group(); a.position.set(s * 0.5, 1.5, 0); P(a, 'cyl', suit, [0.12, 0.3, 0.12], 0.12, [0, -0.26, 0]); P(a, 'ball', skin, [0.13, 0.13, 0.13], 0, [0, -0.6, 0]); body.add(a); return a; });
  const head = new THREE.Group(); head.position.set(0, 1.62, 0); body.add(head);
  P(head, 'ball', skin, [0.42, 0.4, 0.4], 0, [0, 0.36, 0]);
  [-0.14, 0.14].forEach((x) => P(head, 'ball', COL.ink, [0.05, 0.065, 0.04], 0, [x, 0.4, 0.37], { outline: false })); // eyes
  P(head, 'cyl', hat, [0.52, 0.04, 0.56], 0.04, [0, 0.58, 0.05]); // the soft brim
  P(head, 'dome', hat, [0.44, 0.36, 0.44], 0, [0, 0.58, 0]);
  P(head, 'cyl', COL.cream, [0.06, 0.04, 0.4], 0.04, [0, 0.9, 0], { rx: 0, outline: false }); // the ridge
  return { g, body, arms, head };
}
function rig(K, tilt) {
  const P = K.part, g = new THREE.Group(), B = (c, h, r, p, o) => P(g, 'box', c, h, r, p, o);
  // Runners and the deck.
  [-1.35, 1.35].forEach((z) => B(COL.ink, [5.1, 0.2, 0.2], 0.16, [0, 0.2, z]));
  B(COL.orange, [4.9, 0.26, 1.6], 0.2, [0, 0.62, 0]);
  // The doghouse at the back: orange with a cream window band, a window and door; an ink roof.
  B(COL.orange, [1.65, 1.3, 1.5], 0.36, [-3.1, 2.15, 0]);
  B(COL.cream, [1.69, 0.27, 1.54], [0.38, 0.06], [-3.1, 2.62, 0], { outline: false });
  B(COL.glass, [0.55, 0.19, 1.58], [0.15, 0.06], [-3.5, 2.62, 0], { outline: false });
  B(COL.ink, [1.82, 0.14, 1.66], 0.12, [-3.1, 3.52, 0]);
  B(COL.cream, [0.42, 0.8, 0.06], 0.06, [-2.25, 1.75, 1.5]);
  // The generator box and its exhaust.
  B(COL.ink, [0.9, 0.6, 0.7], 0.25, [-0.45, 1.47, -0.8]);
  P(g, 'cyl', COL.steel, [0.12, 0.45, 0.12], 0.08, [-0.95, 2.4, -1.1]);
  // The rod rack: two stands and the rods along the deck.
  [-0.9, 1.5].forEach((x) => B(COL.ink, [0.1, 0.36, 0.7], 0.08, [x, 1.2, 0.8]));
  for (let i = 0; i < 4; i++) P(g, 'cyl', i % 2 ? COL.steel : COL.cream, [0.13, 1.6, 0.13], 0.12, [0.3, 1.66 + (i > 2 ? 0.24 : 0), 0.45 + (i % 3) * 0.3], { rz: Q, outline: i === 0 });
  // The mast, from its foot on the front of the deck: two orange rails with ink rungs, the crown block, the drill
  // head (it turns) and the rod down to the collar; a brace back to the deck.
  const mast = new THREE.Group(); mast.position.set(3.7, 1.0, 0); mast.rotation.z = tilt; g.add(mast);
  const M = (c, h, r, p, o) => P(mast, 'box', c, h, r, p, o), ct = Math.cos(tilt);
  [-0.42, 0.42].forEach((z) => M(COL.orange, [0.17, 5.5, 0.17], 0.14, [0.7, 5.5, z]));
  for (let y = 1.4; y < 10.6; y += 1.5) M(COL.ink, [0.08, 0.07, 0.45], 0.06, [0.7, y, 0], { outline: false });
  M(COL.ink, [0.65, 0.28, 0.6], 0.2, [0.45, 11.15, 0]);
  P(mast, 'cyl', COL.cream, [0.32, 0.1, 0.32], 0.08, [0.45, 11.5, 0], { rx: Q });
  P(mast, 'cyl', COL.steel, [0.09, (6.6 + 1 / ct) / 2, 0.09], 0.05, [0, 3.3 - 0.5 / ct, 0], { outline: false });
  const head = new THREE.Group(); head.position.set(0, 6.6, 0); mast.add(head);
  P(head, 'cyl', COL.ink, [0.55, 0.5, 0.55], 0.2, [0, 0, 0]);
  P(head, 'cyl', COL.orange, [0.6, 0.14, 0.6], 0.1, [0, 0.22, 0], { outline: false });
  P(head, 'box', COL.cream, [0.1, 0.24, 0.66], 0.08, [0, -0.06, 0], { outline: false });
  P(head, 'cyl', COL.ink, [0.24, 0.2, 0.24], 0.1, [0, -0.66, 0]);
  const a = [1.5, 1.0], b = [3.7 + 0.7 * ct - 4.2 * Math.sin(tilt), 1.0 + 0.7 * Math.sin(tilt) + 4.2 * ct], v = [b[0] - a[0], b[1] - a[1]];
  P(g, 'cyl', COL.ink, [0.11, Math.hypot(...v) / 2, 0.11], 0.1, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -0.5], { rz: Math.atan2(-v[0], v[1]) });
  return { g, head };
}
// Where the crew stand (rig units) and which way each faces (radians about the vertical; 0: +z).
const CREW_AT = [
  { at: [4.6, 0, 2.25], turn: 0.5, suit: COL.ink, vest: COL.yellow, hat: COL.cream, skin: '#e7b48c' },
  { at: [0.6, 0, 2.4], turn: -0.25, suit: COL.orange, hat: COL.yellow, skin: '#a86e47' },
  { at: [-3.4, 0, 2.5], turn: 0.15, suit: COL.ink, vest: COL.hat, hat: COL.yellow, skin: '#7b4c30' },
];
// The pad: an ellipse hugging the skid and the crew (rig units: centre, radii).
const PADC = [0, 0.35], PADR = [6.3, 4.3], LIP = 0.27; // the lip: about 0.3 of the skid's height
const onPad = (lx, lz, k = 1) => ((lx - PADC[0]) / (PADR[0] * k)) ** 2 + ((lz - PADC[1]) / (PADR[1] * k)) ** 2 <= 1;
// A soft contact shadow: a disc of ink fading to clear at its rim.
function shade([sx, sz], [x, z]) {
  const pos = [0, 0, 0], col = [0.08, 0.13, 0.15, 0.55], idx = [], n = 16, A = [0.55, 0.4, 0];
  [0.7, 1].forEach((r, k) => { for (let j = 0; j < n; j++) { const t = j / n * 2 * Math.PI; pos.push(Math.cos(t) * r, 0, Math.sin(t) * r); col.push(0.08, 0.13, 0.15, A[k + 1]); } });
  for (let j = 0; j < n; j++) { const j1 = (j + 1) % n; idx.push(0, 1 + j1, 1 + j, 1 + j, 1 + j1, 1 + n + j, 1 + j1, 1 + n + j1, 1 + n + j); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  m.scale.set(sx, 1, sz); m.position.set(x, 0.05, z); return m;
}

// The cleared drill pad: level where the rig and crew stand (to 0.96 of its ellipse), then a gravel ramp out to the
// ground at 1.2 (ground(x, z): its height there, rig units), fading to the terrain's tone at the rim: a shallow cut on
// the high side, a fill on the low side, and no wall.
const RING = [0, 0.5, 0.75, 0.96, 1.04, 1.12, 1.2];
function pad(ground) {
  const pos = [], col = [], idx = [], n = 24, a = new THREE.Color(COL.pad), b = new THREE.Color(COL.rim);
  RING.forEach((r) => { for (let j = 0; j < n; j++) {
    const t = j / n * 2 * Math.PI, x = PADC[0] + Math.cos(t) * PADR[0] * r, z = PADC[1] + Math.sin(t) * PADR[1] * r, k = Math.min(1, Math.max(0, (r - 0.96) / 0.24)), e = k * k * (3 - 2 * k);
    pos.push(x, 0.04 + (k ? (ground(x, z) - 0.01) * e : 0), z); const c = a.clone().lerp(b, e); col.push(c.r, c.g, c.b);
  } });
  for (let i = 0; i + 1 < RING.length; i++) for (let j = 0; j < n; j++) { const p = i * n + j, q = i * n + (j + 1) % n; idx.push(p, q, p + n, q, q + n, p + n); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

function drop() {
  if (!grp) return;
  grp.parent?.remove(grp); grp.traverse((o) => { if (o.material?.vertexColors) { o.geometry.dispose(); o.material.dispose(); } }); anim?.dispose(); grp = null; anim = null;
}
// The rig and crew, rebuilt whenever the scene is (studio.js extScene).
export function sync() {
  drop(); last = null;
  let c; try { c = patch(null, crewOf(S.crew)); if (typeof S.crew?.pick === 'string') c.pick = S.crew.pick; } catch { c = { ...CREW, on: !!S.crew?.on }; } // a saved figure's settings, checked
  const G = H.G;
  if (!G || !c.on || !H.project?.holes) return;
  H.camera.updateMatrixWorld();
  const [W, Hh] = H.frame(), view = (h) => { const v = G.V(h.c.x, h.c.y, h.c.z), [x, y, z] = H.proj(v), s = [x / W, y / Hh, H.camera.position.distanceTo(v)]; return z < 1 && s[0] > 0.22 && s[0] < 0.8 && s[1] > 0.2 && s[1] < 0.85 ? s : null; }; // clear of the cards at the sides
  view.frame = [W, Hh];
  const sel = Array.isArray(S.section?.holes) ? S.section.holes : null, at = spot(c, H.project.holes, { chosen: sel, shown: S.holesShown || null, B: G.B, view });
  if (at?.pick && S.crew.pick !== at.pick) S.crew.pick = at.pick; // kept, so the figure reopens as it was
  last = { at, shown: !!at && inside(G.B, at.x, at.y) };
  if (!last.shown) return;
  const L = at.hole ? lean(at.hole, S.vex) : null, tilt = L ? L.tilt : 0, heading = c.heading ?? (L && L.tilt > 0.02 ? L.az : 135);
  // Read at the default view: about a thirtieth of the block's plan across, never past a twentieth of its short side.
  const u = Math.min(G.diagH * 0.0054, Math.min(G.bw, G.bh) * 0.036) * c.scale, K = kit(), R = rig(K, tilt);
  grp = new THREE.Group(); grp.add(R.g, shade([5.9, 2.4], [-0.1, 0]), ...CREW_AT.map((q) => shade([0.62, 0.5], [q.at[0], q.at[2]])));
  const people = CREW_AT.map((p) => { const f = person(K, p); f.g.position.set(...p.at); f.g.rotation.y = p.turn; grp.add(f.g); return f; });
  const rot = (90 - heading) * RAD, cs = Math.cos(rot), sn = Math.sin(rot);
  const toWorld = (lx, lz) => [lx * cs + lz * sn, lx * sn - lz * cs]; // rig units → east, north (before the scale)
  const hole = 3.7 + 1.0 * Math.tan(tilt), [ox, oy] = toWorld(hole * u, 0), cx = at.x - ox, cy = at.y - oy; // the rod meets the ground at the collar
  // The pad is level at the median ground under the skid and the crew (nothing sunk past the lip), and ramps to the
  // ground at its rim (pad, below).
  const gy = (x, y) => G.V(x, y, G.surf(x, y)).y, at2 = (lx, lz) => { const [ex, ey] = toWorld(lx * u, lz * u); return gy(cx + ex, cy + ey); };
  const ys = [[0, 0], [5.2, 1.6], [5.2, -1.6], [-5.2, 1.6], [-5.2, -1.6], [2.6, 0], [-2.6, 0], ...CREW_AT.map((q) => [q.at[0], q.at[2]])].map(([lx, lz]) => at2(lx, lz)).sort((a, b) => a - b), top = Math.max(ys[ys.length >> 1], ys[ys.length - 1] - LIP * u); // nothing sunk past the lip
  grp.add(pad((lx, lz) => (at2(lx, lz) - top) / u));
  const p = G.V(cx, cy, 0);
  grp.position.set(p.x, top, p.z); grp.rotation.y = rot; grp.scale.setScalar(u);
  grp.traverse((o) => { o.frustumCulled = false; });
  H.root.add(grp);
  // What the overlay keeps clear: the collars on the pad (plan), and the rig's place on screen (covers).
  const toLocal = (x, y) => { const ex = (x - cx) / u, ey = (y - cy) / u; return [ex * cs + ey * sn, ex * sn - ey * cs]; };
  const ownAt = (h) => Math.hypot(h.c.x - at.x, h.c.y - at.y) < 0.5;
  const under = new Set(H.project.holes.filter((h) => !ownAt(h) && onPad(...toLocal(h.c.x, h.c.y), 1.05)).map((h) => h.id));
  const box = []; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; [0, 3.6].forEach((y) => box.push([PADC[0] + Math.cos(a) * PADR[0], y, PADC[1] + Math.sin(a) * PADR[1]])); }
  box.push([3.7 - 11.6 * Math.sin(tilt), 1 + 11.6 * Math.cos(tilt), 0]); // the mast's top
  anim = { head: R.head, people, dispose: K.dispose, under, ownAt, foot: new THREE.Vector3(3.7, 1.0, 0), box };
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

// ---------- the overlay's hooks (studio.js drawOverlay, drawCallout) ----------
// A collar's ring: false under the pad (hidden), its screen spot at the rod's foot (where the rod meets the deck,
// under the mast) for the rig's own collar, else undefined (as drawn).
export function collar(h) {
  if (!anim) return undefined;
  if (anim.under.has(h.id)) return false;
  if (!anim.ownAt(h)) return undefined;
  grp.updateMatrixWorld(); return H.proj(anim.foot.clone().applyMatrix4(grp.matrixWorld)).slice(0, 2);
}
// Whether a point on the frame lies over the rig: inside the box on screen round its pad, doghouse roof and mast top.
export function covers([x, y]) {
  if (!anim || !grp) return false;
  grp.updateMatrixWorld(); const v = new THREE.Vector3(), P = anim.box.map((q) => H.proj(v.set(...q).applyMatrix4(grp.matrixWorld))), X = P.map((q) => q[0]), Y = P.map((q) => q[1]);
  return x >= Math.min(...X) && x <= Math.max(...X) && y >= Math.min(...Y) && y <= Math.max(...Y);
}

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
const SIZES = [['0.6', 'Small'], ['1', 'Medium'], ['1.6', 'Large']];
export function renderUI(el) {
  if (!el) return;
  const c = crewOf(S.crew), [sel, size] = el.querySelectorAll('select'); el.hidden = !c.on;
  if (!sel) return;
  const ids = (H.project?.holes || []).map((h) => h.id).slice(0, 300), want = ['auto', ...ids].join('\n');
  if (sel.dataset.ids !== want) { sel.dataset.ids = want; sel.replaceChildren(...['auto', ...ids].map((v) => new Option(v === 'auto' ? 'Auto (at the drill pad)' : `At ${v}`, v))); }
  if (Array.isArray(c.at)) { if (![...sel.options].some((o) => o.value === 'point')) { const o = new Option('At a point', 'point'); o.disabled = true; sel.add(o); } sel.value = 'point'; } else sel.value = c.at;
  if (!size) return;
  const s = String(c.scale), opts = SIZES.some(([v]) => v === s) ? SIZES : [...SIZES, [s, `${s}×`]];
  if (size.dataset.opts !== opts.join()) { size.dataset.opts = opts.join(); size.replaceChildren(...opts.map(([v, t]) => new Option(t, v))); }
  size.value = s;
}
