// The figure's look, loaded with the first grade shell or the orthographic projection (EXT hook in
// studio.js). Shells: each cut-off a solid, shaded form with crisp outlines ("solid+edges", the default), a
// plain solid, or the translucent glass of before; studio.js estimates the surfaces (shell-worker.js) and
// keeps the shell's state, this draws them. Orthographic: the framing of the drilling and the shell. Haze,
// and the scene settings' checks.
import * as THREE from 'three';

let H = null; // host (studio.js), set by init
export function init(host) { H = host; }

// ---------- pure ----------
// Marching cubes winds its triangles either way round: turn them outward (positive signed volume), so
// front faces are the outside. In place; returns the indices.
export function windOutward(pos, idx) {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (v < 0) for (let t = 0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
  return idx;
}
// A colour toward black (k < 1), for the outline in the shell's own hue.
export const shade = (hex, k) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('')}`;
// Opacity of a solid shell: nested ones step from half the set opacity (outermost) to opaque (the core), so
// the core reads through the outer shells, as on the reference fences (about 30%, 65%, 100%).
export const shellOpacity = (base, rank, n, solid) => (solid && n > 1 ? base / 2 + (1 - base / 2) * rank / (n - 1) : base);

// ---------- the matcap ----------
// A grey sphere lit from the upper left that darkens toward its rim, so a shell reads as a solid from any
// side without depending on the scene's lights; the shell colour tints it.
let matcap = null;
function matcapTex() {
  if (matcap) return matcap;
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'), img = g.createImageData(n, n), L = [-0.45, 0.6, 0.66];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n * 2 - 1, y = 1 - (j + 0.5) / n * 2, r2 = x * x + y * y, z = Math.sqrt(Math.max(0, 1 - r2)), o = (j * n + i) * 4;
    const dif = Math.max(0, x * L[0] + y * L[1] + z * L[2]), rim = Math.max(0, Math.min(1, (Math.sqrt(r2) - 0.72) / 0.28));
    const v = 255 * Math.min(1, (0.74 + 0.3 * dif) * (1 - 0.28 * rim * rim));
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); matcap = new THREE.CanvasTexture(c); return matcap;
}

// ---------- the meshes ----------
// One mesh per cut-off, each with its outlines and its ghost (the same surface drawn faintly where the terrain
// hides it). Outlines: the creases (EdgesGeometry, sharper than 40°) and the silhouette, a dark shell a hair
// larger drawn inside out behind the surface, so only its rim shows. Grouped as G.shellMesh.
export function placeShells() {
  const { G, shell } = H; H.dropShell(); const M = shell.mesh; if (!G || !M) return;
  const grp = new THREE.Group(), [ox, oy, oz] = M.origin; grp.userData.key = M.key;
  M.parts.forEach((part, k) => {
    if (!part.indices.length) return;
    const src = part.positions, pos = new Float32Array(src.length);
    for (let i = 0; i < pos.length; i += 3) { const v = G.V(ox + src[i], oy + src[i + 1], oz + src[i + 2]); pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(windOutward(pos, part.indices), 1)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 40), new THREE.LineBasicMaterial({ transparent: true }));
    const hp = pos.slice(), nm = g.attributes.normal.array, d = G.diag * 0.0022; for (let i = 0; i < hp.length; i++) hp[i] += nm[i] * d;
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(hp, 3)); hg.setIndex(g.index);
    const rim = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true }));
    const ghost = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth, side: THREE.DoubleSide }));
    ghost.renderOrder = 6.5; m.userData = { part: k, edges, rim, ghost }; m.add(edges, rim, ghost); grp.add(m);
  });
  G.shellMesh = grp; H.root.add(grp); styleShells();
}
// Colour, opacity and shading from S.shell. Solid shells (matcap-shaded) write depth, outermost last, so an
// inner core shows through an outer shell and the far side of each is hidden; glass is the lit, even,
// double-sided haze of the first shells.
export function styleShells() {
  const grp = H.G?.shellMesh; if (!grp) return;
  const sh = H.S.shell, list = H.shellList(), mode = sh.shading || 'solid+edges', solid = mode !== 'glass';
  grp.children.forEach((m) => {
    const s = list[m.userData.part] || list[0], op = shellOpacity(sh.opacity, s.rank, list.length, solid);
    if (m.material.type !== (solid ? 'MeshMatcapMaterial' : 'MeshLambertMaterial')) {
      m.material.dispose(); m.material = solid ? new THREE.MeshMatcapMaterial({ matcap: matcapTex(), transparent: true }) : new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    }
    m.material.color.set(s.color); m.material.opacity = op;
    m.renderOrder = 4 - 0.01 * s.rank;
    const { edges: e, rim } = m.userData, line = shade(s.color, 0.45);
    e.visible = rim.visible = mode === 'solid+edges'; e.material.color.set(line); e.material.opacity = Math.min(0.7, op); e.renderOrder = m.renderOrder + 0.001;
    rim.material.color.set(line); rim.material.opacity = Math.min(1, op + 0.35); rim.renderOrder = m.renderOrder + 0.002;
    const gh = m.userData.ghost; gh.material.color.set(s.color); gh.material.opacity = Math.min(0.4, sh.opacity + 0.1); gh.visible = !!sh.throughTerrain;
  });
}

// ---------- orthographic framing ----------
// The drilling and the shell centred between the title and the footer with even margins, and as large as
// fits beside the callout column and the legend, without the block crossing the footer. Moves the camera's
// aim (saved as its pan) and zoom.
export function frameContent() {
  const { G, camera, controls, proj } = H, [W, Hf] = H.frame(), u = Math.sqrt(W * Hf) / 900, top = 130 * u, bot = Hf - 80 * u, pts = [];
  H.project.holes.forEach((h) => h.path.forEach((p, i) => { if (i % 5 === 0 || i === h.path.length - 1) pts.push(G.V(p.x, p.y, p.z)); }));
  (G.shellMesh?.children || []).forEach((m) => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; for (let k = 0; k < 8; k++) pts.push(new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z)); });
  for (let k = 0; k < 3; k++) {
    camera.updateMatrixWorld(); const sp = pts.map(proj), xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]), [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const wpp = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.distanceTo(controls.target) / Hf, c = H.getCam();
    H.aim.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), ((x0 + x1) / 2 - W / 2) * wpp).addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), ((top + bot) / 2 - (y0 + y1) / 2) * wpp);
    H.setCamera({ ...c, pan: undefined, zoom: c.zoom * Math.min(W * 0.56 / Math.max(1, x1 - x0), (bot - top) * 0.88 / Math.max(1, y1 - y0)) }, true);
  }
  const f = H.blockOverflow(); if (f > 1) H.setCamera({ zoom: H.getCam().zoom / f }, true);
}

// ---------- haze ----------
// A light fog in the background colour (S.scene.haze), from just in front of the block to a few block
// widths behind it; set before each render, as the camera moves.
export function haze() {
  const { G, scene, camera, controls } = H, h = H.S.scene.haze; if (!(h > 0) || !G) { scene.fog = null; return; }
  const d = camera.position.distanceTo(controls.target); scene.fog ||= new THREE.Fog();
  scene.fog.color.copy(scene.background); scene.fog.near = d * 0.75; scene.fog.far = d * 0.75 + G.diag * (5.5 - 4.5 * h);
}

// ---------- the scene settings (EM3D.setScene), validated into S.scene ----------
const LIM = { sunAz: [0, 360], sunAlt: [5, 85], shadow: [0, 1], ao: [0, 1], haze: [0, 1] };
export function patchScene(sc, o) {
  Object.entries(o).forEach(([k, v]) => {
    if (k === 'theme') { if (!['light', 'dark'].includes(v)) throw new Error('theme must be "light" or "dark".'); sc.theme = v; return; }
    if (k === 'edge') { if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error('edge must be a hex colour like #1e1d26.'); sc.edge = v.toLowerCase(); return; }
    if (!LIM[k] || v === null || v === '' || !Number.isFinite(+v)) throw new Error('setScene takes sunAz (0-360), sunAlt (5-85), shadow, ao and haze (0-1) as numbers, theme: "light" | "dark" and edge: "#hex".');
    sc[k] = k === 'sunAz' ? (+v % 360 + 360) % 360 : Math.max(LIM[k][0], Math.min(LIM[k][1], +v));
  });
}
