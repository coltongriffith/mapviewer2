// Exploration Maps 3D: the drill crew's life, for the live view only (the editor, /3d/share and /3d/embed). Loaded
// by crew.js when the crew is on with life or chatter. Each crew member loops a small routine on the pad (feeding
// rods from the rack to the mast, a trip to the doghouse, a coffee break, leaning on the rack and a stretch), with
// staggered timings; every 6-12 s one of them says a short line in a speech bubble; a viewer who points at or taps
// one is noticed: they stop, turn to the camera, wave and say hello, then go back to work.
//
// Nothing here reaches an export: crew.js puts every part back in its fixed pose before an export renders, and the
// bubbles are page elements over the figure, not drawn on it. A viewer who prefers reduced motion sees no walking and
// no bubbles unless they tap one of the crew. The lines are about the job, safety, the weather and coffee, never about
// results: these figures go to investors.
import * as THREE from 'three';

export const LINES = [
  'Rods are stacked.', "Wind's picking up.", 'Who took the last coffee?', 'Hard hats on, folks.', 'Shift change at six.',
  'Mind the hoses.', 'Pass me a wrench?', "Rain's holding off.", "Water truck's late again.", 'Gloves on, please.',
  'Lunch is in the doghouse.', 'Nice and steady.', 'Check the tie-downs.', "Coffee's fresh!", 'Watch your step.',
  'Pump sounds happy.', 'Clouds rolling in.', "Who's on nights?", "Next rod's ready.", 'Keep the pad tidy.',
  "Sun's out, finally.", "Fuel's topped up.", 'Radio check, all good.', 'Stretch break, back in five.', 'Boots are muddy again.',
  'Safety meeting at noon.',
];
export const REACT = ['Oh, hey!', "Didn't see you there.", 'Mind the mud.', 'Howdy!', 'Hard hat zone, friend.', 'Welcome to the pad.', "Careful, it's slippery.", 'Good to see you.'];

// Lines in a fixed order for a seed, none of the last few again.
export function picker(lines, seed = 1, recent = 6) {
  let s = Math.imul(seed | 0, 0x9e3779b1) >>> 0 || 1; const last = [];
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return { rnd, next() { let i; do i = Math.floor(rnd() * lines.length); while (last.includes(i) && lines.length > recent); last.push(i); if (last.length > recent) last.shift(); return lines[i]; } };
}

// A routine: steps on the pad in rig units, { to: [x, z], act } walking there (carrying, for act "carry") or
// { act, dur, face } in place, facing that way (radians about the vertical; 0: +z). It closes back at its start.
export const SPEED = 1.1;
export function plan(start, steps) {
  const out = []; let p = start, t = 0;
  const walk = (to, act) => { const dur = Math.hypot(to[0] - p[0], to[1] - p[1]) / SPEED; if (dur > 0) out.push({ from: p, to, t0: t, dur, walk: true, act }); p = to; t += dur; };
  steps.forEach((s) => { if (s.to) walk(s.to, s.act); else { out.push({ from: p, to: p, t0: t, dur: s.dur, act: s.act, face: s.face }); t += s.dur; } });
  walk(start);
  return { steps: out, total: t };
}
// Where the routine is at time t (seconds, looping): position, the way to face, walking or not, the act, its
// progress k (0-1) and the time into it; stride: the distance walked in this step (the legs' phase).
export function at(P, t) {
  const tt = ((t % P.total) + P.total) % P.total, s = P.steps.find((x) => tt < x.t0 + x.dur) || P.steps[P.steps.length - 1], into = tt - s.t0, k = Math.min(1, into / s.dur);
  if (!s.walk) return { x: s.to[0], z: s.to[1], yaw: s.face, walk: false, act: s.act, k, into };
  const dx = s.to[0] - s.from[0], dz = s.to[1] - s.from[1];
  return { x: s.from[0] + dx * k, z: s.from[1] + dz * k, yaw: Math.atan2(dx, dz), walk: true, act: s.act, k, into, stride: into * SPEED };
}
// The three crew (crew.js CREW_AT): the driller feeds rods from the rack to the mast; the helper goes to the doghouse,
// leans on the rack and stretches; the third takes a coffee break. Started at different points of their loops.
const PI = Math.PI;
export const ROUTINES = [
  [[4.6, 2.25], [{ act: 'work', dur: 3, face: PI }, { to: [0.9, 2.0] }, { act: 'pick', dur: 1.4, face: PI }, { to: [4.4, 2.0], act: 'carry' }, { act: 'feed', dur: 2.6, face: -2.8 }]],
  [[0.6, 2.4], [{ to: [-2.25, 2.55] }, { act: 'door', dur: 2.4, face: PI }, { to: [2.1, 2.55] }, { act: 'lean', dur: 3.5, face: 0.3 }, { act: 'stretch', dur: 2.2, face: 0.3 }, { to: [0.6, 2.4] }, { act: 'idle', dur: 2, face: -0.25 }]],
  [[-3.4, 2.5], [{ act: 'mug', dur: 6, face: 0.15 }, { to: [-1.4, 2.9] }, { act: 'idle', dur: 2.5, face: 0.6 }, { act: 'stretch', dur: 2, face: 0.6 }]],
];
const OFFSET = [0, 3.7, 7.9];

