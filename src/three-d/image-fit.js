// Fitting a company section image to a face (or the A–A′ plane) by known points, for geology.js's face images.
// Loaded on the first "Fit by points" click. The image is shown on a canvas: a click places the next point, whose
// distance along the face and elevation (read off the image's own grid), or a hole's collar or a depth down it, are
// typed beside it. Apply fits the image (EM3D.fitFaceImage); the face's outline is then drawn over the image in its
// fitted place, with each point's misfit, so the fit shows before the figure is looked at.
let H = null, face = null, pts = [];
const ACCENT = '#c65322';

const n1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : '');
function planeText() {
  const G = H.G, ends = face === 'section' ? (([A, B]) => [[A.x, A.y], [B.x, B.y]])(H.sectionEnds()) : (({ a, b }) => [a, b])(H.faceGeom(face)), len = Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]);
  return `${face === 'section' ? 'The A–A′ plane runs' : `The ${face} face runs`} 0–${Math.round(len)} m ${face === 'section' ? 'from A' : 'from its left end as seen from outside'}; the block reaches ${Math.round(G.B.z0)}–${Math.round(G.zmax)} m elevation.`;
}

export function open(el, host, f) {
  H = host; face = f;
  const img = H.ext('geology')?.imageOf(face); if (!el || !img) { H.status('The image is still loading: try again in a moment.'); return; }
  const info = H.ext('geology').fitInfo(face); pts = info ? structuredClone(info.points) : [];
  el.hidden = false; render(el, img);
}

function render(el, img) {
  const esc = H.esc, holes = H.project.holes.map((h) => h.id), k = Math.min(1, 640 / img.naturalWidth);
  el.innerHTML = `<div class="row" style="justify-content:space-between"><strong>Fit the ${face === 'section' ? 'A–A′' : esc(face)} image by known points</strong><button class="btn" type="button" data-fx aria-label="Close the fit">×</button></div>
    <p class="muted" style="margin:4px 0">${esc(planeText())} Click the image to add a point (two or more), then give each its distance along and elevation, or a hole's collar (or a depth down it).</p>
    <canvas data-fc width="${Math.round(img.naturalWidth * k)}" height="${Math.round(img.naturalHeight * k)}" style="width:100%;cursor:crosshair;border:1px solid #c6cecf;border-radius:4px" aria-label="The section image: click to add a point"></canvas>
    <div class="files" style="margin-top:6px">${pts.map((p, i) => `<div class="label-row" style="grid-template-columns:auto 1fr 1fr 1fr auto;gap:4px" data-fp="${i}">
      <b style="color:${ACCENT}">${i + 1}</b>
      <input type="number" data-k="d" value="${p.hole ? '' : esc(n1(p.d))}" placeholder="m along" aria-label="Point ${i + 1}: metres along" ${p.hole ? 'disabled' : ''}>
      <input type="number" data-k="z" value="${p.hole ? '' : esc(n1(p.z))}" placeholder="Elev. m" aria-label="Point ${i + 1}: elevation" ${p.hole ? 'disabled' : ''}>
      <span style="display:flex;gap:2px"><select data-k="hole" aria-label="Point ${i + 1}: or a hole"><option value="">or a hole</option>${holes.map((id) => `<option ${p.hole === id ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select><input type="number" data-k="depth" min="0" value="${esc(p.depth ?? '')}" placeholder="Depth" style="width:5em" aria-label="Point ${i + 1}: depth down the hole (empty: the collar)" ${p.hole ? '' : 'hidden'}></span>
      <button class="btn" type="button" data-fdel aria-label="Remove point ${i + 1}">×</button></div>`).join('')}</div>
    <p class="muted" data-fm style="margin:4px 0"></p>
    <div class="row" style="gap:6px"><button class="btn primary" type="button" data-fa ${pts.length < 2 ? 'disabled' : ''}>Apply fit</button><button class="btn" type="button" data-fs>Stretch over the face instead</button></div>`;
  const cv = el.querySelector('[data-fc]');
  draw(cv, img, k);
  cv.addEventListener('click', (e) => { const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * cv.width / k, y = (e.clientY - r.top) / r.height * cv.height / k; pts.push({ px: [Math.round(x), Math.round(y)] }); render(el, img); });
  el.querySelectorAll('[data-fp]').forEach((row) => {
    const p = pts[+row.dataset.fp];
    row.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
      const v = inp.value.trim(); if (inp.dataset.k === 'hole') { if (v) { p.hole = v; delete p.d; delete p.z; } else { delete p.hole; delete p.depth; } render(el, img); return; }
      if (v === '') delete p[inp.dataset.k]; else p[inp.dataset.k] = +v;
    }));
    row.querySelector('[data-fdel]').addEventListener('click', () => { pts.splice(+row.dataset.fp, 1); render(el, img); });
  });
  const msg = el.querySelector('[data-fm]'), info = H.ext('geology').fitInfo(face);
  if (info) msg.textContent = `Fitted: ${info.metresPerPixel[0]} m a pixel across, ${info.metresPerPixel[1]} up; the image spans ${info.image ? `${info.image.along[0]} to ${info.image.along[1]} m along and ${info.image.z[0]} to ${info.image.z[1]} m` : 'the plane'}. Misfit ${info.rms} m over ${info.points.length} points. Dashed: the ${face === 'section' ? 'plane' : 'face'} on the image.`;
  el.querySelector('[data-fx]').addEventListener('click', () => { el.hidden = true; el.innerHTML = ''; });
  el.querySelector('[data-fa]').addEventListener('click', () => {
    const points = pts.map((p) => (p.hole ? { px: p.px, hole: p.hole, ...(Number.isFinite(p.depth) ? { depth: p.depth } : {}) } : { px: p.px, d: p.d, z: p.z }));
    H.api.fitFaceImage(face, points).then(() => render(el, img), (err) => { msg.textContent = err.message; });
  });
  el.querySelector('[data-fs]').addEventListener('click', () => { pts = []; H.api.fitFaceImage(face, null).then(() => render(el, img), (err) => { msg.textContent = err.message; }); });
}

// The image, the points, and with a fit the plane's outline (base to block top, 0 to its length) in its fitted place.
function draw(cv, img, k) {
  const g = cv.getContext('2d'), info = H.ext('geology').fitInfo(face); g.drawImage(img, 0, 0, cv.width, cv.height);
  if (info) {
    const F = info.fit, P = (d, z) => [(d - F.ox) / F.sx * k, (z - F.oz) / F.sz * k], c = [P(0, info.plane.z[0]), P(info.plane.length, info.plane.z[0]), P(info.plane.length, info.plane.z[1]), P(0, info.plane.z[1])];
    g.setLineDash([6, 4]); g.strokeStyle = ACCENT; g.lineWidth = 2; g.beginPath(); c.forEach((q, i) => (i ? g.lineTo(...q) : g.moveTo(...q))); g.closePath(); g.stroke(); g.setLineDash([]);
  }
  pts.forEach((p, i) => {
    const x = p.px[0] * k, y = p.px[1] * k; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill(); g.strokeStyle = ACCENT; g.lineWidth = 2; g.stroke();
    g.fillStyle = ACCENT; g.font = '700 10px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 0.5);
  });
}