let L = null;
const css = '.em3d-crew-talk{position:absolute;inset:0;pointer-events:none;z-index:2}'
  + '.em3d-crew-talk p{position:absolute;margin:0;transform:translate(-50%,calc(-100% - 9px));background:#fcfbf7;color:#142126;border:1.5px solid #142126;border-radius:12px;padding:5px 10px;font-family:inherit;font-size:12.5px;font-weight:600;line-height:1.25;white-space:nowrap;box-shadow:0 2px 6px rgba(20,33,38,.18);opacity:0;transition:opacity .25s}'
  + '.em3d-crew-talk p.on{opacity:1}'
  + '.em3d-crew-talk p::after{content:"";position:absolute;left:50%;bottom:-6px;width:9px;height:9px;background:#fcfbf7;border-right:1.5px solid #142126;border-bottom:1.5px solid #142126;transform:translateX(-50%) rotate(45deg)}';

export function attach(H, A) {
  detach();
  const c = A.c, frame = H.renderer?.domElement?.parentElement;
  L = { H, A, c, t: null, me: A.people.map((f, i) => ({ clock: OFFSET[i] || 0, yaw: f.g.rotation.y, notice: null, calm: 0 })), plans: ROUTINES.map(([s, st]) => plan(s, st)), lines: picker(LINES, 7), react: picker(REACT, 11, 3), next: null, say: null, hover: -1, off: [] };
  // The props: a rod carried in front, and a mug in the coffee drinker's hand (hidden unless in use).
  const P = A.K.part;
  L.rod = A.people.map((f) => P(f.body, 'cyl', '#8c979b', [0.07, 0.8, 0.07], 0.05, [0, 0.98, 0.62], { rz: PI / 2 }));
  L.mug = A.people.map((f) => P(f.arms[1], 'cyl', '#fcfbf7', [0.1, 0.11, 0.1], 0.04, [0, -0.74, 0.14]));
  A.props.push(...L.rod, ...L.mug); [...L.rod, ...L.mug].forEach((m) => { m.visible = false; m.traverse((o) => { o.frustumCulled = false; }); });
  if (!frame || typeof document === 'undefined') return;
  if (!document.getElementById('em3d-crew-css')) { const s = document.createElement('style'); s.id = 'em3d-crew-css'; s.textContent = css; document.head.appendChild(s); }
  L.box = document.createElement('div'); L.box.className = 'em3d-crew-talk'; L.box.setAttribute('aria-live', 'polite');
  L.bubble = document.createElement('p'); L.box.appendChild(L.bubble); frame.appendChild(L.box);
  // Pointing at or tapping one of the crew: a pointer cursor, and they notice.
  let down = null;
  const on = (type, f) => { frame.addEventListener(type, f, true); L.off.push(() => frame.removeEventListener(type, f, true)); };
  on('pointermove', (e) => { const i = hit(e); if (i >= 0) { H.renderer.domElement.style.cursor = 'pointer'; if (i !== L.hover && L.t !== null && L.t >= L.me[i].calm) notice(i); } L.hover = i; });
  on('pointerleave', () => { L.hover = -1; });
  on('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  on('pointerup', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 600) { const i = hit(e); if (i >= 0) notice(i); } down = null; });
}
export function detach() {
  if (!L) return;
  L.off.forEach((f) => f()); L.box?.remove(); L = null;
}

const tmp = new THREE.Vector3();
// Which of the crew is under the pointer (the nearest), or -1: a box on screen from their boots to their hat.
function hit(e) {
  if (!L?.box) return -1;
  const { H, A } = L, r = L.box.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = -1, bz = Infinity;
  A.grp.updateMatrixWorld();
  A.people.forEach((f, i) => {
    const [fx, fy, fz] = H.proj(f.g.getWorldPosition(tmp)), [, ty] = H.proj(f.head.localToWorld(tmp.set(0, 1.0, 0))), h = Math.max(8, fy - ty), w = Math.max(8, h * 0.32);
    if (x > fx - w && x < fx + w && y > ty - 4 && y < fy + 4 && fz < bz) { best = i; bz = fz; }
  });
  return best;
}
function say(i, text, t, hold) { L.say = { i, until: t + hold }; L.bubble.textContent = text; L.bubble.classList.add('on'); }
function notice(i) {
  const t = L.t ?? 0, me = L.me[i];
  me.notice = { t0: t, until: t + 3.6 }; me.calm = t + 8;
  if (L.c.chatter && L.box) say(i, L.react.next(), t, 2.8);
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// One frame of the live view (t: seconds). Poses the crew when their life is on and motion is allowed, and runs the
// bubbles; returns whether it posed them (crew.js keeps its idle pose otherwise).
export function tick(t, still) {
  if (!L) return false;
  const dt = L.t === null ? 0 : Math.min(0.1, Math.max(0, t - L.t)), move = L.c.life && !still; L.t = t;
  if (L.next === null) L.next = t + 2 + L.lines.rnd() * 3;
  L.A.people.forEach((f, i) => {
    const me = L.me[i], n = me.notice && t < me.notice.until ? me.notice : null;
    if (!n && move) me.clock += dt;
    if (move) pose(f, i, at(L.plans[i] || L.plans[0], me.clock), n, t, dt);
  });
  // Chatter: one bubble at a time, every 6-12 s, held 3 s.
  if (L.say && t > L.say.until) { L.say = null; L.bubble?.classList.remove('on'); }
  if (L.box && L.c.chatter && !still && !L.say && t >= L.next) { say(Math.floor(L.lines.rnd() * L.A.people.length), L.lines.next(), t, 3); L.next = t + 3 + 6 + L.lines.rnd() * 6; }
  if (L.say) place(L.A.people[L.say.i]);
  return move;
}
// The bubble above a head, on the figure's frame.
function place(f) {
  L.A.grp.updateMatrixWorld();
  const [x, y, z] = L.H.proj(f.head.localToWorld(tmp.set(0, 1.05, 0)));
  Object.assign(L.bubble.style, { left: `${x.toFixed(1)}px`, top: `${y.toFixed(1)}px`, visibility: z < 1 ? 'visible' : 'hidden' });
}
// A crew member's pose for this moment of the routine: walking (legs, arms and a bob), the act, or noticing.
function pose(f, i, s, n, t, dt) {
  const me = L.me[i], [l0, l1] = f.legs, [a0, a1] = f.arms;
  f.g.position.set(s.x, 0, s.z);
  let face = s.yaw ?? me.yaw;
  if (n) { const p = L.A.grp.worldToLocal(L.H.camera.position.clone()); face = Math.atan2(p.x - s.x, p.z - s.z); }
  me.yaw += wrap(face - me.yaw) * Math.min(1, dt * 7); f.g.rotation.y = me.yaw;
  const sw = s.walk ? Math.sin(s.stride * 2.6) * 0.45 : 0;
  [[l0, sw], [l1, -sw]].forEach(([[leg, boot], a]) => {
    const x = leg.position.x, c = Math.cos(a), sn = Math.sin(a);
    leg.position.set(x, 0.78 - 0.36 * c, 0.36 * sn); leg.rotation.x = -a;
    boot.position.set(x, 0.78 - 0.68 * c + 0.06 * sn, 0.68 * sn + 0.06 * c); boot.rotation.x = -a;
  });
  f.body.position.y = s.walk ? Math.abs(Math.sin(s.stride * 2.6)) * 0.05 : 0;
  a0.rotation.x = -sw * 0.9; a1.rotation.x = sw * 0.9;
  const e = Math.sin(s.k * PI), into = s.into;
  if (n) { a1.rotation.set(0, 0, 2.55 + Math.sin((t - n.t0) * 9) * 0.35); return; }
  if (s.act === 'carry' || (s.act === 'feed' && s.k < 0.6)) { L.rod[i].visible = true; a0.rotation.x = a1.rotation.x = -1.1; }
  if (s.act === 'pick') { f.body.rotation.x = 0.35 * e; a0.rotation.x = a1.rotation.x = -1.2 * e; }
  if (s.act === 'feed') { a0.rotation.x = a1.rotation.x = -1.25 + Math.sin(into * 3) * 0.15; }
  if (s.act === 'work' || s.act === 'door' || s.act === 'idle') f.head.rotation.y = Math.sin(into * 0.8 + i) * 0.4;
  if (s.act === 'work') a1.rotation.x = -0.6;
  if (s.act === 'mug') { L.mug[i].visible = true; a1.rotation.x = -0.8 - 0.9 * Math.max(0, Math.sin(into * 1.1)) ** 4; }
  if (s.act === 'stretch') { a0.rotation.z = -2.7 * e; a1.rotation.z = 2.7 * e; f.body.position.y += 0.05 * e; }
  if (s.act === 'lean') { f.body.rotation.z = 0.1; a1.rotation.z = 0.25; }
}
